/**
 * The Azure Blob Storage driver (src/lib/storage.ts), against the Azurite emulator: the same SDK
 * calls, signed links and container rules production uses, without an Azure account.
 *
 * Runs when AZURITE=1 (CI starts Azurite as a service; locally:
 *   docker run -d -p 10000:10000 mcr.microsoft.com/azure-storage/azurite:3.35.0 azurite-blob --blobHost 0.0.0.0 --loose --skipApiVersionCheck
 * ). Without it the suite is skipped, and says so, rather than passing without having run.
 */
const enabled = process.env.AZURITE === "1";

if (enabled) {
  // Azurite's published development account; not a secret.
  const key = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
  const blob = process.env.AZURITE_BLOB_ENDPOINT ?? "http://127.0.0.1:10000/devstoreaccount1";
  process.env.STORAGE_DRIVER = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${key};BlobEndpoint=${blob};`;
  process.env.AZURE_STORAGE_PUBLIC_CONTAINER = `public-test-${Date.now().toString(36)}`;
  process.env.AZURE_STORAGE_PRIVATE_CONTAINER = `private-test-${Date.now().toString(36)}`;
}

(enabled ? describe : describe.skip)("Azure Blob Storage driver (Azurite)", () => {
  type Storage = typeof import("../../src/lib/storage");
  let storage: Storage;
  const store = `store${Date.now().toString(36)}`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  beforeAll(async () => {
    storage = await import("../../src/lib/storage");
    await storage.prepareStorage();
  });

  afterAll(async () => {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const client = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
    await client.getContainerClient(process.env.AZURE_STORAGE_PUBLIC_CONTAINER!).deleteIfExists();
    await client.getContainerClient(process.env.AZURE_STORAGE_PRIVATE_CONTAINER!).deleteIfExists();
  });

  it("is the Azure driver, and its containers answer", async () => {
    expect(storage.getStorage().name).toBe("azure");
    await expect(storage.getStorage().ping()).resolves.toBeUndefined();
  });

  it("a product image is public at a permanent address, cached for a year", async () => {
    const key = storage.newKey("products", store, ".png");
    await storage.getStorage().put(key, png, "image/png");
    const res = await fetch(storage.getStorage().publicUrl(key));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
  });

  it("a receipt is private: only a signed link opens it, and only for reading", async () => {
    const key = storage.newKey("receipts", store, ".png");
    await storage.getStorage().put(key, png, "image/png");
    const link = await storage.getStorage().signedUrl(key, 60);
    expect(link).toMatch(/[?&]sp=r(&|$)/);
    expect((await fetch(link)).status).toBe(200);
    expect([403, 404, 409]).toContain((await fetch(link.split("?")[0])).status);
    // A read link cannot be used to overwrite the receipt.
    expect([403, 404]).toContain((await fetch(link, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob" }, body: "replaced" })).status);
    expect(await storage.getStorage().get(key)).toEqual(png);
    expect(await storage.linkFor(key)).toMatch(/[?&]sig=/);
  });

  it("a file that is not there reads as null, and removing it twice is fine", async () => {
    const key = storage.newKey("voice", store, ".webm");
    expect(await storage.getStorage().get(key)).toBeNull();
    await storage.getStorage().remove(key);
    await storage.getStorage().remove(key);
  });

  it("removing a store removes every one of its files, and nobody else's", async () => {
    const mine = storage.newKey("receipts", store, ".png");
    const other = storage.newKey("receipts", `${store}x`, ".png");
    await storage.getStorage().put(mine, png, "image/png");
    await storage.getStorage().put(other, png, "image/png");
    await storage.getStorage().removeStore(store);
    expect(await storage.getStorage().get(mine)).toBeNull();
    expect(await storage.getStorage().get(other)).toEqual(png);
    await storage.getStorage().removeStore(`${store}x`);
  });
});
