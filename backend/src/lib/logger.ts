import pino from "pino";

/**
 * One logger for the API and the worker: JSON lines on stdout, which is what Azure Container Apps
 * ships to Log Analytics, one object per event with a level, a time and whatever fields it carries.
 *
 * Nothing secret goes in a log line. Headers that carry credentials are redacted at the source, and
 * request logging (app.ts) records a path without its query string, because a signed file link
 * carries its signature there. Connection strings are never logged at all: see lib/mongo.ts.
 *
 * On a developer's machine the same events are printed readably (pino-pretty, a development
 * dependency only). Under Jest the level is `silent`, so test output stays the tests' own.
 */
const isTest = process.env.NODE_ENV === "test";
const pretty = process.env.NODE_ENV !== "production" && !isTest && process.env.LOG_FORMAT !== "json";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
  base: { service: process.env.OTEL_SERVICE_NAME ?? "zyro-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-guest-session-id"]',
      'res.headers["set-cookie"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[redacted]",
  },
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, singleLine: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" } } } : {}),
});

/** The message of anything thrown, for a log field. */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
