import { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { AIProcessingError, providerError, type AuthorizedOCRInput, type OCRDocument, type OCRProvider } from "./types";

export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";

export type MistralOCRRequest = {
  model: string;
  document: { type: "document_url"; documentUrl: string } | { type: "image_url"; imageUrl: string };
  includeImageBase64: false;
};
type OCRTransport = (request: MistralOCRRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;

const responseSchema = z.object({
  model: z.string().optional(),
  pages: z.array(z.object({
    index: z.number().int().nonnegative(),
    markdown: z.string(),
  })),
});

/** Mistral indexes full-document OCR pages from zero; application page numbers start at one. */
export function normalizeOCRResponse(documentId: string, response: unknown, model = DEFAULT_OCR_MODEL): OCRDocument {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new AIProcessingError("OCR_INVALID_RESPONSE", "The OCR provider returned an invalid page response.", true);
  const pages = [...parsed.data.pages].sort((a, b) => a.index - b.index);
  if (pages.length === 0 || pages.every((page) => page.markdown.trim() === "")) {
    throw new AIProcessingError("OCR_EMPTY_DOCUMENT", "No readable text was found. Upload a readable PDF or image.");
  }
  if (pages.some((page, index) => page.index !== index)) {
    throw new AIProcessingError("OCR_MISSING_PAGES", "The OCR response has missing or duplicate pages. Retry document analysis.", true);
  }
  return {
    documentId,
    provider: "mistral",
    model: parsed.data.model ?? model,
    pages: pages.map((page) => ({ pageNumber: page.index + 1, markdown: page.markdown })),
  };
}

export class MistralOCRProvider implements OCRProvider {
  private readonly model: string;
  private readonly transport?: OCRTransport;
  private readonly apiKey?: string;

  constructor(options: { model?: string; apiKey?: string; transport?: OCRTransport } = {}) {
    this.model = options.model ?? process.env.MISTRAL_OCR_MODEL ?? DEFAULT_OCR_MODEL;
    this.apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
    this.transport = options.transport;
  }

  async recognize(input: AuthorizedOCRInput): Promise<OCRDocument> {
    input.signal?.throwIfAborted();
    // The worker supplies a tenant-scoped loader. Never resolve a client-supplied object URL.
    const file = await input.loadFile();
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > 20 * 1024 * 1024) {
      throw new AIProcessingError("OCR_INVALID_FILE_SIZE", "Document must be between 1 byte and 20 MB.");
    }
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.mimeType)) {
      throw new AIProcessingError("OCR_INVALID_FILE_TYPE", "Only PDF, PNG and JPEG documents can be analyzed.");
    }
    const encoded = `data:${file.mimeType};base64,${file.bytes.toString("base64")}`;
    const request: MistralOCRRequest = {
      model: this.model,
      document: file.mimeType === "application/pdf"
        ? { type: "document_url", documentUrl: encoded }
        : { type: "image_url", imageUrl: encoded },
      // Default table handling keeps tables inline in each page's Markdown.
      includeImageBase64: false,
    };
    if (!this.transport && !this.apiKey) {
      throw new AIProcessingError("MISTRAL_NOT_CONFIGURED", "Mistral API credentials are not configured.");
    }
    try {
      const response = this.transport
        ? await this.transport(request, { signal: input.signal })
        : await new Mistral({ apiKey: this.apiKey }).ocr.process(request, {
          timeoutMs: 180_000,
          signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
        });
      return normalizeOCRResponse(input.documentId, response, this.model);
    } catch (error) {
      throw providerError(error, "OCR");
    }
  }
}
