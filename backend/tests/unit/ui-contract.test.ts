/**
 * The frontend and the server agree on every endpoint.
 *
 * Every call the web app makes goes through `apiFetch` (frontend/src/lib/apiClient.ts). This reads
 * the frontend's source with the TypeScript compiler, finds every one of those calls, works out the
 * method and path it requests, and checks that openapi.yaml documents exactly that operation. Together
 * with contract-routes.test.ts (every documented operation exists in the server) and the response
 * conformance check (every response matches the document), the three cannot drift apart unnoticed:
 * a page calling an endpoint that was renamed, or never built, fails here before anyone clicks it.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import yaml from "js-yaml";

const FRONTEND = path.resolve(__dirname, "../../../frontend/src");
const spec = yaml.load(fs.readFileSync(path.resolve(__dirname, "../../openapi.yaml"), "utf8")) as { paths: Record<string, Record<string, unknown>> };

interface Call {
  file: string;
  line: number;
  method: string;
  path: string | null;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [full] : [];
  });
}

/** A parameter or a query string, judged by the expression inside `${...}`. */
const QUERY_NAMES = /^(qs|query|params|search|queryString|filters)$/i;

function calls(): Call[] {
  const found: Call[] = [];
  for (const file of sourceFiles(FRONTEND)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("apiFetch")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    // Path helpers such as `const base = (storeId: string) => `/stores/${storeId}/payments``.
    const helpers = new Map<string, ts.Expression>();
    const visitHelpers = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
        const body = node.initializer.body;
        if (ts.isTemplateExpression(body) || ts.isNoSubstitutionTemplateLiteral(body) || ts.isStringLiteral(body)) helpers.set(node.name.text, body);
      }
      ts.forEachChild(node, visitHelpers);
    };
    visitHelpers(sf);

    const render = (expr: ts.Expression): string | null => {
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
      if (ts.isTemplateExpression(expr)) {
        let out = expr.head.text;
        for (const span of expr.templateSpans) {
          const inner = span.expression;
          const name = ts.isIdentifier(inner) ? inner.text : ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) ? inner.expression.text : "";
          if (ts.isCallExpression(inner) && helpers.has(name)) {
            const sub = render(helpers.get(name)!);
            if (sub === null) return null;
            out += sub;
          } else if (QUERY_NAMES.test(name) || /^\?/.test(span.literal.text) || !out.endsWith("/")) {
            // A query string: not part of the path, and whatever follows it is query too. A path
            // parameter always starts a segment, so anything spliced in mid-segment (after
            // `/proofs`, say, as `${status ? `?status=...` : ''}`) is a query.
            return out;
          } else {
            out += "{}";
          }
          out += span.literal.text;
        }
        return out;
      }
      return null;
    };

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "apiFetch" && node.arguments.length > 0) {
        const options = node.arguments[1];
        let method = "GET";
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const prop of options.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "method" && ts.isStringLiteralLike(prop.initializer)) {
              method = prop.initializer.text.toUpperCase();
            }
          }
        }
        const rendered = render(node.arguments[0]);
        found.push({
          file: path.relative(FRONTEND, file).replace(/\\/g, "/"),
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          method,
          path: rendered === null ? null : rendered.split("?")[0],
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

const normalise = (p: string) => p.replace(/\{[^}]*\}/g, "{}").replace(/\/+$/, "");
const documented = new Set(
  Object.entries(spec.paths).flatMap(([p, item]) =>
    ["get", "post", "put", "patch", "delete"].filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${normalise(p)}`)
  )
);

const all = calls().filter((c) => !c.file.endsWith("lib/apiClient.ts"));

describe("every API call the web app makes is in openapi.yaml", () => {
  it(`finds the app's ${all.length} calls (a sanity check that the reader works)`, () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it("can read the path of every call", () => {
    expect(all.filter((c) => c.path === null).map((c) => `${c.file}:${c.line}`)).toEqual([]);
  });

  it("names only documented operations", () => {
    const missing = all.filter((c) => c.path !== null && !documented.has(`${c.method} ${normalise(c.path)}`)).map((c) => `${c.method} ${c.path}  (${c.file}:${c.line})`);
    expect(missing).toEqual([]);
  });
});
