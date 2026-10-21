import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, access, rename, unlink, rm } from "node:fs/promises";
import path from "node:path";
import {
  BlobSASPermissions,
  BlobServiceClient,
  RestError,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { env } from "../config/env";

/**
 * Where uploaded files live.
 *
 * Two kinds of file, kept apart because they must be:
 *   - **public**: product images. Anyone may see them, on a storefront or in a search result.
 *   - **private**: bank-transfer receipts (they carry names and account numbers) and merchants'
 *     voice notes. They are never at a guessable or permanent address. The database holds only a
 *     storage key, and whoever is allowed to see the file is handed a signed link that works for an
 *     hour (env.storage.privateLinkSeconds).
 *
 * Two drivers behind one interface:
 *   - **local**: the development machine's disk. Public files are served by the API at /uploads;
 *     private files live in a separate folder that is never served, and are read through
 *     /api/v1/files with an HMAC-signed, expiring link.
 *   - **azure**: Blob Storage. Product images go in a container with anonymous read access to
 *     individual blobs (never listing); private files go in a container with none, and are handed
 *     out as read-only SAS links. In Azure the API signs with its managed identity (a user
 *     delegation key), so there is no storage account key anywhere in its configuration.
 *
 * Keys are `<area>/<storeId>/<uuid>.<ext>`. The store id is in the key so a receipt can be checked
 * to belong to the store that is asking for it, and the name is a random UUID so nothing about a
 * file can be guessed from another's.
 */

export type FileArea = "products" | "receipts" | "voice";
const PRIVATE_AREAS = new Set<FileArea>(["receipts", "voice"]);
const KEY_PATTERN = /^(products|receipts|voice)\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

export const isPrivateArea = (area: FileArea) => PRIVATE_AREAS.has(area);

/** A storage key we issued, in the right shape. Anything else is refused before it reaches a driver. */
export function isStorageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** The area and store a key belongs to; null when it is not one of ours. */
export function parseKey(key: string): { area: FileArea; storeId: string } | null {
  if (!isStorageKey(key)) return null;
  const [area, storeId] = key.split("/");
  return { area: area as FileArea, storeId };
}

export function newKey(area: FileArea, storeId: string, ext: string): string {
  const key = `${area}/${storeId}/${randomUUID()}${ext}`;
  if (!isStorageKey(key)) throw new Error(`Refusing to build an invalid storage key for store ${storeId}`);
  return key;
}

// ---- What a file really is ------------------------------------------------------------------------

export type ImageType = { ext: ".jpg" | ".png" | ".webp"; contentType: "image/jpeg" | "image/png" | "image/webp" };

/**
 * Identifies an image by its first bytes, never by what the client said it was.
 *
 * The browser's declared content type and the original file name are both chosen by whoever sends
 * the request. Saving a file under its sent name once meant `page.html`, declared as `image/png`,
 * was stored as HTML and served from the API's own origin: a stored cross-site scripting hole on the
 * origin that holds the login cookie. The extension now comes from the bytes alone.
 */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: ".jpg", contentType: "image/jpeg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: ".png", contentType: "image/png" };
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return { ext: ".webp", contentType: "image/webp" };
  }
  return null;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};
export const contentTypeFor = (key: string) => CONTENT_TYPE_BY_EXT[path.extname(key)] ?? "application/octet-stream";

// ---- The local driver's signed links --------------------------------------------------------------

const sign = (key: string, expires: number) =>
  createHmac("sha256", env.storage.signingSecret).update(`${key}\n${expires}`).digest("base64url");

