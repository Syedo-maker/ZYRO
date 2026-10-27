import fs from "node:fs";
import path from "node:path";
import express from "express";
import { checkResponse, type Violation } from "./conformance";

/**
 * Runs before every test file (jest.config.js, setupFilesAfterEnv). Every JSON response the app
 * sends during that file is checked against openapi.yaml (see conformance.ts), and the file fails
 * if any broke the contract, naming each one. CONFORMANCE=off turns it off for a local experiment.
 *
 * Each response is also recorded in coverage/conformance.jsonl, so the run leaves a list of which
 * documented operations were actually exercised.
 */
if (process.env.CONFORMANCE !== "off") {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const outDir = path.resolve(__dirname, "../../coverage");

  const originalJson = express.response.json;
  express.response.json = function (this: express.Response, body?: unknown) {
    const req = this.req;
    if (req) {
      // What the client receives: dates as ISO strings, undefined fields gone.
      const wire = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
      const v = checkResponse(req.method, req.originalUrl, this.statusCode, wire);
      if (v && !seen.has(`${v.operation} ${v.status} ${v.problem}`)) {
        seen.add(`${v.operation} ${v.status} ${v.problem}`);
        violations.push(v);
      }
      try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.appendFileSync(path.join(outDir, "conformance.jsonl"), JSON.stringify({ method: req.method, path: req.originalUrl.split("?")[0], status: this.statusCode, ok: !v }) + "\n");
      } catch {
        // The record is a convenience; a write failure must never fail a test.
      }
    }
    return originalJson.call(this, body);
  };

  afterAll(() => {
    express.response.json = originalJson;
    if (violations.length > 0) {
      const lines = violations.map((v) => `  ${v.operation} -> ${v.status}: ${v.problem}`).join("\n");
      throw new Error(`${violations.length} response(s) did not match openapi.yaml:\n${lines}`);
    }
  });
}
