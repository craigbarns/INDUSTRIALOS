import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { documents, extractedDocuments, procurementProjects } from "./db/schema";
import type { TenantContext } from "./authorization";
import { AppError } from "./errors";

// Suppliers are derived from the current (corrected or original) extraction of each document.
// There is no supplier table yet: the normalized name is the grouping key, scoped to one organization.
type Database = ReturnType<typeof getDb>;
const legalForms = new Set(["ab", "ag", "as", "bv", "co", "company", "corp", "corporation", "gmbh", "inc", "incorporated", "kg", "limited", "llc", "ltd", "nv", "oy", "plc", "pte", "pvt", "sa", "sarl", "sas", "sl", "spa", "srl"]);
export function normalizeSupplierName(name: string | null | undefined) {
  if (!name) return null;
  const words = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replaceAll(".", "").replaceAll("&", " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && legalForms.has(words.at(-1)!)) words.pop();
  return words.length ? words.join(" ") : null;
}
export function supplierKey(normalized: string) { return createHash("sha256").update(normalized).digest("hex").slice(0, 24); }

export interface SupplierSummary {
  id: string; name: string; aliases: string[]; country: string | null; email: string | null; website: string | null;
  quotationCount: number; approvedCount: number; productCount: number; currencies: string[];
  projects: Array<{ id: string; name: string }>; lastActivityAt: Date;
}
export interface SupplierQuotation {
  documentId: string; fileName: string; documentStatus: string; approved: boolean; createdAt: Date; projectId: string | null; projectName: string | null;
  quotationNumber: string | null; quotationDate: string | null; validityDate: string | null; currency: string | null; totalAmount: string | null; incoterm: string | null; productCount: number;
}
export interface SupplierProduct {
  documentId: string; quotationNumber: string | null; quotationDate: string | null; approved: boolean;
  reference: string | null; description: string | null; material: string | null; unitPrice: string | null; currency: string | null; priceBasis: string | null;
  minimumOrderQuantity: string | null; quantityUnit: string | null; leadTime: string | null;
}

const current = sql`coalesce(${extractedDocuments.correctedData}, ${extractedDocuments.originalData})`;
// Paths are fixed literals in this module, never request input.
const value = (path: string) => sql<string | null>`${current} #>> ${sql.raw(`'{${path.replaceAll(".", ",")},value}'`)}`;
export async function quotationRows(ctx: TenantContext, db: Database) {
  return db.select({
    documentId: documents.id, fileName: documents.fileName, documentStatus: documents.status, approvedAt: extractedDocuments.approvedAt, createdAt: documents.createdAt,
    projectId: procurementProjects.id, projectName: procurementProjects.name,
    supplierName: value("supplier.name"), country: value("supplier.country"), email: value("supplier.email"), website: value("supplier.website"),
    quotationNumber: value("quotation.number"), quotationDate: value("quotation.date"), validityDate: value("quotation.validityDate"), quotationCurrency: value("quotation.currency"),
    totalAmount: value("pricing.totalAmount"), pricingCurrency: value("pricing.currency"), incoterm: value("logistics.incoterm"),
    productCount: sql<number>`coalesce(jsonb_array_length(${current} -> 'products'), 0)::integer`,
  }).from(extractedDocuments)
    .innerJoin(documents, and(eq(documents.id, extractedDocuments.documentId), eq(documents.organizationId, extractedDocuments.organizationId)))
    .leftJoin(procurementProjects, and(eq(procurementProjects.id, documents.projectId), eq(procurementProjects.organizationId, documents.organizationId)))
    .where(eq(extractedDocuments.organizationId, ctx.organizationId)).orderBy(desc(documents.createdAt)).limit(5000);
}
export type QuotationRow = Awaited<ReturnType<typeof quotationRows>>[number];
export function groupBySupplier(rows: QuotationRow[]) {
  const groups = new Map<string, QuotationRow[]>();
  for (const row of rows) {
    const normalized = normalizeSupplierName(row.supplierName);
    if (!normalized) continue;
    const key = supplierKey(normalized);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
const unique = (values: Array<string | null | undefined>) => [...new Set(values.map(v => v?.trim()).filter((v): v is string => Boolean(v)))];
export function summarize(id: string, rows: QuotationRow[]): SupplierSummary {
  // Approved quotations are the most reliable profile source, then the most recent ones.
  const ranked = [...rows].sort((a, b) => Number(Boolean(b.approvedAt)) - Number(Boolean(a.approvedAt)) || b.createdAt.getTime() - a.createdAt.getTime());
  const first = (pick: (row: QuotationRow) => string | null) => unique(ranked.map(pick))[0] ?? null;
  const projects = new Map<string, string>();
  for (const row of rows) if (row.projectId && row.projectName) projects.set(row.projectId, row.projectName);
  return {
    id, name: first(row => row.supplierName)!, aliases: unique(rows.map(row => row.supplierName)),
    country: first(row => row.country), email: first(row => row.email), website: first(row => row.website),
    quotationCount: rows.length, approvedCount: rows.filter(row => row.approvedAt).length, productCount: rows.reduce((sum, row) => sum + row.productCount, 0),
    currencies: unique(rows.flatMap(row => [row.pricingCurrency, row.quotationCurrency])), projects: [...projects].map(([projectId, name]) => ({ id: projectId, name })),
    lastActivityAt: new Date(Math.max(...rows.map(row => row.createdAt.getTime()))),
  };
}
export async function listSuppliers(ctx: TenantContext, db: Database = getDb()) {
  return [...groupBySupplier(await quotationRows(ctx, db))].map(([id, rows]) => summarize(id, rows))
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime() || a.name.localeCompare(b.name));
}
export async function getSupplier(ctx: TenantContext, id: string, db: Database = getDb()) {
  const rows = /^[a-f0-9]{24}$/.test(id) ? groupBySupplier(await quotationRows(ctx, db)).get(id) : undefined;
  if (!rows) throw new AppError(404, "NOT_FOUND", "Supplier not found.");
  const quotations: SupplierQuotation[] = rows.map(row => ({
    documentId: row.documentId, fileName: row.fileName, documentStatus: row.documentStatus, approved: Boolean(row.approvedAt), createdAt: row.createdAt,
    projectId: row.projectId, projectName: row.projectName, quotationNumber: row.quotationNumber, quotationDate: row.quotationDate, validityDate: row.validityDate,
    currency: row.pricingCurrency ?? row.quotationCurrency, totalAmount: row.totalAmount, incoterm: row.incoterm, productCount: row.productCount,
  }));
  const lines = await db.select({ documentId: extractedDocuments.documentId, products: sql<unknown>`${current} -> 'products'` }).from(extractedDocuments)
    .where(and(eq(extractedDocuments.organizationId, ctx.organizationId), inArray(extractedDocuments.documentId, rows.map(row => row.documentId))));
  const byDocument = new Map(rows.map(row => [row.documentId, row]));
  const products: SupplierProduct[] = [];
  for (const line of lines) {
    const row = byDocument.get(line.documentId)!;
    for (const product of Array.isArray(line.products) ? line.products as Array<Record<string, { value?: string | null } | undefined>> : []) {
      const field = (key: string) => product[key]?.value ?? null;
      products.push({
        documentId: row.documentId, quotationNumber: row.quotationNumber, quotationDate: row.quotationDate, approved: Boolean(row.approvedAt),
        reference: field("manufacturerReference"), description: field("description"), material: field("material"), unitPrice: field("unitPrice"),
        currency: field("currency") ?? row.quotationCurrency ?? row.pricingCurrency, priceBasis: field("priceBasis"),
        minimumOrderQuantity: field("minimumOrderQuantity"), quantityUnit: field("quantityUnit"), leadTime: field("productionLeadTime"),
      });
    }
  }
  return { supplier: summarize(id, rows), quotations, products: products.slice(0, 2000) };
}
