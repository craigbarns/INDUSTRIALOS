import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import { getDb } from "@/lib/db";
import { auditLogs, documentProcessingJobs, documents, member, organizations } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export const ANALYSIS_QUEUE = "document-analysis";
export const ANALYSIS_RETRY_LIMIT = 3;
export const ANALYSIS_QUEUE_OPTIONS = {
  policy: "exclusive", retryLimit: ANALYSIS_RETRY_LIMIT, retryDelay: 30,
  retryBackoff: true, retryDelayMax: 300, heartbeatSeconds: 60,
  expireInSeconds: 900, retentionSeconds: 604800, deleteAfterSeconds: 604800,
} as const;
export interface AnalysisJobData { organizationId: string; documentId: string; processingJobId: string; processingVersion: number; requestedBy: string }

let activeQueue: Promise<PgBoss> | undefined;
function createQueue(options: { worker?: boolean; migrate?: boolean } = {}) {
  if (!process.env.DATABASE_URL) throw new AppError(503, "SETUP_REQUIRED", "Configure PostgreSQL before starting document processing.");
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss", migrate: options.migrate ?? false, supervise: options.worker ?? false, schedule: false, application_name: options.worker ? "industrial-os-worker" : "industrial-os-producer", max: 4 });
  boss.on("error", () => { console.error(JSON.stringify({ event: "job_queue_error", code: "QUEUE_UNAVAILABLE" })); });
  return boss;
}
export async function initializeJobQueue(): Promise<void> {
  const boss = createQueue({ migrate: true });
  try { await boss.start(); await boss.createQueue(ANALYSIS_QUEUE, ANALYSIS_QUEUE_OPTIONS); await boss.updateQueue(ANALYSIS_QUEUE, ANALYSIS_QUEUE_OPTIONS); }
  finally { await boss.stop({ graceful: true, timeout: 10000 }); }
}
export function getJobQueue(options: { worker?: boolean } = {}): Promise<PgBoss> {
  if (!activeQueue) {
    activeQueue = (async () => {
      const boss = createQueue(options);
      try { await boss.start(); return boss; }
      catch { await boss.stop().catch(() => undefined); activeQueue = undefined; throw new AppError(503, "QUEUE_UNAVAILABLE", "Document processing is unavailable. Check database migrations and worker configuration."); }
    })();
  }
  return activeQueue;
}
export async function stopJobQueue(): Promise<void> {
  const pending = activeQueue;
  activeQueue = undefined;
  if (pending) await (await pending).stop({ graceful: true, timeout: 25000 });
}

/** Authorization is checked again here, inside the transaction which enqueues the job. */
export async function enqueueDocumentAnalysis(context: { organizationId: string; userId: string }, documentId: string) {
  if (process.env.AI_PROCESSING_ENABLED !== "true") throw new AppError(403, "AI_PROCESSING_DISABLED", "AI processing must be enabled by the deployment administrator.");
  const boss = await getJobQueue();
  return getDb().transaction(async tx => {
    const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.organizationId, context.organizationId), eq(member.userId, context.userId))).limit(1);
    if (!membership) throw new AppError(403, "FORBIDDEN", "Organization membership is required.");
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, context.organizationId)).limit(1);
    if (!organization?.aiProcessingEnabled) throw new AppError(403, "AI_PROCESSING_DISABLED", "Your organization must authorize Mistral document processing in settings first.");
    const [document] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.organizationId, context.organizationId))).for("update");
    if (!document) throw new AppError(404, "NOT_FOUND", "Document not found.");
    if (document.status === "queued" || document.status === "processing") {
      const [existing] = await tx.select().from(documentProcessingJobs).where(and(eq(documentProcessingJobs.documentId, document.id), eq(documentProcessingJobs.organizationId, context.organizationId), eq(documentProcessingJobs.processingVersion, document.processingVersion))).limit(1);
      if (!existing) throw new AppError(409, "JOB_STATE_CONFLICT", "The processing state requires administrator review.");
      return { jobId: existing.id, documentId: document.id, status: document.status, duplicate: true };
    }
    if (document.approvedAt || document.status === "completed" || document.status === "review_required") throw new AppError(409, "ANALYSIS_EXISTS", "Review the existing analysis. Completed analyses cannot be overwritten.");
    const processingVersion = document.processingVersion + 1;
    const processingJobId = randomUUID();
    const data: AnalysisJobData = { organizationId: context.organizationId, documentId, processingJobId, processingVersion, requestedBy: context.userId };
    const bossJobId = await boss.send(ANALYSIS_QUEUE, data, { ...ANALYSIS_QUEUE_OPTIONS, singletonKey: `${context.organizationId}:${documentId}`, group: { id: context.organizationId }, db: fromDrizzle(tx, sql) });
    if (!bossJobId) throw new AppError(409, "ANALYSIS_QUEUED", "An analysis is already queued for this document. Please wait for it to finish.");
    await tx.insert(documentProcessingJobs).values({ id: processingJobId, documentId, organizationId: context.organizationId, processingVersion, bossJobId, status: "queued" });
    await tx.update(documents).set({ status: "queued", processingVersion, errorCode: null, lastError: null, updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.organizationId, context.organizationId)));
    await tx.insert(auditLogs).values({ organizationId: context.organizationId, userId: context.userId, documentId, action: "document.analysis_queued", details: { processingJobId, processingVersion } });
    return { jobId: processingJobId, documentId, status: "queued" as const, duplicate: false };
  });
}
