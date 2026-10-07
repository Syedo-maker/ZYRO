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

  /*
   * Coverage (Phase 7). Only the application's own source counts: the test helpers are not the
   * product, and counting them would flatter the number.
   */
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/index.ts"],
  coverageReporters: ["text-summary", "json-summary", "lcov"],

  /*
   * Floors, not targets. They sit a little under what the suite actually reaches (measured
   * 2026-10-07: 92.4% statements, 77.4% branches, 94.3% functions, 94.8% lines), so that a change
   * which quietly stops testing something fails the run, while ordinary refactoring does not trip
   * over a number that happens to be exact.
   *
   * Branches is the lowest of the four on purpose. Much of what is uncovered there is defensive:
   * the `catch` around a Redis read that treats a failure as a cache miss, a provider that is
   * faked in every test. Those paths are real and deliberate, and chasing them to a round number
   * with artificial tests would make the suite worse, not better.
   */
  coverageThreshold: {
    global: { statements: 90, branches: 75, functions: 92, lines: 92 },
  },
};