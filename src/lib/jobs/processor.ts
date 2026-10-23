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

/** Progress events carry identifiers, counts and durations only. */
function logProgress(job: AnalysisJob, event: string, startedAt: number, details: Record<string, string | number> = {}) {
  console.info(JSON.stringify({ event, documentId: job.data.documentId, jobId: job.id, attempt: job.retryCount + 1, elapsedMs: Date.now() - startedAt, ...details }));
}

/** At-least-once execution with fenced, idempotent persistence; no document text enters logs. */
export async function processDocumentJob(job: AnalysisJob, deps: ProcessingDependencies): Promise<{ status: "completed" | "deadletter"; code?: string }> {
  const startedAt = Date.now();
  try {
    job.signal.throwIfAborted();
    const document = await deps.repository.begin(job);
    if (!document) return { status: "completed" }; // Duplicate, stale version, or an already committed result.
    logProgress(job, "analysis_started", startedAt);
    await deps.repository.ensureAuthorized(job.data);
    const ocr = await deps.ocr.recognize({ documentId: document.documentId, loadFile: () => deps.loadFile(document), signal: job.signal });
    logProgress(job, "ocr_completed", startedAt, { pages: ocr.pages.length });
    job.signal.throwIfAborted();
    await deps.repository.ensureAuthorized(job.data);
    const extraction = await deps.extractor.extract(ocr, { signal: job.signal });
    logProgress(job, "extraction_completed", startedAt, { products: extraction.data?.products?.length ?? 0 });
    job.signal.throwIfAborted();
    await deps.repository.save(job, ocr, extraction);
    logProgress(job, "analysis_saved", startedAt);
    return { status: "completed" };
  } catch (error) {
    if (job.signal.aborted) { logProgress(job, "analysis_aborted", startedAt); return { status: "completed" }; } // pg-boss discards settlement of a lost claim.
    const safe = error instanceof AIProcessingError
      ? error
      : error instanceof StorageError
        ? new AIProcessingError(error.code, error.message, error.code === "STORAGE_READ_FAILED")
        : new AIProcessingError("PROCESSING_FAILED", "Document processing failed. The worker will retry when possible.", true);
    const retry = safe.retryable && job.retryCount < job.retryLimit;
    logProgress(job, "analysis_failed", startedAt, { code: safe.code, retry: String(retry) });
    try { await deps.repository.fail(job, { code: safe.code, message: safe.message }, retry); }
    catch { throw new AIProcessingError("PROCESSING_STATE_UNAVAILABLE", "The processing state could not be saved. The worker will retry.", true); }
    if (retry) throw safe;
    // pg-boss per-job settlement terminally fails this claim without retrying unsafe input.
    return { status: "deadletter", code: safe.code };
  }
}
