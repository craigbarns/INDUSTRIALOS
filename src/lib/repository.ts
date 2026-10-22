import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { auditLogs, documentPages, documents, extractedDocuments, extractedLineItems, procurementProjects, user } from "./db/schema";
import { isAdministrator, type TenantContext } from "./authorization";
import { AppError } from "./errors";
import { deleteDocumentFile } from "./storage";
import { flattenEvidence, procurementExtractionSchema } from "./ai/extraction-schema";
import { applyCorrections, approvalIssues, correctionsSchema } from "./ai/corrections";

export const createProjectSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(5000).nullable().optional() }).strict();
export const updateProjectSchema = createProjectSchema.partial().extend({ status: z.enum(["active", "completed", "archived"]).optional() }).refine(v => Object.keys(v).length > 0);
export const correctionRequestSchema = z.object({ version: z.number().int().positive(), corrections: correctionsSchema }).strict();
export const approvalRequestSchema = z.object({ version: z.number().int().positive() }).strict();

// Every application query is scoped with the server-validated context, never request organizationId.
const documentColumns = getTableColumns(documents);
const { storageKey: _storageKey, sha256: _sha256, lastError: _lastError, ...publicDocumentColumns } = documentColumns;
void _storageKey; void _sha256; void _lastError;
type Database = ReturnType<typeof getDb>;
export async function listProjects(ctx: TenantContext, db: Database = getDb()) {
  return db.select().from(procurementProjects).where(eq(procurementProjects.organizationId, ctx.organizationId)).orderBy(desc(procurementProjects.updatedAt)).limit(1000);
}
export async function getProject(ctx: TenantContext, id: string, db: Database = getDb()) {
  const [project] = await db.select().from(procurementProjects).where(and(eq(procurementProjects.id, id), eq(procurementProjects.organizationId, ctx.organizationId))).limit(1);
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found.");
  return project;
}
export async function createProject(ctx: TenantContext, input: z.infer<typeof createProjectSchema>, db: Database = getDb()) {
  const validated = createProjectSchema.parse(input);
  return db.transaction(async tx => {
    const [project] = await tx.insert(procurementProjects).values({ ...validated, organizationId: ctx.organizationId }).returning();
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, action: "project.created", details: { projectId: project.id } });
    return project;
  });
}
export async function updateProject(ctx: TenantContext, id: string, input: z.infer<typeof updateProjectSchema>, db: Database = getDb()) {
  const validated = updateProjectSchema.parse(input);
  return db.transaction(async tx => {
    const [project] = await tx.update(procurementProjects).set({ ...validated, updatedAt: new Date() }).where(and(eq(procurementProjects.id, id), eq(procurementProjects.organizationId, ctx.organizationId))).returning();
    if (!project) throw new AppError(404, "NOT_FOUND", "Project not found.");
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, action: "project.updated", details: { projectId: project.id, fields: Object.keys(validated), status: validated.status } });
    return project;
  });
}
export async function listDocuments(ctx: TenantContext, projectId?: string, db: Database = getDb()) {
  return db.select(publicDocumentColumns).from(documents).where(and(eq(documents.organizationId, ctx.organizationId), projectId ? eq(documents.projectId, projectId) : undefined)).orderBy(desc(documents.createdAt)).limit(1000);
}
export async function getDocument(ctx: TenantContext, id: string, db: Database = getDb()) {
  const [document] = await db.select(publicDocumentColumns).from(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId))).limit(1);
  if (!document) throw new AppError(404, "NOT_FOUND", "Document not found.");
  return document;
}
export async function getDocumentReference(ctx: TenantContext, id: string, db: Database = getDb()) {
  const [document] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId))).limit(1);
  if (!document) throw new AppError(404, "NOT_FOUND", "Document not found.");
  return document;
}
export async function deleteDocument(ctx: TenantContext, id: string, db: Database = getDb()) {
  const document = await getDocumentReference(ctx, id, db);
  if (!isAdministrator(ctx) && document.uploadedBy !== ctx.userId) throw new AppError(403, "FORBIDDEN", "Only the person who uploaded this document or an organization administrator can delete it.");
  // The private file goes first: object deletion is idempotent, so a failed metadata step can simply be retried,
  // and a document is never reported deleted while its file remains in storage.
  await deleteDocumentFile({ organizationId: ctx.organizationId, documentId: document.id, storageKey: document.storageKey });
  await db.transaction(async tx => {
    // Pages, analysis, line items, evidence and processing jobs cascade. Audit records keep the document ID.
    const [deleted] = await tx.delete(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId))).returning({ id: documents.id });
    if (!deleted) throw new AppError(404, "NOT_FOUND", "Document not found.");
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, documentId: id, action: "document.deleted", details: { fileName: document.fileName, projectId: document.projectId, status: document.status, approved: Boolean(document.approvedAt) } });
  });
  return { id };
}
export async function dashboard(ctx: TenantContext, db: Database = getDb()) {
  const [projectCounts, docCounts, recentProjects, recentDocuments] = await Promise.all([
    db.select({ count: sql<number>`count(*)::integer` }).from(procurementProjects).where(and(eq(procurementProjects.organizationId, ctx.organizationId), eq(procurementProjects.status, "active"))),
    db.select({ total: sql<number>`count(*)::integer`, analyzed: sql<number>`count(*) filter (where ${documents.status} in ('completed','review_required'))::integer`, review: sql<number>`count(*) filter (where ${documents.status} = 'review_required')::integer` }).from(documents).where(eq(documents.organizationId, ctx.organizationId)),
    db.select().from(procurementProjects).where(eq(procurementProjects.organizationId, ctx.organizationId)).orderBy(desc(procurementProjects.updatedAt)).limit(5),
    db.select(publicDocumentColumns).from(documents).where(eq(documents.organizationId, ctx.organizationId)).orderBy(desc(documents.updatedAt)).limit(6),
  ]);
  return { metrics: { activeProjects: projectCounts[0].count, totalDocuments: docCounts[0].total, analyzedDocuments: docCounts[0].analyzed, reviewRequired: docCounts[0].review }, recentProjects, recentDocuments };
}
export async function getExtraction(ctx: TenantContext, id: string, db: Database = getDb()) {
  await getDocument(ctx, id, db);
  const [extraction] = await db.select().from(extractedDocuments).where(and(eq(extractedDocuments.documentId, id), eq(extractedDocuments.organizationId, ctx.organizationId))).limit(1);
  if (!extraction) throw new AppError(404, "EXTRACTION_NOT_READY", "The analysis is not ready yet.");
  const current = procurementExtractionSchema.parse(extraction.correctedData ?? extraction.originalData);
  const [pages, logs] = await Promise.all([
    db.select({ pageNumber: documentPages.pageNumber, markdown: documentPages.markdown }).from(documentPages).where(and(eq(documentPages.documentId, id), eq(documentPages.organizationId, ctx.organizationId))).orderBy(documentPages.pageNumber),
    db.select({ id: auditLogs.id, action: auditLogs.action, details: auditLogs.details, createdAt: auditLogs.createdAt, actorName: user.name }).from(auditLogs).leftJoin(user, eq(auditLogs.userId, user.id)).where(and(eq(auditLogs.documentId, id), eq(auditLogs.organizationId, ctx.organizationId))).orderBy(desc(auditLogs.createdAt)).limit(100),
  ]);
  return { data: current, originalData: extraction.originalData, fields: flattenEvidence(current), version: extraction.version, approvedAt: extraction.approvedAt, issues: extraction.issues, approvalIssues: approvalIssues(current), pages, corrections: logs.map(log => ({ ...log, changes: (log.details as { changes?: unknown }).changes })) };
}
export async function correctExtraction(ctx: TenantContext, id: string, input: z.infer<typeof correctionRequestSchema>, db: Database = getDb()) {
  const parsed = correctionRequestSchema.parse(input);
  await db.transaction(async tx => {
    const [extraction] = await tx.select().from(extractedDocuments).where(and(eq(extractedDocuments.documentId, id), eq(extractedDocuments.organizationId, ctx.organizationId))).for("update");
    if (!extraction) throw new AppError(404, "NOT_FOUND", "Analysis not found.");
    if (extraction.version !== parsed.version) throw new AppError(409, "VERSION_CONFLICT", "Another person updated this analysis. Reload it before saving.");
    const original = procurementExtractionSchema.parse(extraction.originalData);
    const current = procurementExtractionSchema.parse(extraction.correctedData ?? original);
    const changed = applyCorrections(current, original, parsed.corrections);
    await tx.update(extractedDocuments).set({ correctedData: changed.data, version: extraction.version + 1, reviewStatus: "pending", approvedAt: null, approvedBy: null, updatedAt: new Date() }).where(and(eq(extractedDocuments.documentId, id), eq(extractedDocuments.organizationId, ctx.organizationId)));
    await tx.update(documents).set({ status: "review_required", approvedAt: null, updatedAt: new Date() }).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId)));
    // Evidence table keeps the immutable original AI evidence; corrected JSON is a separate layer.
    await tx.delete(extractedLineItems).where(and(eq(extractedLineItems.documentId, id), eq(extractedLineItems.organizationId, ctx.organizationId)));
    if (changed.data.products.length) await tx.insert(extractedLineItems).values(changed.data.products.map((product, position) => ({ documentId: id, organizationId: ctx.organizationId, position, data: product })));
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, documentId: id, action: "extraction.corrected", details: { previousVersion: extraction.version, version: extraction.version + 1, changes: changed.changes } });
  });
  return getExtraction(ctx, id, db);
}
export async function approveExtraction(ctx: TenantContext, id: string, input: z.infer<typeof approvalRequestSchema>, db: Database = getDb()) {
  const parsed = approvalRequestSchema.parse(input);
  await db.transaction(async tx => {
    const [extraction] = await tx.select().from(extractedDocuments).where(and(eq(extractedDocuments.documentId, id), eq(extractedDocuments.organizationId, ctx.organizationId))).for("update");
    if (!extraction) throw new AppError(404, "NOT_FOUND", "Analysis not found.");
    if (extraction.version !== parsed.version) throw new AppError(409, "VERSION_CONFLICT", "The analysis changed. Reload it before approving.");
    if (extraction.approvedAt) return;
    const current = procurementExtractionSchema.parse(extraction.correctedData ?? extraction.originalData);
    const issues = approvalIssues(current);
    if (issues.length) throw new AppError(422, "REVIEW_REQUIRED", "Resolve uncertain fields and missing price or quantity units before approval.");
    const approvedAt = new Date();
    await tx.update(extractedDocuments).set({ version: extraction.version + 1, reviewStatus: "approved", approvedAt, approvedBy: ctx.userId, updatedAt: approvedAt }).where(and(eq(extractedDocuments.documentId, id), eq(extractedDocuments.organizationId, ctx.organizationId)));
    await tx.update(documents).set({ status: "completed", approvedAt, updatedAt: approvedAt }).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId)));
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, documentId: id, action: "extraction.approved", details: { version: extraction.version + 1 } });
  });
  return getExtraction(ctx, id, db);
}
