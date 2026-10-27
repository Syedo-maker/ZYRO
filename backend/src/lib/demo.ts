import { Prisma } from "@prisma/client";

/**
 * Demo stores (2026-10-22), made by scripts/demo-product-scout.ts so Product Scout can be shown on a
 * development machine. Every demo store's slug starts with this prefix, and its owners' emails end in
 * DEMO_EMAIL_DOMAIN; nobody can register a slug with the prefix (auth.validation.ts). Their orders are
 * kept out of everything platform-wide (Trend Scout, Product Scout's live figures, the platform page,
 * the Growth Advisor run, the shop directory), so a demo can never move a real figure.
 */
export const DEMO_SLUG_PREFIX = "demo-scout-";
export const DEMO_EMAIL_DOMAIN = "demo.zyro.local";

export const isDemoSlug = (slug: string | null | undefined): boolean => !!slug && slug.startsWith(DEMO_SLUG_PREFIX);

/** Prisma filter on Tenant: real stores only. */
export const notDemoTenant: Prisma.TenantWhereInput = { NOT: { slug: { startsWith: DEMO_SLUG_PREFIX } } };

/** SQL condition on a Tenant alias, for raw queries: `t` is not a demo store. */
export const sqlNotDemo = (alias: string) => Prisma.sql`${Prisma.raw(`"${alias}"."slug"`)} NOT LIKE ${`${DEMO_SLUG_PREFIX}%`}`;
/** SQL condition on a Tenant alias: `t` is a demo store. */
export const sqlIsDemo = (alias: string) => Prisma.sql`${Prisma.raw(`"${alias}"."slug"`)} LIKE ${`${DEMO_SLUG_PREFIX}%`}`;
