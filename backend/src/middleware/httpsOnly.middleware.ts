import type { RequestHandler } from "express";
import { env } from "../config/env";

/**
 * HTTPS only (production readiness, 2026-11), switched on with FORCE_HTTPS=true. Off by default:
 * usually the proxy in front (nginx, a load balancer, the platform's ingress) already redirects, and
 * this is for deployments where it does not.
 *
 * A plain-HTTP request is redirected to the same path on PUBLIC_URL's host over https: 301 for GET
 * and HEAD, 308 for anything else (so a POST stays a POST). The host comes from PUBLIC_URL, never
 * from the request's Host header, so this cannot be turned into an open redirect. Behind a proxy,
 * TRUST_PROXY must be set for Express to see the original scheme (X-Forwarded-Proto). The health
 * endpoints are left alone, because the platform probes them over plain HTTP inside its network.
 */
export const httpsOnly: RequestHandler = (req, res, next) => {
  if (!env.forceHttps || req.secure || req.path === "/health" || req.path === "/ready") return next();
  const target = new URL(req.originalUrl, env.publicUrl);
  target.protocol = "https:";
  res.redirect(req.method === "GET" || req.method === "HEAD" ? 301 : 308, target.toString());
};
