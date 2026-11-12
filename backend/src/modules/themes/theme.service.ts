import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { getStorage } from "../../lib/storage";
import { Errors } from "../../errors/AppError";
import { IMAGE_KEY_TAIL, themeSchema, type Theme } from "./theme.schema";
import { deriveTheme } from "./theme.tokens";
import { PRESETS, defaultThemeFor } from "./theme.presets";
import { FONT_PAIRS } from "./theme.fonts";

/**
 * A store's theme: the owner's draft, the published theme shoppers see, an undo/redo trail of the
 * draft, and the last published versions (Store Themes, 2026-11).
 *
 *   draft      what the owner is working on; only the owner can read it (GET /stores/:id/theme)
 *   published  what the storefront wears; served with the public store profile
 *   history    the draft's last HISTORY_LIMIT states, with `cursor` pointing at the current one, so
 *              Undo and Redo walk it; a new change after an Undo drops the states ahead of it
 *   versions   one row per Publish, newest VERSION_LIMIT kept, any of them restorable into the draft
 *
 * Every theme passes the strict schema and then the contrast guard before it is stored, so what is
 * stored is always valid and readable. Logo and banner must be images uploaded to this same store.
 */

export const HISTORY_LIMIT = 30;
export const VERSION_LIMIT = 10;

type Row = { id: string; draft: Prisma.JsonValue; published: Prisma.JsonValue | null; publishedAt: Date | null; history: Prisma.JsonValue; cursor: number; updatedAt: Date };

function parseStored(value: Prisma.JsonValue | null): Theme | null {
  if (value === null) return null;
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A logo or banner link must be exactly the address this store's own upload produced. */
function assertOwnImages(storeId: string, theme: Theme) {
  for (const [label, url] of [["logo", theme.logoUrl], ["banner", theme.bannerUrl]] as const) {
    if (!url) continue;
    const match = IMAGE_KEY_TAIL.exec(url);
    const file = url.slice(url.lastIndexOf("/") + 1);
    if (!match || match[1] !== storeId || url !== getStorage().publicUrl(`products/${storeId}/${file}`)) {
      throw Errors.validation(`The ${label} must be an image uploaded to this store.`);
    }
  }
}

/** Validates, then guards: what comes back is what gets stored. */
function prepare(storeId: string, input: unknown) {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) {
    throw Errors.validation(parsed.error.issues.map((i) => `${i.path.join(".") || "theme"}: ${i.message}`).join("; "));
  }
  assertOwnImages(storeId, parsed.data);
  return deriveTheme(parsed.data);
}

async function load(storeId: string): Promise<Row> {
  const existing = await prisma.storeTheme.findFirst({ where: { tenantId: storeId } });
  if (existing) return existing;
  const tenant = await prisma.tenant.findUnique({ where: { id: storeId }, select: { themeColor: true } });
  if (!tenant) throw Errors.notFound("Store");
  const start = defaultThemeFor(tenant);
  try {
    return await prisma.storeTheme.create({
      data: { tenantId: storeId, draft: start, history: [start], cursor: 0 } as Prisma.StoreThemeUncheckedCreateInput,
    });
  } catch {
    // Two first requests at once: the other one created it.
    const row = await prisma.storeTheme.findFirst({ where: { tenantId: storeId } });
    if (!row) throw Errors.conflict("Could not start this store's theme. Please try again.");
    return row;
  }
}

/** Writes only if nobody else changed the row since it was read, so two tabs cannot lose each other's work silently. */
async function save(storeId: string, row: Row, data: Prisma.StoreThemeUpdateManyMutationInput) {
  const { count } = await prisma.storeTheme.updateMany({ where: { tenantId: storeId, id: row.id, updatedAt: row.updatedAt }, data });
  if (count === 0) throw Errors.conflict("The theme was changed in another window. Reload to see the latest version.");
}

function history(row: Row): Theme[] {
  return Array.isArray(row.history) ? (row.history as unknown as Theme[]) : [];
}

async function state(storeId: string, corrections: ReturnType<typeof deriveTheme>["corrections"] = []) {
  const row = await load(storeId);
  const draft = parseStored(row.draft) ?? defaultThemeFor({ themeColor: null });
  const derived = deriveTheme(draft);
  const trail = history(row);
  const published = parseStored(row.published);
  return {
    draft: derived.theme,
    tokens: derived.tokens,
    checks: derived.checks,
    corrections,
    published,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    hasUnpublishedChanges: !published || JSON.stringify(published) !== JSON.stringify(derived.theme),
    canUndo: row.cursor > 0,
    canRedo: row.cursor < trail.length - 1,
  };
}

