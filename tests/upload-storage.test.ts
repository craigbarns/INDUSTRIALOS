import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { constructor(options: unknown) { mocks.config(options); } send = mocks.send; },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
}));
const ref = { organizationId: "org-a", documentId: "doc-a", storageKey: "organizations/org-a/documents/doc-a/source.pdf" };
function stream(bytes: Uint8Array) { return { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }; }

beforeEach(() => {
  vi.resetModules(); mocks.send.mockReset(); mocks.config.mockReset();
  for (const [key, value] of Object.entries({ S3_BUCKET: "private-bucket", S3_ENDPOINT: "https://storage.invalid", S3_REGION: "auto", S3_ACCESS_KEY_ID: "test-key", S3_SECRET_ACCESS_KEY: "test-secret", S3_FORCE_PATH_STYLE: "false" })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("private Railway S3 adapter", () => {
  it("uses virtual hosted addressing and private, filename-free object keys", async () => {
    mocks.send.mockResolvedValue({});
    const { putDocumentFile } = await import("../src/lib/storage");
    expect(await putDocumentFile({ organizationId: "org-a", documentId: "doc-a", bytes: Buffer.from("%PDF"), mimeType: "application/pdf", extension: "pdf" })).toBe(ref.storageKey);
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: false }));
    const command = mocks.send.mock.calls[0][0];
    expect(command.input).toMatchObject({ Bucket: "private-bucket", Key: ref.storageKey, CacheControl: "private, no-store" });
    expect(command.input).not.toHaveProperty("ACL");
  });
  it("rejects another organization's object key without contacting S3", async () => {
    const { readDocumentFile } = await import("../src/lib/storage");
    await expect(readDocumentFile({ ...ref, organizationId: "org-b" })).rejects.toMatchObject({ code: "INVALID_STORAGE_REFERENCE" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retrieves bytes only through the scoped server-side adapter", async () => {
    mocks.send.mockResolvedValue({ ContentLength: 4, ContentType: "application/pdf", Body: stream(Buffer.from("%PDF")) });
    const { readDocumentFile } = await import("../src/lib/storage");
    expect(await readDocumentFile(ref)).toEqual({ bytes: Buffer.from("%PDF"), mimeType: "application/pdf" });
  });
  it("caps streams even if the remote content length is missing", async () => {
    mocks.send.mockResolvedValue({ ContentType: "application/pdf", Body: stream(new Uint8Array(20 * 1024 * 1024 + 1)) });
    const { readDocumentFile } = await import("../src/lib/storage");
    await expect(readDocumentFile(ref)).rejects.toMatchObject({ code: "INVALID_STORAGE_OBJECT" });
  });
  it("never exposes storage provider errors or credentials", async () => {
    mocks.send.mockRejectedValue(new Error("private file contents and credential detail"));
    const { readDocumentFile } = await import("../src/lib/storage");
    await expect(readDocumentFile(ref)).rejects.toMatchObject({ code: "STORAGE_READ_FAILED", message: "The document could not be retrieved." });
  });
  it("deletes only the scoped object and hides provider errors", async () => {
    mocks.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("credential detail"));
    const { deleteDocumentFile } = await import("../src/lib/storage");
    await deleteDocumentFile(ref);
    expect(mocks.send.mock.calls[0][0].input).toEqual({ Bucket: "private-bucket", Key: ref.storageKey });
    await expect(deleteDocumentFile(ref)).rejects.toMatchObject({ code: "STORAGE_DELETE_FAILED", message: "The document could not be removed." });
  });
  it("reports missing storage configuration on deletion instead of a generic failure", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const { deleteDocumentFile } = await import("../src/lib/storage");
    await expect(deleteDocumentFile(ref)).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
