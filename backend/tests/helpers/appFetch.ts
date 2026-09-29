import request from "supertest";
import type { Express } from "express";

/** The made-up origin integration tests use for the app itself: requests to it never touch the network. */
export const APP_ORIGIN = "http://app.test";

/**
 * A `fetch` that sends requests for the app through Supertest (in process, no port opened) and
 * everything else through the real network. The integration tests were written against `fetch`
 * and a real listening server; this keeps every one of their requests exactly as written while
 * the app itself is exercised through Supertest. `extraOrigins` are also routed to the app (for
 * example the public URL an upload is served from, which would otherwise need a running server).
 */
export function appFetch(app: Express, extraOrigins: string[] = []): typeof fetch {
  const origins = new Set([APP_ORIGIN, ...extraOrigins.map((o) => o.replace(/\/+$/, ""))]);

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (!origins.has(url.origin)) return fetch(req);

    // Let the Request object encode the body, so a FormData upload becomes real multipart bytes
    // with its boundary in the content type, exactly as a browser or fetch would send it.
    const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
    let test = (request(app) as any)[req.method.toLowerCase()](url.pathname + url.search) as request.Test;
    // A JSON or text body goes as a string: given a Buffer with a JSON content type, Supertest
    // would encode the Buffer object itself as JSON. Anything else (a multipart upload) goes as bytes.
    const type = req.headers.get("content-type") ?? "";
    if (body !== undefined) test = test.send(/json|text|urlencoded/i.test(type) ? body.toString("utf8") : body);
    // Headers are set after the body: sending a Buffer makes Supertest pick its own content type,
    // and the request's own (JSON, or multipart with its boundary) must win.
    req.headers.forEach((value, name) => {
      test = test.set(name, value);
    });
    // Always keep the raw bytes: JSON, HTML and images alike are handed back untouched.
    const res = await test.buffer(true).parse(((stream: NodeJS.ReadableStream, done: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => done(null, Buffer.concat(chunks)));
    }) as never);

    const headers = new Headers();
    for (const [name, value] of Object.entries(res.headers as Record<string, string | string[]>)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
      else if (value !== undefined) headers.set(name, String(value));
    }
    const noBody = res.status === 204 || res.status === 304 || req.method === "HEAD";
    return new Response(noBody ? null : (res.body as Buffer), { status: res.status, headers });
  }) as typeof fetch;
}
