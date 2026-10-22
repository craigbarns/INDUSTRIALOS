import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Frame } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createAuth } from "@/lib/auth";
import type { getDb } from "@/lib/db";
import { assertMembership, assertAdministrator, requireContext } from "@/lib/authorization";
import { approveExtraction, correctExtraction, createProject, dashboard, getDocument, getDocumentReference, getExtraction, getProject, listDocuments, listProjects, updateProject } from "@/lib/repository";
import { emptyModelExtraction } from "@/lib/ai/extraction-schema";
import { validateExtraction } from "@/lib/ai/procurement-extractor";
import { GET as listDocumentsRoute } from "@/app/api/documents/route";
import { GET as documentRoute } from "@/app/api/documents/[id]/route";
import { PATCH as projectPatchRoute } from "@/app/api/projects/[id]/route";
import { GET as contentRoute } from "@/app/api/documents/[id]/content/route";
import { createPreviewPdf } from "../fixtures/preview-pdf";

let database: ReturnType<typeof getDb>;
let auth: ReturnType<typeof createAuth>;
vi.mock("@/lib/db", () => ({ getDb: () => database }));
vi.mock("@/lib/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getAuth: () => auth };
});
vi.mock("@/lib/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    readDocumentFile: async () => ({ bytes: createPreviewPdf(), mimeType: "application/pdf" }),
  };
});

const origin = "http://localhost:3000";
const password = "Industrial-test-strong-2026!";
const pg = new PGlite();
let cookieA: string;
let cookieB: string;
let ctxA: { userId: string; organizationId: string; role: string };
let ctxB: typeof ctxA;
let projectA: string;
let documentA: string;
function headers(cookie: string) { return new Headers({ cookie, origin, "Content-Type": "application/json" }); }
async function authRequest(path: string, body: unknown, cookie = "") {
  return auth.handler(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) }));
}
async function register(email: string) {
  const response = await authRequest("/sign-up/email", { email, password, name: email.split("@")[0] });
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const payload = await response.json();
  return { cookie, id: payload.user.id as string };
}

beforeAll(async () => {
  const folder = new URL("../../drizzle/", import.meta.url);
  for (const file of (await readdir(folder)).filter(file => file.endsWith(".sql")).sort()) await pg.exec(await readFile(new URL(file, folder), "utf8"));
  database = drizzle(pg, { schema }) as unknown as ReturnType<typeof getDb>;
  auth = createAuth(database, { baseURL: origin, secret: "integration-only-not-a-production-secret-1234567890", rateLimiting: false });
  const a = await register("owner-a@example.test");
  const b = await register("owner-b@example.test");
  cookieA = a.cookie; cookieB = b.cookie;
  const orgA = await auth.api.createOrganization({ headers: headers(cookieA), body: { name: "Organization A", slug: "organization-a" } });
  const orgB = await auth.api.createOrganization({ headers: headers(cookieB), body: { name: "Organization B", slug: "organization-b" } });
  ctxA = { userId: a.id, organizationId: orgA!.id, role: "owner" };
  ctxB = { userId: b.id, organizationId: orgB!.id, role: "owner" };
  projectA = (await createProject(ctxA, { name: "Private project A" }, database)).id;
  documentA = randomUUID();
  await database.insert(schema.documents).values({ id: documentA, organizationId: ctxA.organizationId, projectId: projectA, uploadedBy: ctxA.userId, fileName: "private.pdf", mimeType: "application/pdf", size: 100, storageKey: `organizations/${ctxA.organizationId}/documents/${documentA}/source.pdf`, sha256: "a".repeat(64), status: "review_required" });
  const raw = emptyModelExtraction();
  raw.supplier.name = { value: "Source Supplier", originalText: "Source Supplier", pageNumber: 1, status: "extracted" };
  const extracted = validateExtraction(raw, { documentId: documentA, provider: "mistral", model: "mock", pages: [{ pageNumber: 1, markdown: "Source Supplier" }] }).data;
  await database.insert(schema.extractedDocuments).values({ organizationId: ctxA.organizationId, documentId: documentA, originalData: extracted });
  await database.insert(schema.documentPages).values({ organizationId: ctxA.organizationId, documentId: documentA, pageNumber: 1, markdown: "Source Supplier" });
}, 60000);
afterAll(async () => { await pg.close(); });

