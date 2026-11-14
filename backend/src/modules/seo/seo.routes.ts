import { Router, type RequestHandler } from "express";
import { previewHtml, robotsTxt, sitemapXml } from "./seo.service";

/**
 * Public, under /api/v1/seo. The web server serves robots.txt and sitemap.xml at the site's root from
 * here, and sends link-preview apps (WhatsApp, Facebook...) opening a /store/... address to /preview.
 */
export const seoRouter = Router();

const wrap =
  (run: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await run(req, res, next);
    } catch (err) {
      next(err);
    }
  };

seoRouter.get(
  "/robots.txt",
  wrap((_req, res) => {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(robotsTxt());
  })
);
seoRouter.get(
  "/sitemap.xml",
  wrap(async (_req, res) => {
    res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(await sitemapXml());
  })
);
seoRouter.get(
  "/preview",
  wrap(async (req, res) => {
    res.type("text/html").set("Cache-Control", "public, max-age=600").send(await previewHtml(req.query.path));
  })
);
