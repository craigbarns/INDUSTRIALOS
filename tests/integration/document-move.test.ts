import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createProject, getDocument, listDocuments, moveDocument, updateProject } from "@/lib/repository";
import { addQuotation, migratedDatabase, type Database } from "../fixtures/quotations";

const pg = new PGlite();
let database: Database;
const member = { userId: "member", organizationId: "org-a", role: "member" };
const outsider = { userId: "outsider", organizationId: "org-b", role: "owner" };

beforeAll(async () => { database = await migratedDatabase(pg, [member, outsider]); }, 60000);
afterAll(async () => { await pg.close(); });

describe("Moving a document between projects", () => {
  it("moves an uploaded document into a project, between projects and back out, with an audit entry each time", async () => {
    const first = await createProject(member, { name: "Bricks" }, database);
    const second = await createProject(member, { name: "Plaster" }, database);
    const id = await addQuotation(database, member, { name: "Chausson", number: "M-1" });
    expect((await moveDocument(member, id, { projectId: first.id }, database)).projectId).toBe(first.id);
    expect((await listDocuments(member, first.id, database)).map(document => document.id)).toEqual([id]);
    await moveDocument(member, id, { projectId: second.id }, database);
    await moveDocument(member, id, { projectId: null }, database);
    expect((await getDocument(member, id, database)).projectId).toBeNull();
    const audit = await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.documentId, id));
    expect(audit.filter(entry => entry.action === "document.moved").map(entry => entry.details)).toEqual([
      { fromProjectId: null, toProjectId: first.id },
      { fromProjectId: first.id, toProjectId: second.id },
      { fromProjectId: second.id, toProjectId: null },
    ]);
  });
  it("does not log a move to the project the document is already in", async () => {
    const project = await createProject(member, { name: "Same" }, database);
    const id = await addQuotation(database, member, { name: "Chausson", number: "M-2" }, [], project.id);
    await moveDocument(member, id, { projectId: project.id }, database);
    expect(await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.documentId, id))).toEqual([]);
  });
  it("refuses archived projects", async () => {
    const project = await createProject(member, { name: "Old" }, database);
    await updateProject(member, project.id, { status: "archived" }, database);
    const id = await addQuotation(database, member, { name: "Chausson", number: "M-3" });
    await expect(moveDocument(member, id, { projectId: project.id }, database)).rejects.toMatchObject({ status: 409, code: "PROJECT_ARCHIVED" });
    expect((await getDocument(member, id, database)).projectId).toBeNull();
  });
  it("never crosses organizations, for the document or the project", async () => {
    const theirProject = await createProject(outsider, { name: "Theirs" }, database);
    const ourProject = await createProject(member, { name: "Ours" }, database);
    const ours = await addQuotation(database, member, { name: "Chausson", number: "M-4" });
    await expect(moveDocument(member, ours, { projectId: theirProject.id }, database)).rejects.toMatchObject({ status: 404 });
    await expect(moveDocument(outsider, ours, { projectId: null }, database)).rejects.toMatchObject({ status: 404 });
    await expect(moveDocument(outsider, ours, { projectId: ourProject.id }, database)).rejects.toMatchObject({ status: 404 });
    expect((await getDocument(member, ours, database)).projectId).toBeNull();
  });
});
