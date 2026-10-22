import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLogs, documentFieldEvidence, documentPages, documentProcessingJobs, documents, extractedDocuments, extractedLineItems, member, organizations } from "@/lib/db/schema";
import { AIProcessingError } from "@/lib/ai/types";
import { flattenEvidence } from "@/lib/ai/extraction-schema";
import { ANALYSIS_QUEUE, type AnalysisJobData } from "./queue";
import type { AnalysisJob, AnalysisRepository } from "./processor";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
const docScope = (data: AnalysisJobData) => and(eq(documents.id, data.documentId), eq(documents.organizationId, data.organizationId), eq(documents.processingVersion, data.processingVersion));
const jobScope = (job: AnalysisJob) => and(eq(documentProcessingJobs.id, job.data.processingJobId), eq(documentProcessingJobs.documentId, job.data.documentId), eq(documentProcessingJobs.organizationId, job.data.organizationId), eq(documentProcessingJobs.processingVersion, job.data.processingVersion));

async function requirePermission(tx: Tx, data: AnalysisJobData) {
  if (process.env.AI_PROCESSING_ENABLED !== "true") throw new AIProcessingError("AI_PROCESSING_DISABLED", "AI processing has been disabled by the deployment administrator.");
  const [organization] = await tx.select({ enabled: organizations.aiProcessingEnabled }).from(organizations).where(eq(organizations.id, data.organizationId)).for("share");
  const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, data.organizationId), eq(member.userId, data.requestedBy))).for("share");
  if (!organization?.enabled || !membership) throw new AIProcessingError("AI_PROCESSING_NOT_AUTHORIZED", "Document processing permission has been revoked. Ask an organization administrator to review settings.");
}

async function holdsClaim(tx: Tx, job: AnalysisJob) {
  // Pinned pg-boss 12 schema. Lock its exact attempt so a recovered worker cannot race this commit.
  // No document content is read from or written into the queue payload.
  const result = await tx.execute(sql`select id from pgboss.job where name = ${ANALYSIS_QUEUE} and id = ${job.id}::uuid and state = 'active' and retry_count = ${job.retryCount} for update`);
  return result.rows.length === 1;
}

export const analysisRepository: AnalysisRepository = {
  async begin(job) {
    return getDb().transaction(async tx => {
      if (!await holdsClaim(tx, job)) return null;
      const [document] = await tx.select().from(documents).where(docScope(job.data)).for("update");
      if (!document || document.approvedAt || ["completed", "review_required"].includes(document.status)) return null;
      const [appJob] = await tx.select().from(documentProcessingJobs).where(jobScope(job)).for("update");
      if (!appJob || appJob.bossJobId !== job.id || appJob.status === "completed") return null;
      await tx.update(documentProcessingJobs).set({ status: "processing", attempt: job.retryCount + 1, lastError: null, updatedAt: new Date() }).where(jobScope(job));
      await tx.update(documents).set({ status: "processing", errorCode: null, lastError: null, updatedAt: new Date() }).where(docScope(job.data));
      return { organizationId: document.organizationId, documentId: document.id, storageKey: document.storageKey, mimeType: document.mimeType };
    });
  },
  async ensureAuthorized(data) { await getDb().transaction(tx => requirePermission(tx, data)); },
  async save(job, ocr, extraction) {
    return getDb().transaction(async tx => {
      if (!await holdsClaim(tx, job)) return false;
      const [document] = await tx.select().from(documents).where(docScope(job.data)).for("update");
      const [appJob] = await tx.select().from(documentProcessingJobs).where(jobScope(job)).for("update");
      if (!document || document.approvedAt || document.status !== "processing" || appJob?.attempt !== job.retryCount + 1) return false;
      await requirePermission(tx, job.data);
      const [existing] = await tx.select({ id: extractedDocuments.id }).from(extractedDocuments).where(and(eq(extractedDocuments.documentId, job.data.documentId), eq(extractedDocuments.organizationId, job.data.organizationId))).limit(1);
      if (existing) throw new AIProcessingError("ANALYSIS_EXISTS", "An existing analysis cannot be overwritten.");
      const scope = { documentId: job.data.documentId, organizationId: job.data.organizationId };
      await tx.insert(documentPages).values(ocr.pages.map(page => ({ ...scope, pageNumber: page.pageNumber, markdown: page.markdown })));
      await tx.insert(extractedDocuments).values({ ...scope, documentType: extraction.data.documentType.value, originalData: extraction.data, provider: extraction.provider, ocrModel: ocr.model, extractionModel: extraction.model, issues: extraction.issues, reviewStatus: "pending" });
      if (extraction.data.products.length) await tx.insert(extractedLineItems).values(extraction.data.products.map((data, position) => ({ ...scope, position, data })));
      const evidence = flattenEvidence(extraction.data);
      if (evidence.length) await tx.insert(documentFieldEvidence).values(evidence.map(field => ({ ...scope, path: field.path, value: field.value, originalText: field.originalText, pageNumber: field.pageNumber, status: field.status })));
      await tx.update(documents).set({ status: extraction.reviewRequired ? "review_required" : "completed", pageCount: ocr.pages.length, errorCode: null, lastError: null, updatedAt: new Date() }).where(docScope(job.data));
      await tx.update(documentProcessingJobs).set({ status: "completed", lastError: null, updatedAt: new Date() }).where(jobScope(job));
      await tx.insert(auditLogs).values({ ...scope, action: "document.analysis_completed", details: { processingJobId: job.data.processingJobId, processingVersion: job.data.processingVersion, pageCount: ocr.pages.length, reviewRequired: extraction.reviewRequired } });
      return true;
    });
  },
  async fail(job, error, retry) {
    await getDb().transaction(async tx => {
      if (!await holdsClaim(tx, job)) return;
      const [document] = await tx.select().from(documents).where(docScope(job.data)).for("update");
      if (!document || document.approvedAt || ["completed", "review_required"].includes(document.status)) return;
      await tx.update(documentProcessingJobs).set({ status: retry ? "queued" : "failed", attempt: job.retryCount + 1, lastError: error.message, updatedAt: new Date() }).where(jobScope(job));
      await tx.update(documents).set({ status: retry ? "queued" : "failed", errorCode: error.code, lastError: error.message, updatedAt: new Date() }).where(docScope(job.data));
      await tx.insert(auditLogs).values({ organizationId: job.data.organizationId, documentId: job.data.documentId, action: retry ? "document.analysis_retry_scheduled" : "document.analysis_failed", details: { processingJobId: job.data.processingJobId, attempt: job.retryCount + 1, code: error.code } });
    });
  },
};
