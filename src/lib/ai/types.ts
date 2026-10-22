/** Provider boundaries deliberately contain no application database or storage dependencies. */
export interface OCRDocument {
  documentId: string;
  provider: string;
  model: string;
  pages: Array<{ pageNumber: number; markdown: string }>;
}

/** Only a server-side caller that has authorized the document can supply its loader. */
export interface AuthorizedOCRInput {
  documentId: string;
  signal?: AbortSignal;
  loadFile: () => Promise<{
    bytes: Buffer;
    mimeType: "application/pdf" | "image/png" | "image/jpeg";
  }>;
}

export interface OCRProvider {
  recognize(input: AuthorizedOCRInput): Promise<OCRDocument>;
}

export interface ExtractionProvider<T> {
  extract(document: OCRDocument, options?: { signal?: AbortSignal }): Promise<T>;
}

/** Safe to persist or expose: never includes provider payloads, OCR text, or secrets. */
export class AIProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AIProcessingError";
  }
}

export function providerError(error: unknown, operation: "OCR" | "EXTRACTION") {
  if (error instanceof AIProcessingError) return error;
  const status = typeof error === "object" && error !== null && "statusCode" in error
    ? Number(error.statusCode)
    : typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : undefined;
  const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
  return new AIProcessingError(
    `${operation}_PROVIDER_FAILURE`,
    `${operation === "OCR" ? "Document recognition" : "Structured extraction"} provider failed. ${retryable ? "The background job will retry." : "Check the provider configuration or document and retry."}`,
    retryable,
  );
}