/** The draft becomes `next`; the trail keeps what came before it and forgets anything that had been undone. */
async function pushDraft(storeId: string, next: Theme) {
  const row = await load(storeId);
  const current = parseStored(row.draft);
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  let trail = history(row).slice(0, row.cursor + 1);
  trail.push(next);
  if (trail.length > HISTORY_LIMIT) trail = trail.slice(trail.length - HISTORY_LIMIT);
  await save(storeId, row, { draft: next, history: trail as unknown as Prisma.InputJsonValue, cursor: trail.length - 1 });
}

async function move(storeId: string, by: -1 | 1) {
  const row = await load(storeId);
  const trail = history(row);
  const cursor = row.cursor + by;
  if (cursor < 0 || cursor >= trail.length) throw Errors.conflict(by < 0 ? "There is nothing to undo." : "There is nothing to redo.");
  const theme = parseStored(trail[cursor] as unknown as Prisma.JsonValue);
  if (!theme) throw Errors.conflict("That step can no longer be restored.");
  await save(storeId, row, { draft: theme, cursor });
}

export const themeService = {
  /** Everything the owner's Theme Studio needs, draft included. Owner only (see theme.routes.ts). */
  get: (storeId: string) => state(storeId),

  async saveDraft(storeId: string, input: unknown) {
    const derived = prepare(storeId, input);
    await pushDraft(storeId, derived.theme);
    return state(storeId, derived.corrections);
  },

  undo: async (storeId: string) => (await move(storeId, -1), state(storeId)),
  redo: async (storeId: string) => (await move(storeId, 1), state(storeId)),

  /** The draft goes live, and is kept as a version. Only the newest VERSION_LIMIT versions are kept. */
  async publish(storeId: string, userId: string | undefined) {
    const row = await load(storeId);
    const draft = parseStored(row.draft);
    if (!draft) throw Errors.conflict("The draft could not be read. Change something and try again.");
    const theme = deriveTheme(draft).theme;
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.storeTheme.updateMany({ where: { tenantId: storeId, id: row.id, updatedAt: row.updatedAt }, data: { published: theme, publishedAt: new Date() } });
      if (count === 0) throw Errors.conflict("The theme was changed in another window. Reload to see the latest version.");
      await tx.storeThemeVersion.create({ data: { tenantId: storeId, theme, publishedByUserId: userId ?? null } as Prisma.StoreThemeVersionUncheckedCreateInput });
      const keep = await tx.storeThemeVersion.findMany({ where: { tenantId: storeId }, orderBy: { createdAt: "desc" }, take: VERSION_LIMIT, select: { id: true } });
      await tx.storeThemeVersion.deleteMany({ where: { tenantId: storeId, id: { notIn: keep.map((v) => v.id) } } });
    });
    return state(storeId);
  },

  async versions(storeId: string) {
    const rows = await prisma.storeThemeVersion.findMany({ where: { tenantId: storeId }, orderBy: { createdAt: "desc" }, take: VERSION_LIMIT });
    return {
      versions: rows.flatMap((v) => {
        const theme = parseStored(v.theme);
        return theme ? [{ id: v.id, publishedAt: v.createdAt.toISOString(), theme }] : [];
      }),
    };
  },

  /** A published version comes back as the draft (one Undo away from what was there); Publish makes it live again. */
  async restore(storeId: string, versionId: string) {
    const version = await prisma.storeThemeVersion.findFirst({ where: { tenantId: storeId, id: versionId } });
    if (!version) throw Errors.notFound("Theme version");
    const derived = prepare(storeId, version.theme);
    await pushDraft(storeId, derived.theme);
    return state(storeId, derived.corrections);
  },

  /** The ready-made looks and the font pairs the controls offer. */
  options() {
    return {
      presets: Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, description: p.description, theme: p.theme, tokens: deriveTheme(p.theme).tokens })),
      fonts: Object.entries(FONT_PAIRS).map(([id, f]) => ({ id, label: f.label, mood: f.mood, sans: f.sans, display: f.display })),
    };
  },

  /**
   * What shoppers get: the published theme and its tokens, or null if the owner has never published.
   * Never the draft. Called from the public store profile, outside any request tenant context.
   */
  async publishedFor(storeId: string) {
    // Awaited inside run(): a Prisma query only executes when awaited, and must still see the tenant then.
    const row = await tenantContext.run(storeId, async () => await prisma.storeTheme.findFirst({ where: { tenantId: storeId }, select: { published: true } }));
    const theme = parseStored(row?.published ?? null);
    if (!theme) return null;
    const derived = deriveTheme(theme);
    return { theme: derived.theme, tokens: derived.tokens };
  },
};
