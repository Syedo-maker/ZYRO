/**
 * The daily AI limits' defaults (lib/aiLimits.ts): on in production (200 per store, 5,000 for the
 * platform, the owner's decision of 2026-11-14), off elsewhere; a setting overrides them and 0 turns a
 * limit off.
 */
import { limit } from "../../src/lib/aiLimits";

const saved = { NODE_ENV: process.env.NODE_ENV, AI_DAILY_STORE_LIMIT: process.env.AI_DAILY_STORE_LIMIT, AI_DAILY_GLOBAL_LIMIT: process.env.AI_DAILY_GLOBAL_LIMIT };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

it("production defaults to 200 per store and 5,000 for the platform", () => {
  process.env.NODE_ENV = "production";
  delete process.env.AI_DAILY_STORE_LIMIT;
  process.env.AI_DAILY_GLOBAL_LIMIT = "";
  expect(limit("AI_DAILY_STORE_LIMIT")).toBe(200);
  expect(limit("AI_DAILY_GLOBAL_LIMIT")).toBe(5000);
});

it("a setting overrides the default, and 0 turns the limit off", () => {
  process.env.NODE_ENV = "production";
  process.env.AI_DAILY_STORE_LIMIT = "50";
  process.env.AI_DAILY_GLOBAL_LIMIT = "0";
  expect(limit("AI_DAILY_STORE_LIMIT")).toBe(50);
  expect(limit("AI_DAILY_GLOBAL_LIMIT")).toBeNull();
});

it("development and tests have no default limit", () => {
  process.env.NODE_ENV = "test";
  delete process.env.AI_DAILY_STORE_LIMIT;
  delete process.env.AI_DAILY_GLOBAL_LIMIT;
  expect(limit("AI_DAILY_STORE_LIMIT")).toBeNull();
  expect(limit("AI_DAILY_GLOBAL_LIMIT")).toBeNull();
});
