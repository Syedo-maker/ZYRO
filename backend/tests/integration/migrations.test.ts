/**
 * Phase 0 gate: the migrations alone build a complete database from nothing. They are applied to a
 * brand-new, empty Postgres schema (not the working one), which must end up with every table the
 * Prisma schema defines; the throwaway schema is dropped afterwards.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const BACKEND = path.resolve(__dirname, "../..");
const SCHEMA = `gate_${Date.now().toString(36)}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("schema", SCHEMA);
const admin = new PrismaClient();

afterAll(async () => {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await admin.$disconnect();
});

it("prisma migrate deploy on an empty schema creates every table in schema.prisma", async () => {
  execSync("npx prisma migrate deploy", { cwd: BACKEND, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });

  const models = [...fs.readFileSync(path.join(BACKEND, "prisma/schema.prisma"), "utf8").matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
  const tables = await admin.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
    SCHEMA
  );
  const names = new Set(tables.map((t) => t.table_name));
  expect(models.filter((m) => !names.has(m))).toEqual([]);
  expect(names.has("_prisma_migrations")).toBe(true);
}, 180_000);
