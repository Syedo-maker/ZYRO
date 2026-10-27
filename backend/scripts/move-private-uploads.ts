/**
 * Moves payment receipts and voice notes uploaded before private storage existed out of the public
 * uploads folder and into private storage (lib/storage.ts), and rewrites each row to hold the new
 * storage key.
 *
 * Until this change every upload went to one public folder, so a receipt (names, account numbers)
 * was readable by anyone with its address. This finds every PaymentProof and VoiceNote that still
 * points at a public address, stores the file privately under the store it belongs to, updates the
 * row, and only then deletes the public copy. A row whose file is missing is left as it is and
 * reported. Running it twice changes nothing the second time.
 *
 * Usage:  npx tsx scripts/move-private-uploads.ts            (reports what it would do)
 *         npx tsx scripts/move-private-uploads.ts --apply    (does it)
 */
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/config/env";
import { prismaUnscoped as p } from "../src/lib/prisma";
import { contentTypeFor, getStorage, isStorageKey, newKey, sniffImage, type FileArea } from "../src/lib/storage";

const apply = process.argv.includes("--apply");

/** The file name in a legacy `<PUBLIC_URL>/uploads/<name>` address; null for anything else. */
function legacyName(value: string): string | null {
  try {
    const name = new URL(value).pathname.replace(/^\/uploads\//, "");
    return name && name === path.basename(name) && !name.includes("..") ? name : null;
  } catch {
    return null;
  }
}

async function move(area: FileArea, storeId: string, value: string): Promise<string | "missing" | "skip"> {
  if (isStorageKey(value)) return "skip";
  const name = legacyName(value);
  if (!name) return "missing";
  const file = path.resolve(env.uploadsDir, name);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    return "missing";
  }
  const ext = area === "receipts" ? sniffImage(bytes)?.ext : path.extname(name).toLowerCase();
  if (!ext) return "missing";
  const key = newKey(area, storeId, ext);
  if (!apply) return key;
  await getStorage().put(key, bytes, area === "receipts" ? sniffImage(bytes)!.contentType : contentTypeFor(key));
  return key;
}

async function main() {
  const summary = { moved: 0, missing: 0, already: 0 };

  for (const row of await p.paymentProof.findMany({ select: { id: true, tenantId: true, imageUrl: true } })) {
    const result = await move("receipts", row.tenantId, row.imageUrl);
    if (result === "skip") summary.already += 1;
    else if (result === "missing") {
      summary.missing += 1;
      console.log(`receipt ${row.id}: file not found, row left unchanged`);
    } else {
      summary.moved += 1;
      if (apply) {
        await p.paymentProof.update({ where: { id: row.id }, data: { imageUrl: result } });
        await unlink(path.resolve(env.uploadsDir, legacyName(row.imageUrl)!)).catch(() => undefined);
      }
    }
  }

  for (const row of await p.voiceNote.findMany({ select: { id: true, tenantId: true, audioUrl: true } })) {
    const result = await move("voice", row.tenantId, row.audioUrl);
    if (result === "skip") summary.already += 1;
    else if (result === "missing") {
      summary.missing += 1;
      console.log(`voice note ${row.id}: file not found, row left unchanged`);
    } else {
      summary.moved += 1;
      if (apply) {
        await p.voiceNote.update({ where: { id: row.id }, data: { audioUrl: result } });
        await unlink(path.resolve(env.uploadsDir, legacyName(row.audioUrl)!)).catch(() => undefined);
      }
    }
  }

  console.log(
    `${apply ? "Moved" : "Would move"} ${summary.moved} file(s) to private storage; ${summary.already} already private; ${summary.missing} with no file.` +
      (apply ? "" : "\nRun again with --apply to do it.")
  );
  await p.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
