import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { StorageError, type StoredDocumentReference } from "@/lib/storage";
import { deleteDocument, getDocument } from "@/lib/repository";
import { addQuotation, migratedDatabase, type Database } from "../fixtures/quotations";

const removed: StoredDocumentReference[] = [];
let storageFailure = false;
vi.mock("@/lib/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    deleteDocumentFile: async (ref: StoredDocumentReference) => {
      if (storageFailure) throw new actual.StorageError("STORAGE_DELETE_FAILED", "The document could not be removed.");
      removed.push(ref);
    },
  };
});

const pg = new PGlite();
let database: Database;
const owner = { userId: "owner", organizationId: "org-a", role: "owner" };
const uploader = { userId: "uploader", organizationId: "org-a", role: "member" };
const colleague = { userId: "colleague", organizationId: "org-a", role: "member" };
const outsider = { userId: "outsider", organizationId: "org-b", role: "owner" };

async function uploadedBy(ctx: typeof owner, number: string) {
  const id = await addQuotation(database, ctx, { name: "Ningbo Plastics", number });
  await database.update(schema.documents).set({ uploadedBy: ctx.userId }).where(eq(schema.documents.id, id));
  await database.insert(schema.documentPages).values({ organizationId: ctx.organizationId, documentId: id, pageNumber: 1, markdown: "Ningbo Plastics" });
  await database.insert(schema.auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, documentId: id, action: "document.uploaded", details: {} });
  return id;
}

beforeAll(async () => { database = await migratedDatabase(pg, [owner, uploader, colleague, outsider]); }, 60000);
beforeEach(() => { removed.length = 0; storageFailure = false; });
afterAll(async () => { await pg.close(); });

describe("Document deletion", () => {
  it("lets the uploader delete the file, its analysis and pages while keeping the audit trail", async () => {
    const id = await uploadedBy(uploader, "U-1");
    expect(await deleteDocument(uploader, id, database)).toEqual({ id });
    expect(removed).toEqual([{ organizationId: "org-a", documentId: id, storageKey: `organizations/org-a/documents/${id}/source.pdf` }]);
    await expect(getDocument(uploader, id, database)).rejects.toMatchObject({ status: 404 });
    expect(await database.select().from(schema.extractedDocuments).where(eq(schema.extractedDocuments.documentId, id))).toEqual([]);
    expect(await database.select().from(schema.documentPages).where(eq(schema.documentPages.documentId, id))).toEqual([]);
    const audit = await database.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.documentId, id), eq(schema.auditLogs.organizationId, "org-a")));
    expect(audit.map(entry => entry.action).sort()).toEqual(["document.deleted", "document.uploaded"]);
    expect(audit.find(entry => entry.action === "document.deleted")).toMatchObject({ userId: "uploader", details: { fileName: "U-1.pdf", status: "review_required", approved: false } });
  });
  it("lets an administrator delete a colleague's document", async () => {
    const id = await uploadedBy(uploader, "U-2");
    await deleteDocument(owner, id, database);
    expect(removed.map(ref => ref.documentId)).toEqual([id]);
  });
  it("forbids other members from deleting someone else's document", async () => {
    const id = await uploadedBy(uploader, "U-3");
    await expect(deleteDocument(colleague, id, database)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(removed).toEqual([]);
    expect((await getDocument(uploader, id, database)).id).toBe(id);
  });
  it("hides documents of other organizations", async () => {
    const id = await uploadedBy(uploader, "U-4");
    await expect(deleteDocument(outsider, id, database)).rejects.toMatchObject({ status: 404 });
    expect(removed).toEqual([]);
  });
  it("keeps the document when the private file cannot be removed, so deletion can be retried", async () => {
    const id = await uploadedBy(uploader, "U-5");
    storageFailure = true;
    await expect(deleteDocument(uploader, id, database)).rejects.toBeInstanceOf(StorageError);
    expect((await getDocument(uploader, id, database)).id).toBe(id);
    expect((await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.documentId, id))).map(entry => entry.action)).toEqual(["document.uploaded"]);
    storageFailure = false;
    await deleteDocument(uploader, id, database);
    await expect(getDocument(uploader, id, database)).rejects.toMatchObject({ status: 404 });
  });
  it("reports a document already deleted by a concurrent request as not found", async () => {
    const id = await uploadedBy(uploader, "U-6");
    await deleteDocument(uploader, id, database);
    await expect(deleteDocument(uploader, id, database)).rejects.toMatchObject({ status: 404 });
  });
});
