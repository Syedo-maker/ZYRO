import { z } from "zod";
import type { StorePolicyKind } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { Errors } from "../../errors/AppError";

/**
 * A shop's own policy pages (production readiness, 2026-11): returns and refunds, shipping, privacy
 * and terms. The owner writes them (Settings offers templates to start from, marked for review by a
 * lawyer); shoppers read them on the storefront. Plain text, shown as text, never as HTML.
 */

/** The kinds as they appear in a URL, and the database's names for them. */
export const POLICY_KINDS = { refund: "REFUND", shipping: "SHIPPING", privacy: "PRIVACY", terms: "TERMS" } as const satisfies Record<string, StorePolicyKind>;
export type PolicySlug = keyof typeof POLICY_KINDS;
const SLUG_OF = Object.fromEntries(Object.entries(POLICY_KINDS).map(([slug, kind]) => [kind, slug])) as Record<StorePolicyKind, PolicySlug>;

/** About 3,000 words: room for a full policy, and a limit on what one request can store. */
export const POLICY_MAX_CHARS = 20_000;
export const policyBodySchema = z.object({ body: z.string().max(POLICY_MAX_CHARS, `A policy can be up to ${POLICY_MAX_CHARS.toLocaleString("en")} characters`) });

export function policyKind(slug: string): StorePolicyKind {
  const kind = POLICY_KINDS[slug as PolicySlug];
  if (!kind) throw Errors.notFound("Policy");
  return kind;
}

const view = (p: { kind: StorePolicyKind; body: string; updatedAt: Date }) => ({ kind: SLUG_OF[p.kind], body: p.body, updatedAt: p.updatedAt.toISOString() });

export const policyService = {
  /** The policies this shop has written, in a fixed order. Public: anyone may read a shop's policies. */
  async list(storeId: string) {
    const store = await prisma.tenant.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) throw Errors.notFound("Store");
    const rows = await tenantContext.run(storeId, async () => await prisma.storePolicy.findMany({ where: { tenantId: storeId } }));
    const order = Object.values(POLICY_KINDS) as StorePolicyKind[];
    return { policies: rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map(view) };
  },

  /** Saves one policy; an empty text removes it, so the storefront no longer shows that page. */
  async set(storeId: string, slug: string, body: string) {
    const kind = policyKind(slug);
    const text = body.replace(/\r\n/g, "\n").trim();
    return tenantContext.run(storeId, async () => {
      if (!text) {
        await prisma.storePolicy.deleteMany({ where: { tenantId: storeId, kind } });
        return { kind: slug as PolicySlug, body: null, updatedAt: null };
      }
      const updated = await prisma.storePolicy.updateMany({ where: { tenantId: storeId, kind }, data: { body: text } });
      if (updated.count === 0) await prisma.storePolicy.create({ data: { tenantId: storeId, kind, body: text } });
      const row = await prisma.storePolicy.findFirst({ where: { tenantId: storeId, kind } });
      return view(row!);
    });
  },
};
