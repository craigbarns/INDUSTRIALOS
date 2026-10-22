import { describe, expect, it, vi } from "vitest";
import { AIProcessingError } from "../src/lib/ai/types";
import { processDocumentJob, type AnalysisJob, type ProcessingDependencies } from "../src/lib/jobs/processor";

const documentId = "a6c0773e-ed11-4bba-a7df-52cb668da374";
const ocrResult = { documentId, provider: "mistral" as const, model: "test-ocr", pages: [{ pageNumber: 1, markdown: "Supplier quotation" }] };
function setup() {
  const job = { id: "27f1d380-b86f-433e-b261-47f455479280", data: { documentId, organizationId: "org-a", processingJobId: "e102bbeb-bb20-4ede-bca4-25c9318c94f0", processingVersion: 1, requestedBy: "user-a" }, retryCount: 0, retryLimit: 3, signal: new AbortController().signal } as AnalysisJob;
  const extractionResult = { documentId, provider: "mistral" as const, model: "test-extractor", data: {} as never, reviewRequired: true, issues: [] };
  const deps: ProcessingDependencies = {
    repository: { begin: vi.fn().mockResolvedValue({ documentId, organizationId: "org-a", storageKey: `organizations/org-a/documents/${documentId}/source.pdf`, mimeType: "application/pdf" }), ensureAuthorized: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(true), fail: vi.fn().mockResolvedValue(undefined) },
    ocr: { recognize: vi.fn().mockResolvedValue(ocrResult) }, extractor: { extract: vi.fn().mockResolvedValue(extractionResult) }, loadFile: vi.fn().mockResolvedValue({ bytes: Buffer.from("%PDF"), mimeType: "application/pdf" }),
  };
  return { job, deps };
}

describe("durable analysis handler", () => {
  it("runs OCR and extraction separately then saves once", async () => { const { job, deps } = setup(); await processDocumentJob(job, deps); expect(deps.ocr.recognize).toHaveBeenCalledOnce(); expect(deps.extractor.extract).toHaveBeenCalledWith(ocrResult, { signal: job.signal }); expect(deps.repository.save).toHaveBeenCalledOnce(); });
  it("skips duplicate and stale committed jobs before provider use", async () => { const { job, deps } = setup(); vi.mocked(deps.repository.begin).mockResolvedValue(null); await processDocumentJob(job, deps); expect(deps.ocr.recognize).not.toHaveBeenCalled(); });
  it("rechecks permission between OCR and extraction", async () => { const { job, deps } = setup(); vi.mocked(deps.repository.ensureAuthorized).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AIProcessingError("PERMISSION_REVOKED", "Permission revoked.")); await processDocumentJob(job, deps); expect(deps.extractor.extract).not.toHaveBeenCalled(); expect(deps.repository.fail).toHaveBeenCalledWith(job, { code: "PERMISSION_REVOKED", message: "Permission revoked." }, false); });
  it("throws only safe errors on transient failures so pg-boss retries", async () => { const { job, deps } = setup(); vi.mocked(deps.ocr.recognize).mockRejectedValue(new Error("secret payload: supplier information")); await expect(processDocumentJob(job, deps)).rejects.toThrow("Document processing failed"); expect(deps.repository.fail).toHaveBeenCalledWith(job, expect.objectContaining({ code: "PROCESSING_FAILED" }), true); });
  it("finishes failed after the retry limit", async () => { const { job, deps } = setup(); job.retryCount = 3; vi.mocked(deps.ocr.recognize).mockRejectedValue(new AIProcessingError("OCR_PROVIDER_FAILURE", "Provider temporarily unavailable.", true)); expect(await processDocumentJob(job, deps)).toMatchObject({ status: "deadletter" }); expect(deps.repository.fail).toHaveBeenCalledWith(job, expect.anything(), false); });
  it("does not retry permanently invalid documents", async () => { const { job, deps } = setup(); vi.mocked(deps.ocr.recognize).mockRejectedValue(new AIProcessingError("OCR_EMPTY_DOCUMENT", "No readable text.")); await processDocumentJob(job, deps); expect(deps.repository.fail).toHaveBeenCalledWith(job, expect.anything(), false); });
  it("permits the next claimed attempt to recover after a worker restart", async () => { const { job, deps } = setup(); const controller = new AbortController(); controller.abort(); job.signal = controller.signal; await processDocumentJob(job, deps); expect(deps.repository.save).not.toHaveBeenCalled(); job.signal = new AbortController().signal; job.retryCount += 1; await processDocumentJob(job, deps); expect(deps.repository.save).toHaveBeenCalledOnce(); });
  it("sanitizes persistence errors before the queue stores a failure", async () => { const { job, deps } = setup(); vi.mocked(deps.ocr.recognize).mockRejectedValue(new Error("provider secret")); vi.mocked(deps.repository.fail).mockRejectedValue(new Error("SQL with document contents")); await expect(processDocumentJob(job, deps)).rejects.toThrow("processing state could not be saved"); });
  it("does not save after an abort during provider work", async () => { const { job, deps } = setup(); const controller = new AbortController(); job.signal = controller.signal; vi.mocked(deps.ocr.recognize).mockImplementation(async () => { controller.abort(); return ocrResult; }); await processDocumentJob(job, deps); expect(deps.extractor.extract).not.toHaveBeenCalled(); expect(deps.repository.fail).not.toHaveBeenCalled(); });
});