/** Whether a link to a private file is genuine and still current. Constant-time on the signature. */
export function verifyFileLink(key: string, expires: number, signature: string): boolean {
  if (!isStorageKey(key) || !Number.isInteger(expires) || expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(key, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- Drivers --------------------------------------------------------------------------------------

export interface StorageDriver {
  readonly name: "local" | "azure";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The file's bytes, or null when there is no such file. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /** Every file a store has, in every area. For deleting a store. */
  removeStore(storeId: string): Promise<void>;
  /** The permanent address of a public file. */
  publicUrl(key: string): string;
  /** A short-lived, read-only address for a private file. */
  signedUrl(key: string, seconds: number): Promise<string>;
  /** Throws when the store cannot be reached; used by the readiness probe. */
  ping(): Promise<void>;
}

class LocalDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly publicRoot = path.resolve(env.uploadsDir);
  private readonly privateRoot = path.resolve(env.storage.privateDir);

  private file(key: string) {
    const parsed = parseKey(key);
    if (!parsed) throw new Error("Not a storage key");
    const root = isPrivateArea(parsed.area) ? this.privateRoot : this.publicRoot;
    const full = path.resolve(root, key);
    // Belt and braces: the key pattern already forbids "..", and this forbids escaping the root.
    if (!full.startsWith(root + path.sep)) throw new Error("Not a storage key");
    return full;
  }

  async put(key: string, bytes: Buffer) {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Written beside the target and then renamed, so a reader never sees half a file.
    const temp = `${full}.${randomUUID()}.part`;
    await writeFile(temp, bytes);
    await rename(temp, full);
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async remove(key: string) {
    await unlink(this.file(key)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  async removeStore(storeId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) throw new Error("Not a store id");
    for (const area of ["products", "receipts", "voice"] as FileArea[]) {
      await rm(path.resolve(isPrivateArea(area) ? this.privateRoot : this.publicRoot, area, storeId), { recursive: true, force: true });
    }
  }

  publicUrl(key: string) {
    return `${env.publicUrl}/uploads/${key}`;
  }

  async signedUrl(key: string, seconds: number) {
    const expires = Math.floor(Date.now() / 1000) + seconds;
    return `${env.publicUrl}/api/v1/files/${key}?expires=${expires}&signature=${sign(key, expires)}`;
  }

  async ping() {
    await mkdir(this.publicRoot, { recursive: true });
    await mkdir(this.privateRoot, { recursive: true });
    await access(this.privateRoot);
  }
}

class AzureBlobDriver implements StorageDriver {
  readonly name = "azure" as const;
  private readonly service: BlobServiceClient;
  private readonly sharedKey: StorageSharedKeyCredential | null;
  private delegationKey: { key: UserDelegationKey; expiresOn: Date } | null = null;

  constructor() {
    const { connectionString, accountUrl, clientId } = env.storage.azure;
    if (connectionString) {
      this.service = BlobServiceClient.fromConnectionString(connectionString);
    } else if (accountUrl) {
      // The managed identity in Azure; a developer's own sign-in (az login) anywhere else.
      const credential = env.isProduction ? new ManagedIdentityCredential(clientId ? { clientId } : {}) : new DefaultAzureCredential();
      this.service = new BlobServiceClient(accountUrl, credential);
    } else {
      throw new Error("STORAGE_DRIVER=azure needs AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL");
    }
    this.sharedKey = this.service.credential instanceof StorageSharedKeyCredential ? this.service.credential : null;
  }

  private blob(key: string) {
    const parsed = parseKey(key);
    if (!parsed) throw new Error("Not a storage key");
    const container = isPrivateArea(parsed.area) ? env.storage.azure.privateContainer : env.storage.azure.publicContainer;
    return this.service.getContainerClient(container).getBlockBlobClient(key);
  }

  /**
   * Creates the two containers if they are missing. Only for the local emulator and a first run:
   * in Azure the infrastructure template creates them, and the API's identity is deliberately not
   * allowed to change a container's access level.
   */
  async ensureContainers() {
    await this.service.getContainerClient(env.storage.azure.publicContainer).createIfNotExists({ access: "blob" });
    await this.service.getContainerClient(env.storage.azure.privateContainer).createIfNotExists();
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const parsed = parseKey(key)!;
    await this.blob(key).uploadData(bytes, {
      blobHTTPHeaders: {
        blobContentType: contentType,
        // Public names are random UUIDs and never reused, so a browser may keep them for a year.
        blobCacheControl: isPrivateArea(parsed.area) ? "private, no-store" : "public, max-age=31536000, immutable",
      },
    });
  }

  async get(key: string) {
    try {
      return await this.blob(key).downloadToBuffer();
    } catch (err) {
      if (err instanceof RestError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async remove(key: string) {
    await this.blob(key).deleteIfExists();
  }

  async removeStore(storeId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) throw new Error("Not a store id");
    const { publicContainer, privateContainer } = env.storage.azure;
    for (const [container, area] of [[publicContainer, "products"], [privateContainer, "receipts"], [privateContainer, "voice"]] as const) {
      const client = this.service.getContainerClient(container);
      for await (const item of client.listBlobsFlat({ prefix: `${area}/${storeId}/` })) await client.deleteBlob(item.name, { deleteSnapshots: "include" });
    }
  }

  publicUrl(key: string) {
    return this.blob(key).url;
  }

  async signedUrl(key: string, seconds: number) {
    const blob = this.blob(key);
    // Started a few minutes back, so a client whose clock runs slightly behind Azure's is not refused.
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + seconds * 1000);
    const options = {
      containerName: blob.containerName,
      blobName: blob.name,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
      // The emulator speaks plain HTTP; real Azure links are HTTPS only.
      protocol: blob.url.startsWith("https:") ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
    };
    const sas = this.sharedKey
      ? generateBlobSASQueryParameters(options, this.sharedKey)
      : generateBlobSASQueryParameters(options, await this.userDelegationKey(expiresOn), this.service.accountName);
    return `${blob.url}?${sas.toString()}`;
  }

  /** A delegation key lasts up to seven days; one is fetched per day and reused for every link. */
  private async userDelegationKey(needUntil: Date) {
    if (!this.delegationKey || this.delegationKey.expiresOn.getTime() < needUntil.getTime() + 60_000) {
      const startsOn = new Date(Date.now() - 5 * 60 * 1000);
      const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000);
      this.delegationKey = { key: await this.service.getUserDelegationKey(startsOn, expiresOn), expiresOn };
    }
    return this.delegationKey.key;
  }

  async ping() {
    await this.service.getContainerClient(env.storage.azure.privateContainer).getProperties();
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  driver ??= env.storage.driver === "azure" ? new AzureBlobDriver() : new LocalDriver();
  return driver;
}

/** Tests only: replaces the driver. */
export function setStorage(next: StorageDriver | null) {
  driver = next;
}

/** At startup: makes sure the places files go exist (local folders, or the emulator's containers). */
export async function prepareStorage() {
  const storage = getStorage();
  if (storage instanceof AzureBlobDriver && env.storage.azure.connectionString) await storage.ensureContainers();
  await storage.ping();
}

/**
 * What a client is given for a stored file reference: a signed link for a private key, the value
 * unchanged for anything else (a public URL, or a row written before private storage existed).
 */
export async function linkFor(reference: string): Promise<string> {
  const parsed = parseKey(reference);
  if (parsed && isPrivateArea(parsed.area)) return getStorage().signedUrl(reference, env.storage.privateLinkSeconds);
  return reference;
}
