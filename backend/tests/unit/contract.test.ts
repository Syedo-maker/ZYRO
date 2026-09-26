/**
 * Phase 0 gate: the API contract, the wireframes and the traceability table agree.
 * - openapi.yaml parses and every operation has a unique operationId.
 * - Every wireframe file in design/wireframes appears in documentation/Phase0_Traceability.md.
 * - Every operationId named in that document exists in openapi.yaml, and every operationId in
 *   openapi.yaml is used by some screen (or named there as called by an outside service).
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "../../..");
const spec = yaml.load(fs.readFileSync(path.join(ROOT, "backend/openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string }>>;
};
const doc = fs.readFileSync(path.join(ROOT, "documentation/Phase0_Traceability.md"), "utf8");

const METHODS = ["get", "post", "put", "patch", "delete"];
const operations = Object.entries(spec.paths).flatMap(([p, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({ path: p, method: m, id: item[m].operationId }))
);

function wireframes(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? wireframes(path.join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith(".dc.html") ? [`${prefix}${e.name}`] : []
  );
}

describe("the API contract", () => {
  it("has operations", () => {
    expect(operations.length).toBeGreaterThan(50);
  });

  it("gives every operation an operationId, and no two the same", () => {
    const ids = operations.map((o) => o.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the traceability table", () => {
  const files = wireframes(path.join(ROOT, "design/wireframes"));

  it.each(files)("lists the wireframe %s", (file) => {
    expect(doc).toContain(`| ${file} |`);
  });

  it("names only operations that exist in openapi.yaml", () => {
    const known = new Set(operations.map((o) => o.id));
    const named = [...new Set(doc.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => /^(auth|users|stores?|products|uploads|reviews|ai|cart|checkout|orders|pos|shipping|discount|assistant|insights|analytics|webhooks|plans|billing|platform)_/.test(w));
    const unknown = named.filter((w) => !known.has(w));
    expect(unknown).toEqual([]);
  });

  it("accounts for every operation in openapi.yaml", () => {
    const missing = operations.map((o) => o.id!).filter((id) => !new RegExp(`\\b${id}\\b`).test(doc));
    expect(missing).toEqual([]);
  });
});
