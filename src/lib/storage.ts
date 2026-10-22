import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAX_DOCUMENT_BYTES, type DocumentMimeType } from "@/lib/upload-validation";

export class StorageError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "StorageError"; }
}

let client: S3Client | undefined;
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new StorageError("STORAGE_NOT_CONFIGURED", "Private document storage is not configured.");
  return value;
}
function getClient() {
  if (!client) {
    const endpoint = required("S3_ENDPOINT");
    if (!endpoint.startsWith("https://") && process.env.NODE_ENV === "production") throw new StorageError("STORAGE_NOT_CONFIGURED", "Storage requires an HTTPS endpoint.");
    client = new S3Client({
      endpoint,
      region: required("S3_REGION"),
      credentials: { accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") },
      // Current Railway buckets use virtual hosted URLs. Legacy buckets can opt into path style.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export interface StoredDocumentReference { organizationId: string; documentId: string; storageKey: string }
function prefix(organizationId: string, documentId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(documentId)) throw new StorageError("INVALID_STORAGE_REFERENCE", "Invalid document reference.");
  return `organizations/${organizationId}/documents/${documentId}/`;
}
function assertReference(ref: StoredDocumentReference) {
  if (!ref.storageKey.startsWith(prefix(ref.organizationId, ref.documentId)) || !/^source\.(pdf|png|jpe?g)$/.test(ref.storageKey.slice(prefix(ref.organizationId, ref.documentId).length))) throw new StorageError("INVALID_STORAGE_REFERENCE", "Invalid document reference.");
}

/** Caller must first authorize organization membership. Keys never contain customer filenames. */
export async function putDocumentFile(input: { organizationId: string; documentId: string; bytes: Uint8Array; mimeType: DocumentMimeType; extension: string }): Promise<string> {
  if (!/^(pdf|png|jpe?g)$/.test(input.extension) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_DOCUMENT_BYTES) throw new StorageError("INVALID_STORAGE_OBJECT", "Invalid document object.");
  const storageKey = `${prefix(input.organizationId, input.documentId)}source.${input.extension}`;
  try {
    await getClient().send(new PutObjectCommand({ Bucket: required("S3_BUCKET"), Key: storageKey, Body: input.bytes, ContentType: input.mimeType, ContentLength: input.bytes.byteLength, CacheControl: "private, no-store" }));
    return storageKey;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("STORAGE_UPLOAD_FAILED", "The document could not be stored. Please retry.");
  }
}

/** A capped server-side read. No public or provider-facing document URL is created. */
export async function readDocumentFile(ref: StoredDocumentReference): Promise<{ bytes: Buffer; mimeType: DocumentMimeType }> {
  assertReference(ref);
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket: required("S3_BUCKET"), Key: ref.storageKey }));
    const mimeType = result.ContentType?.split(";")[0] as DocumentMimeType | undefined;
    if (!mimeType || !["application/pdf", "image/png", "image/jpeg"].includes(mimeType) || !result.Body) throw new StorageError("INVALID_STORAGE_OBJECT", "The stored document is invalid.");
    if (result.ContentLength !== undefined && result.ContentLength > MAX_DOCUMENT_BYTES) {
      result.Body.transformToWebStream().cancel().catch(() => undefined);
      throw new StorageError("INVALID_STORAGE_OBJECT", "The stored document exceeds the size limit.");
    }
    const reader = result.Body.transformToWebStream().getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DOCUMENT_BYTES) { await reader.cancel(); throw new StorageError("INVALID_STORAGE_OBJECT", "The stored document exceeds the size limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!size) throw new StorageError("INVALID_STORAGE_OBJECT", "The stored document is empty.");
    return { bytes: Buffer.concat(chunks, size), mimeType };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("STORAGE_READ_FAILED", "The document could not be retrieved.");
  }
}

/** Used for user deletion and for compensation when a metadata transaction fails after an upload. Idempotent. */
export async function deleteDocumentFile(ref: StoredDocumentReference): Promise<void> {
  assertReference(ref);
  try { await getClient().send(new DeleteObjectCommand({ Bucket: required("S3_BUCKET"), Key: ref.storageKey })); }
  catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("STORAGE_DELETE_FAILED", "The document could not be removed.");
  }
}
