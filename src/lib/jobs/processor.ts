import type { JobWithMetadata } from "pg-boss";
import { AIProcessingError, type OCRDocument, type OCRProvider } from "@/lib/ai/types";
import type { ExtractionResult } from "@/lib/ai/procurement-extractor";
import { StorageError, type StoredDocumentReference } from "@/lib/storage";
import type { DocumentMimeType } from "@/lib/upload-validation";
import type { AnalysisJobData } from "./queue";

export type AnalysisJob = JobWithMetadata<AnalysisJobData>;
export interface ProcessingDocument extends StoredDocumentReference { mimeType: string }
export interface AnalysisRepository {
  begin(job: AnalysisJob): Promise<ProcessingDocument | null>;
  ensureAuthorized(data: AnalysisJobData): Promise<void>;
  save(job: AnalysisJob, ocr: OCRDocument, extraction: ExtractionResult): Promise<boolean>;
  fail(job: AnalysisJob, error: { code: string; message: string }, retry: boolean): Promise<void>;
}
export interface ProcessingDependencies {
  repository: AnalysisRepository;
  ocr: OCRProvider;
  extractor: { extract(document: OCRDocument, options?: { signal?: AbortSignal }): Promise<ExtractionResult> };
  loadFile(ref: StoredDocumentReference): Promise<{ bytes: Buffer; mimeType: DocumentMimeType }>;
}

/** At-least-once execution with fenced, idempotent persistence; no document text enters logs. */
export async function processDocumentJob(job: AnalysisJob, deps: ProcessingDependencies): Promise<{ status: "completed" | "deadletter"; code?: string }> {
  try {
    job.signal.throwIfAborted();
    const document = await deps.repository.begin(job);
    if (!document) return { status: "completed" }; // Duplicate, stale version, or an already committed result.
    await deps.repository.ensureAuthorized(job.data);
    const ocr = await deps.ocr.recognize({ documentId: document.documentId, loadFile: () => deps.loadFile(document), signal: job.signal });
    job.signal.throwIfAborted();
    await deps.repository.ensureAuthorized(job.data);
    const extraction = await deps.extractor.extract(ocr, { signal: job.signal });
    job.signal.throwIfAborted();
    await deps.repository.save(job, ocr, extraction);
    return { status: "completed" };
  } catch (error) {
    if (job.signal.aborted) return { status: "completed" }; // pg-boss discards settlement of a lost claim.
    const safe = error instanceof AIProcessingError
      ? error
      : error instanceof StorageError
        ? new AIProcessingError(error.code, error.message, error.code === "STORAGE_READ_FAILED")
        : new AIProcessingError("PROCESSING_FAILED", "Document processing failed. The worker will retry when possible.", true);
    const retry = safe.retryable && job.retryCount < job.retryLimit;
    try { await deps.repository.fail(job, { code: safe.code, message: safe.message }, retry); }
    catch { throw new AIProcessingError("PROCESSING_STATE_UNAVAILABLE", "The processing state could not be saved. The worker will retry.", true); }
    if (retry) throw safe;
    // pg-boss per-job settlement terminally fails this claim without retrying unsafe input.
    return { status: "deadletter", code: safe.code };
  }
}
