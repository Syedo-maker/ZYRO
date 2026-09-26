/**
 * Jest configuration. Integration tests use the real Postgres, MongoDB and Redis (they create
 * throwaway stores and remove them), so files run one at a time. Tests that call real paid
 * services (Anthropic, Stripe) live in tests/real and run only with `npm run test:real`.
 */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/real/"],
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json", isolatedModules: true, diagnostics: false }] },
  testTimeout: 120000,
  maxWorkers: 1,
  // BullMQ and Redis connections are closed by each suite; this only stops a stray handle from hanging the run.
  forceExit: true,
};