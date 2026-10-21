import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

/**
 * Response conformance: every JSON response the API sends, in every integration test, is checked
 * against what openapi.yaml promises for that operation and status.
 *
 * openapi.yaml is the contract the frontend, the register and any integrator are written against.
 * The route test (contract-routes.test.ts) proves each documented endpoint exists; this proves what
 * comes back has the documented shape: the required fields are there, with the documented types,
 * formats and allowed values. It runs on the requests the suite already makes (well over a thousand,
 * across every module), so the contract is checked against real scenarios rather than samples
 * written for the purpose.
 *
 * The rules:
 *   - A success (2xx) must be a documented status for that operation, and match its schema.
 *   - An error must be an RFC 9457 problem document, as the contract's Errors section promises for
 *     every error; when that status is documented for the operation, it must match that schema too.
 *   - A path under /api/v1 that the contract does not describe is a violation, unless the server
 *     itself answered "Route not found" (a test asking for something that does not exist).
 */

type Schema = Record<string, unknown>;
interface Operation {
  method: string;
  template: string;
  regex: RegExp;
  params: number;
  responses: Record<string, Schema>;
}

const SPEC_FILE = path.resolve(__dirname, "../../openapi.yaml");
const BASE = "/api/v1";
const METHODS = ["get", "post", "put", "patch", "delete"];

let cache: { ajv: Ajv2020; operations: Operation[]; spec: Schema; validators: Map<string, ValidateFunction> } | null = null;

/** "#/components/schemas/X" inside a response schema has to point at the registered spec. */
function rebase(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rebase);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = k === "$ref" && typeof v === "string" && v.startsWith("#/") ? `openapi${v}` : rebase(v);
    return out;
  }
  return node;
}

function load() {
  if (cache) return cache;
  const spec = yaml.load(fs.readFileSync(SPEC_FILE, "utf8")) as Schema & { paths: Record<string, Record<string, any>>; components: Record<string, any> };
  // Not strict: OpenAPI adds keywords (example, discriminator, xml) that are not JSON Schema.
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  ajv.addSchema({ $id: "openapi", components: spec.components });

  const operations: Operation[] = [];
  for (const [template, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const responses: Record<string, Schema> = {};
      for (const [status, resp] of Object.entries(op.responses ?? {})) {
        const r = (resp as any).$ref ? spec.components.responses[(resp as any).$ref.split("/").pop()] : resp;
        responses[status] = r as Schema;
      }
      const pattern = template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+");
      operations.push({ method: method.toUpperCase(), template, regex: new RegExp(`^${BASE}${pattern}/?$`), params: (template.match(/\{/g) ?? []).length, responses });
    }
  }
  // A literal segment wins over a parameter: /stores/categories before /stores/{storeId}.
  operations.sort((a, b) => a.params - b.params);
  cache = { ajv, operations, spec, validators: new Map() };
  return cache;
}

function validator(key: string, schema: Schema): ValidateFunction {
  const c = load();
  let v = c.validators.get(key);
  if (!v) {
    v = c.ajv.compile(rebase(schema) as Schema);
    c.validators.set(key, v);
  }
  return v;
}

const describeErrors = (v: ValidateFunction) =>
  (v.errors ?? [])
    .slice(0, 4)
    .map((e) => `${e.instancePath || "(body)"} ${e.message}${e.params && "allowedValues" in e.params ? ` ${JSON.stringify((e.params as any).allowedValues)}` : ""}`)
    .join("; ");

export interface Violation {
  operation: string;
  status: number;
  problem: string;
}

/** Checks one response. Returns why it breaks the contract, or null. */
export function checkResponse(method: string, url: string, status: number, body: unknown): Violation | null {
  const pathOnly = url.split("?")[0];
  if (!pathOnly.startsWith(`${BASE}/`)) return null;
  if (status === 404 && (body as any)?.title === "Route not found") return null;
  const c = load();
  const op = c.operations.find((o) => o.method === method && o.regex.test(pathOnly));
  const name = op ? `${op.method} ${op.template}` : `${method} ${pathOnly}`;
  if (!op) return { operation: name, status, problem: "this path and method are not in openapi.yaml" };

  const documented = op.responses[String(status)] ?? op.responses[`${String(status)[0]}XX`] ?? op.responses.default;

  if (status >= 400) {
    const errorSchema = { $ref: "#/components/schemas/Error" };
    const generic = validator("Error", errorSchema);
    if (!generic(body)) return { operation: name, status, problem: `error is not a problem document: ${describeErrors(generic)}` };
  } else if (!documented) {
    return { operation: name, status, problem: `status ${status} is not documented for this operation` };
  }

  const content = (documented as any)?.content as Record<string, { schema?: Schema }> | undefined;
  if (!content) return null;
  const media = content["application/json"] ?? content["application/problem+json"] ?? Object.values(content)[0];
  if (!media?.schema) return null;
  const v = validator(`${name} ${status}`, media.schema);
  return v(body) ? null : { operation: name, status, problem: describeErrors(v) };
}
