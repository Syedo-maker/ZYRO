/**
 * GET /api/v1/site tells the web app whether uploads are demo-only: only for local files on a
 * deployment marked as having a temporary disk, never with Azure Blob Storage.
 */
import request from "supertest";

const saved = { driver: process.env.STORAGE_DRIVER, demoOnly: process.env.UPLOADS_DEMO_ONLY };
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

async function ask(driver: string, demoOnly: string | undefined) {
  jest.resetModules();
  process.env.STORAGE_DRIVER = driver;
  restore("UPLOADS_DEMO_ONLY", demoOnly);
  const { app } = await import("../../src/app");
  return request(app).get("/api/v1/site");
}

afterAll(() => {
  restore("STORAGE_DRIVER", saved.driver);
  restore("UPLOADS_DEMO_ONLY", saved.demoOnly);
});

it.each([
  ["local", "true", true],
  ["local", undefined, false],
  ["azure", "true", false],
])("with storage %s and UPLOADS_DEMO_ONLY=%s", async (driver, demoOnly, expected) => {
  const res = await ask(driver, demoOnly);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ uploadsDemoOnly: expected });
});
