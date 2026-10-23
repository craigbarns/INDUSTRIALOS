import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const SUPPORTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type DocumentMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export class UploadValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

interface UploadMetadata { name: string; type: string; size: number }
export interface ValidatedUpload {
  fileName: string;
  mimeType: DocumentMimeType;
  extension: "pdf" | "png" | "jpg" | "jpeg";
  size: number;
  sha256: string;
}

const MAX_INFLATED_PDF_BYTES = 64 * 1024 * 1024;

/**
 * PDF syntax with stream data replaced by its decompressed form, so compressed bytes cannot
 * match by chance and object streams cannot hide dictionaries. Name escapes (#xx) are decoded.
 */
function pdfSyntax(buffer: Buffer): string {
  const source = buffer.toString("latin1");
  const parts: string[] = [];
  let inflatedBytes = 0;
  let position = 0;
  const streamStart = /stream\r?\n/g;
  for (let match = streamStart.exec(source); match; match = streamStart.exec(source)) {
    if (match.index > 0 && /[A-Za-z]/.test(source[match.index - 1])) continue; // "endstream"
    const dataStart = match.index + match[0].length;
    const dataEnd = source.indexOf("endstream", dataStart);
    if (dataEnd < 0) break;
    const dictionary = source.slice(source.lastIndexOf("obj", match.index), match.index);
    parts.push(source.slice(position, dataStart));
    try {
      const inflated = inflateSync(buffer.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, MAX_INFLATED_PDF_BYTES - inflatedBytes) });
      inflatedBytes += inflated.length;
      parts.push(inflated.toString("latin1"));
    } catch (error) {
      if (error instanceof RangeError) throw new UploadValidationError("UNSAFE_DOCUMENT", "This PDF expands to too much data to be checked safely.");
      // Images and other non-Flate data are not PDF syntax, but object streams must be readable.
      if (/\/Type\s*\/ObjStm/.test(dictionary)) throw new UploadValidationError("UNSAFE_DOCUMENT", "This PDF uses an unsupported internal encoding. Export a flattened PDF.");
    }
    position = dataEnd;
    streamStart.lastIndex = dataEnd + "endstream".length;
  }
  parts.push(source.slice(position));
  return parts.join("").replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Validation runs on the server against the actual bytes, never client metadata alone. */
export function validateUpload(file: UploadMetadata, bytes: Uint8Array): ValidatedUpload {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DOCUMENT_BYTES || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new UploadValidationError("INVALID_FILE_SIZE", "Upload a non-empty document of at most 20 MB.");
  }
  if (bytes.byteLength !== file.size) {
    throw new UploadValidationError("FILE_SIZE_MISMATCH", "The uploaded document size is invalid.");
  }
  const fileName = file.name.normalize("NFC").trim();
  if (!fileName || fileName.length > 200 || /[\x00-\x1f\x7f/\\]/.test(fileName)) {
    throw new UploadValidationError("INVALID_FILE_NAME", "Use a document filename without paths or control characters.");
  }
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  const mimeByExtension = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" } as const;
  if (!extension || !(extension in mimeByExtension)) {
    throw new UploadValidationError("UNSUPPORTED_FILE_TYPE", "Only PDF, PNG, and JPEG documents are supported.");
  }
  const validExtension = extension as keyof typeof mimeByExtension;
  const mimeType = mimeByExtension[validExtension];
  if (file.type.toLowerCase() !== mimeType) {
    throw new UploadValidationError("INVALID_MIME_TYPE", "The document extension and content type must match.");
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isPdf = buffer.subarray(0, 8).toString("ascii").match(/^%PDF-1\.[0-7]|^%PDF-2\.0/);
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  // Some scanners append metadata/padding after EOI. Accept an EOI in the last 4 KiB,
  // while still rejecting truncated images and arbitrarily large appended payloads.
  const jpegEndMarker = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
  const isJpeg = buffer.length >= 5
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    && jpegEndMarker >= 3 && jpegEndMarker >= buffer.length - 4096;
  if ((mimeType === "application/pdf" && !isPdf) || (mimeType === "image/png" && !isPng) || (mimeType === "image/jpeg" && !isJpeg)) {
    throw new UploadValidationError("INVALID_FILE_SIGNATURE", "The document contents do not match its declared format.");
  }
  if (mimeType === "application/pdf") {
    const text = buffer.toString("latin1");
    if (!/%%EOF[\x00\t\n\f\r ]*$/.test(text.slice(-2048))) {
      throw new UploadValidationError("INVALID_FILE_SIGNATURE", "This PDF is incomplete or damaged.");
    }
    // Active documents and encrypted files are outside the passive-document scope of Sprint 1.
    const syntax = pdfSyntax(buffer);
    if (/\/Encrypt(?![A-Za-z0-9])/.test(syntax)) {
      throw new UploadValidationError("ENCRYPTED_DOCUMENT", "Encrypted or password-protected PDFs are not supported. Print or export the document to a new PDF without protection.");
    }
    // Names are case-sensitive in PDF. /OpenAction and /AA only trigger actions; the dangerous action types are matched by name.
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA)(?![A-Za-z0-9])/.test(syntax)) {
      throw new UploadValidationError("UNSAFE_DOCUMENT", "Active or embedded PDF content is not supported. Export a flattened PDF.");
    }
  }
  if (mimeType === "image/png" && (buffer.length < 20 || buffer.subarray(-8, -4).toString("ascii") !== "IEND")) {
    throw new UploadValidationError("INVALID_FILE_SIGNATURE", "This PNG is incomplete or damaged.");
  }
  return { fileName, mimeType, extension: validExtension, size: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}
