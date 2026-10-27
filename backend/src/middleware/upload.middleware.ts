import multer from "multer";
import { Errors } from "../errors/AppError";
import { getStorage, newKey, sniffImage, type FileArea } from "../lib/storage";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB, per openapi.yaml uploads_image_create

/**
 * Images are held in memory (5 MB at most) rather than written to the container's disk, which is
 * discarded on every restart; they go to storage (lib/storage.ts) only once they have been checked.
 * The declared type is a cheap first filter; what decides is `storeImage` reading the bytes.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, or WebP images are accepted"));
      return;
    }
    cb(null, true);
  },
});

/** Checks an uploaded image is what it claims to be, stores it, and returns its key. */
export async function storeImage(bytes: Buffer, area: FileArea, storeId: string): Promise<string> {
  const type = sniffImage(bytes);
  if (!type) throw Errors.validation("The file is not a JPEG, PNG or WebP image");
  const key = newKey(area, storeId, type.ext);
  await getStorage().put(key, bytes, type.contentType);
  return key;
}
