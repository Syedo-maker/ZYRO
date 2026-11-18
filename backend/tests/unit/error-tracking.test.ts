/**
 * Error tracking (lib/errorTracking.ts): off without SENTRY_DSN; with it, an error is sent with the
 * tags needed to find it (environment, request id, store id, path) and nothing personal (no query
 * string, cookies, headers or user). A stand-in transport captures what would be sent.
 */
import { initErrorTracking, reportError, flushErrorTracking, stopErrorTracking } from "../../src/lib/errorTracking";

afterEach(async () => {
  await stopErrorTracking();
  delete process.env.SENTRY_DSN;
});

it("is off without SENTRY_DSN, and reporting is then a no-op", () => {
  delete process.env.SENTRY_DSN;
  expect(initErrorTracking("api")).toBe(false);
  expect(() => reportError(new Error("ignored"))).not.toThrow();
});

it("sends the error with its tags, and nothing personal", async () => {
  const sent: string[] = [];
  const transport = () => ({
    send: async (envelope: unknown) => {
      sent.push(JSON.stringify(envelope));
      return { statusCode: 200 };
    },
    flush: async () => true,
  });
  expect(initErrorTracking("api", { dsn: "https://publickey@errors.example.com/1", transport: transport as never })).toBe(true);

  reportError(new Error("checkout exploded"), {
    where: "request",
    requestId: "req-123",
    tenantId: "cmw51a0nd0002tki88u5cibgk",
    method: "POST",
    path: "/api/v1/stores/cmw51a0nd0002tki88u5cibgk/checkout/session?token=SECRET-IN-QUERY",
  });
  await flushErrorTracking();

  expect(sent).toHaveLength(1);
  const body = sent[0];
  expect(body).toContain("checkout exploded");
  expect(body).toContain('"tenantId":"cmw51a0nd0002tki88u5cibgk"');
  expect(body).toContain('"requestId":"req-123"');
  expect(body).toContain('"where":"request"');
  expect(body).toContain("/api/v1/stores/cmw51a0nd0002tki88u5cibgk/checkout/session");
  expect(body).not.toContain("SECRET-IN-QUERY");
  expect(body).not.toMatch(/cookie|authorization|ip_address/i);
});
