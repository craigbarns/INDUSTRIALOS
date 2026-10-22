import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, bigint, uuid, jsonb, index, uniqueIndex, unique, foreignKey, check } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Better Auth model keys intentionally match its maintained Drizzle adapter.
export const user = pgTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const session = pgTable("sessions", {
  id: text("id").primaryKey(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(), createdAt: createdAt(), updatedAt: updatedAt(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
}, t => [index("sessions_user_idx").on(t.userId)]);
export const account = pgTable("accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"), password: text("password"), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("accounts_user_idx").on(t.userId), uniqueIndex("accounts_provider_unique").on(t.providerId, t.accountId)]);
export const verification = pgTable("verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("verifications_identifier_idx").on(t.identifier)]);
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  logo: text("logo"), metadata: text("metadata"), createdAt: createdAt(),
  aiProcessingEnabled: boolean("ai_processing_enabled").notNull().default(false),
});
export const member = pgTable("organization_members", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), createdAt: createdAt(),
}, t => [uniqueIndex("members_org_user_unique").on(t.organizationId, t.userId), index("members_user_idx").on(t.userId)]);
export const invitation = pgTable("organization_invitations", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(), role: text("role"), status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(),
  inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, t => [index("invitations_org_idx").on(t.organizationId), index("invitations_email_idx").on(t.email)]);
export const rateLimit = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(), key: text("key").notNull().unique(), count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const organization = organizations;

export const procurementProjects = pgTable("procurement_projects", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(), description: text("description"), status: text("status", { enum: ["active", "completed", "archived"] }).notNull().default("active"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("projects_org_status_idx").on(t.organizationId, t.status), unique("projects_id_org_unique").on(t.id, t.organizationId),
  check("project_status_check", sql`${t.status} in ('active','completed','archived')`)]);
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id"), uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(),
  storageKey: text("storage_key").notNull().unique(), sha256: text("sha256").notNull(),
  status: text("status", { enum: ["uploaded", "queued", "processing", "completed", "review_required", "failed"] }).notNull().default("uploaded"),
  processingVersion: integer("processing_version").notNull().default(0), pageCount: integer("page_count"), errorCode: text("error_code"), lastError: text("last_error"),
  approvedAt: timestamp("approved_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("documents_org_status_idx").on(t.organizationId, t.status), index("documents_project_idx").on(t.organizationId, t.projectId),
  unique("documents_id_org_unique").on(t.id, t.organizationId),
  foreignKey({ columns: [t.projectId, t.organizationId], foreignColumns: [procurementProjects.id, procurementProjects.organizationId] }),
  check("document_size_check", sql`${t.size} > 0 and ${t.size} <= 20971520`),
  check("document_status_check", sql`${t.status} in ('uploaded','queued','processing','completed','review_required','failed')`)]);
export const documentProcessingJobs = pgTable("document_processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull(), documentId: uuid("document_id").notNull(),
  bossJobId: uuid("boss_job_id"), processingVersion: integer("processing_version").notNull(),
  status: text("status", { enum: ["queued", "processing", "completed", "failed"] }).notNull().default("queued"),
  attempt: integer("attempt").notNull().default(0), lastError: text("last_error"), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [foreignKey({ columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId], }).onDelete("cascade"),
  uniqueIndex("jobs_doc_version_unique").on(t.documentId, t.processingVersion), index("jobs_org_status_idx").on(t.organizationId, t.status)]);
export const documentPages = pgTable("document_pages", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull(), documentId: uuid("document_id").notNull(),
  pageNumber: integer("page_number").notNull(), markdown: text("markdown").notNull(),
}, t => [foreignKey({ columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId] }).onDelete("cascade"),
  uniqueIndex("pages_doc_number_unique").on(t.documentId, t.pageNumber), check("pages_positive_check", sql`${t.pageNumber} > 0`)]);
export const extractedDocuments = pgTable("extracted_documents", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull(), documentId: uuid("document_id").notNull().unique(),
  documentType: text("document_type"), originalData: jsonb("original_data").notNull(), correctedData: jsonb("corrected_data"),
  provider: text("provider").notNull().default("mistral"), ocrModel: text("ocr_model"), extractionModel: text("extraction_model"),
  issues: jsonb("issues").$type<string[]>().notNull().default([]), version: integer("version").notNull().default(1),
  reviewStatus: text("review_status").notNull().default("pending"), approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [foreignKey({ columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId] }).onDelete("cascade"), index("extractions_org_idx").on(t.organizationId)]);
export const extractedLineItems = pgTable("extracted_line_items", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull(), documentId: uuid("document_id").notNull(),
  position: integer("position").notNull(), data: jsonb("data").notNull(),
}, t => [foreignKey({ columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId] }).onDelete("cascade"), uniqueIndex("line_items_doc_position_unique").on(t.documentId, t.position)]);
export const documentFieldEvidence = pgTable("document_field_evidence", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull(), documentId: uuid("document_id").notNull(),
  path: text("path").notNull(), value: text("value"), originalText: text("original_text"), pageNumber: integer("page_number"), status: text("status").notNull(),
}, t => [foreignKey({ columns: [t.documentId, t.organizationId], foreignColumns: [documents.id, documents.organizationId] }).onDelete("cascade"),
  uniqueIndex("evidence_doc_path_unique").on(t.documentId, t.path)]);
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }), documentId: uuid("document_id"),
  action: text("action").notNull(), details: jsonb("details").notNull().default({}), createdAt: createdAt(),
  // Keep the historical document ID after deletion. Audit records deliberately have no document FK.
}, t => [
  index("audit_org_date_idx").on(t.organizationId, t.createdAt),
  index("audit_document_idx").on(t.organizationId, t.documentId),
]);
export const apiRateLimits = pgTable("api_rate_limits", {
  id: text("id").primaryKey(), count: integer("count").notNull(), resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
});