describe("Authentication against PostgreSQL (PGlite)", () => {
  it("logs in with the real Better Auth password/session flow", async () => {
    const response = await authRequest("/sign-in/email", { email: "owner-a@example.test", password });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join(" ")).toContain("HttpOnly");
    expect(response.headers.getSetCookie().join(" ")).toContain("SameSite=Lax");
    const session = await auth.api.getSession({ headers: headers(cookieA) });
    expect(session?.user.id).toBe(ctxA.userId);
    expect(session?.session.activeOrganizationId).toBe(ctxA.organizationId);
  });
  it("rejects an incorrect password and invalid session token", async () => {
    const response = await authRequest("/sign-in/email", { email: "owner-a@example.test", password: "incorrect-password" });
    expect(response.status).toBe(401);
    expect(await auth.api.getSession({ headers: headers("better-auth.session_token=forged") })).toBeNull();
  });
  it("rejects unauthorized API reads before any tenant data is returned", async () => {
    const response = await listDocumentsRoute(new Request(`${origin}/api/documents`));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });
  it("validates active organization membership against the current database", async () => {
    expect(await requireContext(headers(cookieA))).toEqual(ctxA);
    expect(() => assertMembership({ ...ctxA }, ctxB.userId, ctxA.organizationId)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => assertAdministrator({ ...ctxA, role: "member" })).toThrowError(expect.objectContaining({ status: 403 }));
  });
  it("does not allow a session to select another tenant", async () => {
    const result = await authRequest("/organization/set-active", { organizationId: ctxA.organizationId }, cookieB);
    expect(result.status).toBe(403);
    // Better Auth clears a rejected active organization selection. Restore the valid one.
    const restored = await authRequest("/organization/set-active", { organizationId: ctxB.organizationId }, cookieB);
    expect(restored.status).toBe(200);
  });
  it("checks origin on authenticated mutations", async () => {
    const request = new Request(`${origin}/api/projects/${projectA}`, { method: "PATCH", headers: { cookie: cookieA, origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Tampered" }) });
    expect((await projectPatchRoute(request)).status).toBe(403);
    expect((await getProject(ctxA, projectA, database)).name).toBe("Private project A");
  });
});

describe("Tenant isolation and source-backed correction workflow", () => {
  it("scopes project lists, document lists and dashboard counts to the active tenant", async () => {
    expect(await listProjects(ctxB, database)).toEqual([]);
    expect(await listDocuments(ctxB, undefined, database)).toEqual([]);
    expect((await dashboard(ctxB, database)).metrics).toEqual({ activeProjects: 0, totalDocuments: 0, analyzedDocuments: 0, reviewRequired: 0 });
    expect((await dashboard(ctxA, database)).metrics.totalDocuments).toBe(1);
  });
  it("prevents cross-organization document content, metadata and extraction access", async () => {
    await expect(getDocument(ctxB, documentA, database)).rejects.toMatchObject({ status: 404 });
    await expect(getDocumentReference(ctxB, documentA, database)).rejects.toMatchObject({ status: 404 });
    await expect(getExtraction(ctxB, documentA, database)).rejects.toMatchObject({ status: 404 });
    const response = await documentRoute(new Request(`${origin}/api/documents/${documentA}`, { headers: headers(cookieB) }));
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("private.pdf");
  });
  it("prevents cross-organization project update, correction and approval", async () => {
    await expect(updateProject(ctxB, projectA, { name: "hijacked" }, database)).rejects.toMatchObject({ status: 404 });
    await expect(correctExtraction(ctxB, documentA, { version: 1, corrections: [{ path: "supplier.name", value: "hijacked", status: "corrected" }] }, database)).rejects.toMatchObject({ status: 404 });
    await expect(approveExtraction(ctxB, documentA, { version: 1 }, database)).rejects.toMatchObject({ status: 404 });
  });
  it("enforces organization consistency at the foreign-key level", async () => {
    await expect(database.insert(schema.documents).values({ organizationId: ctxB.organizationId, projectId: projectA, fileName: "bad.pdf", mimeType: "application/pdf", size: 10, storageKey: `bad-${randomUUID()}`, sha256: "b".repeat(64) })).rejects.toThrow();
  });
  it("keeps original evidence, audits corrections, and rejects stale saves", async () => {
    const changed = await correctExtraction(ctxA, documentA, { version: 1, corrections: [{ path: "supplier.name", value: "Verified Supplier", status: "corrected" }] }, database);
    expect(changed.version).toBe(2);
    expect(changed.data.supplier.name).toMatchObject({ value: "Verified Supplier", originalText: "Source Supplier", pageNumber: 1, status: "corrected" });
    expect((changed.originalData as typeof changed.data).supplier.name.value).toBe("Source Supplier");
    expect(changed.corrections.some(entry => entry.action === "extraction.corrected" && entry.changes)).toBe(true);
    await expect(correctExtraction(ctxA, documentA, { version: 1, corrections: [{ path: "supplier.name", value: "stale", status: "corrected" }] }, database)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });
  it("approves the current version and invalidates approval when corrected again", async () => {
    const approved = await approveExtraction(ctxA, documentA, { version: 2 }, database);
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.version).toBe(3);
    expect((await getDocument(ctxA, documentA, database)).status).toBe("completed");
    const changed = await correctExtraction(ctxA, documentA, { version: 3, corrections: [{ path: "supplier.country", value: "Uncertain", status: "ambiguous" }] }, database);
    expect(changed.approvedAt).toBeNull();
    await expect(approveExtraction(ctxA, documentA, { version: 4 }, database)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  });
  it("immediately denies a session after membership revocation", async () => {
    await database.delete(schema.member).where(and(eq(schema.member.userId, ctxB.userId), eq(schema.member.organizationId, ctxB.organizationId)));
    await expect(requireContext(headers(cookieB))).rejects.toMatchObject({ status: 403 });
  });
  it("renders the authorized private PDF in a real Chrome iframe", async () => {
    const server = createServer(async (request, response) => {
      try {
        if (request.url?.startsWith("/api/documents/")) {
          const result = await contentRoute(new Request(`http://127.0.0.1${request.url}`, {
            headers: { cookie: request.headers.cookie ?? "" },
          }));
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(Buffer.from(await result.arrayBuffer()));
        } else {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(`<!doctype html><title>Industrial OS preview regression</title>
            <style>body{margin:0;background:#f8f9fb}iframe{width:100vw;height:100vh;border:0}</style>
            <iframe title="Original document" src="/api/documents/${documentA}/content#page=1&zoom=100&toolbar=0"></iframe>`);
        }
      } catch { response.writeHead(500).end(); }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const previewOrigin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      await context.addCookies(cookieA.split("; ").map(cookie => {
        const separator = cookie.indexOf("=");
        return { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: previewOrigin };
      }));
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      const pdfResponse = page.waitForResponse(response => response.url().includes(`/api/documents/${documentA}/content`));
      await page.goto(previewOrigin);
      const result = await pdfResponse;
      expect(result.status()).toBe(200);
      expect(result.headers()["cache-control"]).toBe("private, no-store");
      expect(result.headers()["x-content-type-options"]).toBe("nosniff");
      expect(result.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
      expect(result.headers()["content-security-policy"]).not.toContain("sandbox");
      // Older Chrome puts the PDF plugin in the iframe's document; the out-of-process
      // viewer (Chrome 1xx+) nests it in descendant frames under the internal plugin type,
      // and its <pdf-viewer> reports when the document has actually been parsed.
      const preview = page.frames().find(frame => frame.parentFrame() === page.mainFrame());
      const isWithinPreview = (frame: Frame | null): boolean =>
        frame !== null && (frame === preview || isWithinPreview(frame.parentFrame()));
      const pluginSelector = 'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]';
      await expect.poll(async () => {
        const frames = page.frames().filter(isWithinPreview);
        let plugin = false;
        for (const frame of frames) {
          if (await frame.locator(pluginSelector).count().catch(() => 0)) plugin = true;
          const state = await frame.evaluate(() => {
            const viewer = document.querySelector("pdf-viewer") as (Element & { loadState_?: string }) | null;
            return viewer ? viewer.loadState_ ?? "unknown" : null;
          }).catch(() => null);
          if (state && state !== "unknown") return state;
        }
        return plugin ? "success" : "pending";
      }, { timeout: 15000 }).toBe("success");
      expect(errors.filter(error => /sandbox|failed to load|refused to/i.test(error))).toEqual([]);
      await mkdir("test-results", { recursive: true });
      await page.screenshot({ path: "test-results/pdf-preview-chrome.png" });
      await context.close();
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30000);
  it("retains document audit history after the source document is deleted", async () => {
    const before = await database.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.documentId, documentA));
    expect(before.length).toBeGreaterThan(0);
    await database.delete(schema.documents).where(eq(schema.documents.id, documentA));
    const after = await database.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.documentId, documentA));
    expect(after.map(row => row.id).sort()).toEqual(before.map(row => row.id).sort());
    expect(after.every(row => row.organizationId === ctxA.organizationId)).toBe(true);
  });
});
