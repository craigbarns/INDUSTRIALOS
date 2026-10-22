import { describe, expect, it, vi } from "vitest";
import { MistralOCRProvider, normalizeOCRResponse } from "../src/lib/ai/mistral-ocr";
import { AIProcessingError } from "../src/lib/ai/types";

const documentId = "fdc45a27-8774-478d-8b41-3484674dd67b";

describe("Mistral OCR normalization and private input", () => {
  it("preserves page boundaries, tables and zero-based page references", () => {
    const result = normalizeOCRResponse(documentId, {
      model: "mistral-ocr-test",
      pages: [{ index: 1, markdown: "Second page" }, { index: 0, markdown: "# Quotation\n| Item | Price |\n| A | 0.85 |" }],
    });
    expect(result.pages).toEqual([
      { pageNumber: 1, markdown: "# Quotation\n| Item | Price |\n| A | 0.85 |" },
      { pageNumber: 2, markdown: "Second page" },
    ]);
    expect(result.documentId).toBe(documentId);
    expect(result.model).toBe("mistral-ocr-test");
  });

  it.each([{ pages: [] }, { pages: [{ index: 0, markdown: "  " }] }])("rejects empty OCR documents", (response) => {
    expect(() => normalizeOCRResponse(documentId, response)).toThrowError(expect.objectContaining({ code: "OCR_EMPTY_DOCUMENT", retryable: false }));
  });

  it.each([
    [{ index: 0, markdown: "a" }, { index: 2, markdown: "b" }],
    [{ index: 0, markdown: "a" }, { index: 0, markdown: "b" }],
    [{ index: 1, markdown: "first page missing" }],
  ])("rejects missing or duplicate page references", (...pages) => {
    expect(() => normalizeOCRResponse(documentId, { pages })).toThrowError(expect.objectContaining({ code: "OCR_MISSING_PAGES", retryable: true }));
  });

  it("rejects malformed provider pages", () => {
    expect(() => normalizeOCRResponse(documentId, { pages: [{ markdown: "no page index" }] })).toThrowError(expect.objectContaining({ code: "OCR_INVALID_RESPONSE" }));
  });

  it("retrieves private PDF bytes from the authorized loader and uses supported inline base64", async () => {
    const transport = vi.fn().mockResolvedValue({ pages: [{ index: 0, markdown: "Quotation" }] });
    const loader = vi.fn().mockResolvedValue({ bytes: Buffer.from("%PDF-test"), mimeType: "application/pdf" });
    const result = await new MistralOCRProvider({ transport }).recognize({ documentId, loadFile: loader });
    expect(loader).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      model: "mistral-ocr-latest",
      document: { type: "document_url", documentUrl: `data:application/pdf;base64,${Buffer.from("%PDF-test").toString("base64")}` },
      includeImageBase64: false,
    }), { signal: undefined });
    expect(result.documentId).toBe(documentId);
  });

  it("sends images using image_url without making storage public", async () => {
    const transport = vi.fn().mockResolvedValue({ pages: [{ index: 0, markdown: "Image quotation" }] });
    await new MistralOCRProvider({ transport }).recognize({
      documentId, loadFile: async () => ({ bytes: Buffer.from("image"), mimeType: "image/png" }),
    });
    expect(transport.mock.calls[0]![0].document).toEqual({ type: "image_url", imageUrl: "data:image/png;base64,aW1hZ2U=" });
  });

  it("does not call the provider after the authorized file load fails", async () => {
    const transport = vi.fn();
    await expect(new MistralOCRProvider({ transport }).recognize({
      documentId, loadFile: async () => { throw new Error("unauthorized"); },
    })).rejects.toThrow("unauthorized");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects oversized documents before sending data to Mistral", async () => {
    const transport = vi.fn();
    await expect(new MistralOCRProvider({ transport }).recognize({
      documentId, loadFile: async () => ({ bytes: Buffer.alloc(20 * 1024 * 1024 + 1), mimeType: "application/pdf" }),
    })).rejects.toMatchObject({ code: "OCR_INVALID_FILE_SIZE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([{ statusCode: 429 }, { statusCode: 500 }])("marks transient provider failures retryable without exposing payloads", async (failure) => {
    const provider = new MistralOCRProvider({ transport: async () => { throw { ...failure, message: "secret OCR payload" }; } });
    const error = await provider.recognize({ documentId, loadFile: async () => ({ bytes: Buffer.from("pdf"), mimeType: "application/pdf" }) }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIProcessingError);
    expect(error).toMatchObject({ code: "OCR_PROVIDER_FAILURE", retryable: true });
    expect(String(error)).not.toContain("secret");
  });

  it("does not classify authentication failures as retryable", async () => {
    const provider = new MistralOCRProvider({ transport: async () => { throw { statusCode: 401 }; } });
    await expect(provider.recognize({ documentId, loadFile: async () => ({ bytes: Buffer.from("pdf"), mimeType: "application/pdf" }) })).rejects.toMatchObject({ retryable: false });
  });

  it("passes the worker cancellation signal through to the provider", async () => {
    const controller = new AbortController();
    const transport = vi.fn().mockResolvedValue({ pages: [{ index: 0, markdown: "a" }] });
    await new MistralOCRProvider({ transport }).recognize({ documentId, signal: controller.signal, loadFile: async () => ({ bytes: Buffer.from("pdf"), mimeType: "application/pdf" }) });
    expect(transport.mock.calls[0]![1].signal).toBe(controller.signal);
  });
});
