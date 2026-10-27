import { Router } from "express";
import { Errors } from "../../errors/AppError";
import { contentTypeFor, getStorage, verifyFileLink } from "../../lib/storage";

/**
 * Private files on the local driver: GET /api/v1/files/<key>?expires=<unix seconds>&signature=<hmac>.
 *
 * The link is the permission. It is signed by the API when someone allowed to see the file asks for
 * it (a merchant opening their receipts, say), and it stops working when it expires. A missing,
 * altered or expired link gets the same 404 as a file that does not exist, so a guess learns nothing.
 * On Azure, private files are handed out as Blob Storage SAS links instead and never pass through here.
 */
export const filesRouter = Router();

filesRouter.get("/*", async (req, res, next) => {
  try {
    const key = (req.params as Record<string, string>)[0] ?? "";
    const expires = Number(req.query.expires);
    const signature = typeof req.query.signature === "string" ? req.query.signature : "";
    if (!verifyFileLink(key, expires, signature)) throw Errors.notFound("File");

    const bytes = await getStorage().get(key);
    if (!bytes) throw Errors.notFound("File");

    const secondsLeft = Math.max(0, expires - Math.floor(Date.now() / 1000));
    res
      .status(200)
      .type(contentTypeFor(key))
      .set({
        // Only the browser that was given the link may keep it, and no longer than the link lasts.
        "Cache-Control": `private, max-age=${secondsLeft}`,
        "Content-Disposition": "inline",
        // Whatever is in the file, it is never run as a page.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      })
      .send(bytes);
  } catch (err) {
    next(err);
  }
});
