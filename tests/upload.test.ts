import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, validateUpload } from "../src/lib/upload-validation";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const metadata = { name: "quotation.PDF", type: "application/pdf", size: pdf.length };

describe("secure document upload validation", () => {
  it("accepts a passive PDF and computes its content hash", () => {
    expect(validateUpload(metadata, pdf)).toMatchObject({ mimeType: "application/pdf", extension: "pdf", size: pdf.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it("rejects an invalid MIME type", () => expect(() => validateUpload({ ...metadata, type: "text/html" }, pdf)).toThrow("content type must match"));
  it("rejects an oversized file before reading content", () => expect(() => validateUpload({ ...metadata, size: MAX_DOCUMENT_BYTES + 1 }, pdf)).toThrow("20 MB"));
  it("checks actual length, not metadata", () => expect(() => validateUpload({ ...metadata, size: pdf.length + 1 }, pdf)).toThrow("size is invalid"));
  it("rejects a disguised executable", () => { const bytes = Buffer.from("MZ-this-is-not-a-pdf"); expect(() => validateUpload({ ...metadata, size: bytes.length }, bytes)).toThrow("contents do not match"); });
  it("rejects paths and null bytes in names", () => { for (const name of ["../quote.pdf", "folder\\quote.pdf", "quote\0.pdf"]) expect(() => validateUpload({ ...metadata, name }, pdf)).toThrow("filename"); });
  it("rejects embedded active PDF content", () => { const bytes = Buffer.from("%PDF-1.7\n<< /OpenAction << /JS (malicious) >> >>\n%%EOF"); expect(() => validateUpload({ ...metadata, size: bytes.length }, bytes)).toThrow("flattened PDF"); });
  it("accepts compressed data and open actions found in ordinary exported PDFs", () => {
    const noise = Buffer.from("q /aa 1 Tf /js 2 Tf /Encrypted Q");
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction [2 0 R /Fit] >> endobj\n2 0 obj << /Length 9 >> stream\n"), Buffer.from([0x78, 0x9c, 0x2f, 0x61, 0x61, 0x20, 0x2f, 0x4a, 0x53]), Buffer.from("\nendstream endobj\n3 0 obj << /Filter /FlateDecode >> stream\n"), deflateSync(noise), Buffer.from("\nendstream endobj\n%%EOF\n")]);
    expect(validateUpload({ ...metadata, size: bytes.length }, bytes).mimeType).toBe("application/pdf");
  });
  it("rejects JavaScript hidden in a compressed object stream", () => {
    const bytes = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << /Type /ObjStm /Filter /FlateDecode >> stream\n"), deflateSync(Buffer.from("<< /S /JavaScript /J#53 (app.alert(1)) >>")), Buffer.from("\nendstream endobj\n%%EOF\n")]);
    expect(() => validateUpload({ ...metadata, size: bytes.length }, bytes)).toThrow("flattened PDF");
  });
  it("rejects object streams it cannot read and oversized decompression", () => {
    const opaque = Buffer.from("%PDF-1.7\n1 0 obj << /Type /ObjStm /Filter /LZWDecode >> stream\nabc\nendstream endobj\n%%EOF\n");
    expect(() => validateUpload({ ...metadata, size: opaque.length }, opaque)).toThrow("internal encoding");
    const bomb = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj << /Filter /FlateDecode >> stream\n"), deflateSync(Buffer.alloc(65 * 1024 * 1024)), Buffer.from("\nendstream endobj\n%%EOF\n")]);
    expect(() => validateUpload({ ...metadata, size: bomb.length }, bomb)).toThrow("too much data");
  });
  it("explains that encrypted PDFs must be re-exported", () => {
    const bytes = Buffer.from("%PDF-1.7\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n");
    expect(() => validateUpload({ ...metadata, size: bytes.length }, bytes)).toThrow("password-protected");
  });
  it("rejects truncated PDFs and PNGs", () => {
    expect(() => validateUpload({ ...metadata, size: 9 }, Buffer.from("%PDF-1.7\n"))).toThrow("incomplete");
    const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
    expect(() => validateUpload({ name: "image.png", type: "image/png", size: bytes.length }, bytes)).toThrow("incomplete");
  });
  it("accepts PNG and JPEG signatures", () => {
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from([0,0,0,0]), Buffer.from("IEND"), Buffer.alloc(4)]);
    const jpeg = Buffer.from([255,216,255,224,0,0,255,217]);
    expect(validateUpload({ name: "a.png", type: "image/png", size: png.length }, png).mimeType).toBe("image/png");
    expect(validateUpload({ name: "a.jpeg", type: "image/jpeg", size: jpeg.length }, jpeg).extension).toBe("jpeg");
  });
  it("accepts JPEGs with scanner metadata or padding after the end marker", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]),
      Buffer.from("scanner metadata"),
      Buffer.alloc(128),
    ]);
    const result = validateUpload({ name: "scan.jpg", type: "image/jpeg", size: jpeg.length }, jpeg);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.size).toBe(jpeg.length);
  });
  it("rejects JPEGs without a nearby end marker", () => {
    for (const jpeg of [
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), Buffer.alloc(4096)]),
    ]) {
      expect(() => validateUpload({ name: "scan.jpg", type: "image/jpeg", size: jpeg.length }, jpeg))
        .toThrow("contents do not match");
    }
  });
});
