import { randomUUID } from "node:crypto";
import { z } from "zod";
import { data, limitedBody, tenantRoute } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { auditLogs, documents } from "@/lib/db/schema";
import { getDocument, getProject } from "@/lib/repository";
import { deleteDocumentFile, putDocumentFile } from "@/lib/storage";
import { MAX_DOCUMENT_BYTES, validateUpload } from "@/lib/upload-validation";
export const runtime = "nodejs";
export const POST = tenantRoute(async (request, ctx) => {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;")) throw new AppError(400, "INVALID_CONTENT_TYPE", "Upload the document using multipart form data.");
  const body = await limitedBody(request, MAX_DOCUMENT_BYTES + 64 * 1024);
  const form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData();
  if (form.getAll("file").length !== 1 || [...form.keys()].some(key => !["file", "projectId"].includes(key))) throw new AppError(400, "INVALID_INPUT", "Upload one file at a time.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "FILE_REQUIRED", "Choose a document to upload.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = validateUpload(file, bytes);
  const projectValue = form.get("projectId");
  const projectId = projectValue ? z.uuid().parse(projectValue) : null;
  if (projectId) await getProject(ctx, projectId);
  const id = randomUUID();
  const storageKey = await putDocumentFile({ organizationId: ctx.organizationId, documentId: id, bytes, mimeType: validated.mimeType, extension: validated.extension });
  try {
    await getDb().transaction(async tx => {
      await tx.insert(documents).values({ id, organizationId: ctx.organizationId, projectId, uploadedBy: ctx.userId, fileName: validated.fileName, mimeType: validated.mimeType, size: validated.size, sha256: validated.sha256, storageKey });
      await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, documentId: id, action: "document.uploaded", details: { size: validated.size, mimeType: validated.mimeType } });
    });
  } catch (error) {
    await deleteDocumentFile({ organizationId: ctx.organizationId, documentId: id, storageKey }).catch(() => { console.error(JSON.stringify({ event: "storage_compensation_failed", code: "ORPHAN_CLEANUP_REQUIRED" })); });
    throw error;
  }
  return data(await getDocument(ctx, id), 201);
}, { bucket: "upload", limit: 10 });
