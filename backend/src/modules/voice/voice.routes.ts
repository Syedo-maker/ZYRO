import { RequestHandler, Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { Errors } from "../../errors/AppError";
import { voiceService } from "./voice.service";

/** Audio formats a phone browser actually records: webm from Chrome and Android, mp4/m4a from iOS. */
const ALLOWED_AUDIO = new Set(["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/wave", "audio/x-wav", "video/webm"]);
const EXTENSION: Record<string, string> = { "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/wav": ".wav", "audio/wave": ".wav", "audio/x-wav": ".wav" };
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// In memory, not on disk: the file goes straight to the transcriber, and only then is it written
// somewhere the merchant can play it back.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_AUDIO.has(file.mimetype)) {
      cb(new Error("Only a voice recording can be sent here (webm, mp3, m4a, ogg or wav)"));
      return;
    }
    cb(null, true);
  },
});

const handleAudioUpload: RequestHandler = (req, res, next) => {
  audioUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return next(Errors.validation(err.message));
    if (err) return next(Errors.validation((err as Error).message));
    next();
  });
};

const run =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      const out = await fn(req);
      if (out === undefined) res.status(204).send();
      else res.status(status).json(out);
    } catch (err) {
      next(err);
    }
  };

/**
 * Part G's voice notes, mounted at /stores/:storeId/voice-notes (see app.ts).
 *
 * `products_write` throughout: a voice note proposes a change to the catalogue, so whoever may make
 * that change by typing may make it by speaking, and nobody else. Applying is a separate call, which
 * is the whole point.
 */
export const voiceRouter = Router({ mergeParams: true });

const manage = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];

voiceRouter.post(
  "/",
  ...manage,
  handleAudioUpload,
  run(async (req) => {
    if (!req.file) throw Errors.validation("No recording was sent, or it failed the type or size check");
    const name = `voice-${randomUUID()}${EXTENSION[req.file.mimetype] ?? ".webm"}`;
    await writeFile(path.join(env.uploadsDir, name), req.file.buffer);
    const audioUrl = `${env.publicUrl}/uploads/${name}`;
    return voiceService.record(req.params.storeId, req.userId!, req.file.buffer, name, req.file.mimetype, audioUrl);
  }, 201)
);

voiceRouter.get("/", ...manage, run((req) => voiceService.list(req.params.storeId, typeof req.query.status === "string" ? req.query.status : undefined)));

/** The only place a voice note changes anything, and it takes a deliberate call from the merchant. */
voiceRouter.post("/:noteId/apply", ...manage, run((req) => voiceService.apply(req.params.storeId, req.params.noteId, req.userId!)));

voiceRouter.post("/:noteId/discard", ...manage, run((req) => voiceService.discard(req.params.storeId, req.params.noteId)));
