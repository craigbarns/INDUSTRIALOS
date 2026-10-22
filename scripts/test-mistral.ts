import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { MistralOCRProvider } from "../src/lib/ai/mistral-ocr";
import { MistralProcurementExtractor } from "../src/lib/ai/procurement-extractor";
import { AIProcessingError } from "../src/lib/ai/types";
import { MAX_DOCUMENT_BYTES, validateUpload, UploadValidationError } from "../src/lib/upload-validation";

async function main() {
  // This script can incur charges and sends the explicitly chosen fixture to Mistral.
  if (process.env.RUN_MISTRAL_INTEGRATION !== "true" || process.env.AI_PROCESSING_ENABLED !== "true") {
    throw new Error("Real API tests are disabled. Set RUN_MISTRAL_INTEGRATION=true and AI_PROCESSING_ENABLED=true explicitly.");
  }
  if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY must be configured explicitly.");
  const fixture = process.argv[2] ?? process.env.MISTRAL_INTEGRATION_FIXTURE;
  if (!fixture) throw new Error("Provide an authorized, non-sensitive PDF, PNG or JPEG fixture path as the first argument or MISTRAL_INTEGRATION_FIXTURE. There is no default fixture.");
  const info = await stat(fixture);
  if (!info.isFile() || info.size < 1 || info.size > MAX_DOCUMENT_BYTES) throw new Error("Fixture must be a non-empty file of at most 20 MB.");
  const extension = extname(fixture).toLowerCase();
  const mime = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[extension];
  if (!mime) throw new Error("Only PDF, PNG and JPEG fixtures are supported.");
  const bytes = await readFile(fixture);
  const metadata = validateUpload({ name: basename(fixture), type: mime, size: bytes.length }, bytes);
  const documentId = randomUUID();
  const signal = AbortSignal.timeout(7 * 60_000);
  const ocr = await new MistralOCRProvider().recognize({ documentId, signal, loadFile: async () => ({ bytes, mimeType: metadata.mimeType }) });
  const extraction = await new MistralProcurementExtractor().extract(ocr, { signal });
  // Summaries only: never output document text, customer fields, secrets or provider payloads.
  console.log(JSON.stringify({ result: "passed", pages: ocr.pages.length, products: extraction.data.products.length, sourceValidationIssues: extraction.issues.length, humanReviewRequired: extraction.reviewRequired }));
}

main().catch((error: unknown) => {
  const message = error instanceof AIProcessingError || error instanceof UploadValidationError
    ? `${error.code}: ${error.message}`
    : error instanceof Error && !["ENOENT", "EACCES"].some((code) => "code" in error && error.code === code)
      ? error.message
      : "The integration fixture could not be read.";
  console.error(message);
  process.exitCode = 1;
});
