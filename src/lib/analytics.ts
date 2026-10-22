import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "./db";
import { documents } from "./db/schema";
import type { TenantContext } from "./authorization";
import { getProject } from "./repository";
import { isDecimalString } from "./ai/field-validation";
import { groupBySupplier, normalizeSupplierName, quotationRows, summarize, supplierKey, type QuotationRow } from "./suppliers";

type Database = ReturnType<typeof getDb>;

/** Compares canonical non-negative decimal strings exactly; financial values are never converted to floats. */
export function compareDecimal(a: string, b: string) {
  const split = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return [whole.replace(/^0+(?=\d)/, ""), fraction.replace(/0+$/, "")] as const;
  };
  const [wholeA, fractionA] = split(a);
  const [wholeB, fractionB] = split(b);
  if (wholeA.length !== wholeB.length) return wholeA.length - wholeB.length;
  if (wholeA !== wholeB) return wholeA < wholeB ? -1 : 1;
  const length = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(length, "0");
  const paddedB = fractionB.padEnd(length, "0");
  return paddedA === paddedB ? 0 : paddedA < paddedB ? -1 : 1;
}
export function recentMonths(now = new Date()) {
  return Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1)).toISOString().slice(0, 7));
}

const supplierIdOf = (row: QuotationRow) => { const normalized = normalizeSupplierName(row.supplierName); return normalized ? supplierKey(normalized) : null; };
const currencyOf = (row: QuotationRow) => row.pricingCurrency ?? row.quotationCurrency;
const priced = (row: QuotationRow) => Boolean(currencyOf(row) && row.totalAmount && isDecimalString(row.totalAmount));

export interface ComparedQuotation {
  documentId: string; fileName: string; documentStatus: string; approved: boolean; supplierId: string | null; supplierName: string | null;
  quotationNumber: string | null; quotationDate: string | null; validityDate: string | null; currency: string | null; totalAmount: string | null;
  incoterm: string | null; productCount: number; lowestInCurrency: boolean;
}
export async function projectComparison(ctx: TenantContext, projectId: string, db: Database = getDb()) {
  const project = await getProject(ctx, projectId, db);
  const rows = (await quotationRows(ctx, db)).filter(row => row.projectId === project.id);
  // Totals are only compared within one currency; no exchange rates are applied.
  const lowest = new Map<string, string>();
  for (const row of rows.filter(priced)) {
    const current = lowest.get(currencyOf(row)!);
    if (!current || compareDecimal(row.totalAmount!, current) < 0) lowest.set(currencyOf(row)!, row.totalAmount!);
  }
  const ordered = [...rows].sort((a, b) =>
    Number(priced(b)) - Number(priced(a))
    || (priced(a) && priced(b) ? currencyOf(a)!.localeCompare(currencyOf(b)!) || compareDecimal(a.totalAmount!, b.totalAmount!) : 0)
    || (a.supplierName ?? "").localeCompare(b.supplierName ?? "") || (a.quotationNumber ?? "").localeCompare(b.quotationNumber ?? ""));
  const quotations: ComparedQuotation[] = ordered.map(row => ({
    documentId: row.documentId, fileName: row.fileName, documentStatus: row.documentStatus, approved: Boolean(row.approvedAt),
    supplierId: supplierIdOf(row), supplierName: row.supplierName, quotationNumber: row.quotationNumber, quotationDate: row.quotationDate,
    validityDate: row.validityDate, currency: currencyOf(row), totalAmount: row.totalAmount, incoterm: row.incoterm, productCount: row.productCount,
    lowestInCurrency: priced(row) && compareDecimal(row.totalAmount!, lowest.get(currencyOf(row)!)!) === 0,
  }));
  return { project: { id: project.id, name: project.name }, quotations, supplierCount: new Set(quotations.map(q => q.supplierId).filter(Boolean)).size };
}

export async function analyticsOverview(ctx: TenantContext, db: Database = getDb()) {
  const months = recentMonths();
  const since = new Date(`${months[0]}-01T00:00:00Z`);
  const monthOf = (column: AnyPgColumn) => sql<string>`to_char(date_trunc('month', ${column} at time zone 'UTC'), 'YYYY-MM')`;
  const count = sql<number>`count(*)::integer`;
  const tenant = eq(documents.organizationId, ctx.organizationId);
  const [statuses, uploads, approvals, rows] = await Promise.all([
    db.select({ status: documents.status, count }).from(documents).where(tenant).groupBy(documents.status),
    db.select({ month: monthOf(documents.createdAt), count }).from(documents).where(and(tenant, gte(documents.createdAt, since))).groupBy(monthOf(documents.createdAt)),
    db.select({ month: monthOf(documents.approvedAt), count }).from(documents).where(and(tenant, isNotNull(documents.approvedAt), gte(documents.approvedAt, since))).groupBy(monthOf(documents.approvedAt)),
    quotationRows(ctx, db),
  ]);
  const statusCount = (status: string) => statuses.find(row => row.status === status)?.count ?? 0;
  const suppliers = [...groupBySupplier(rows)].map(([id, group]) => summarize(id, group));
  const countries = new Map<string | null, number>();
  for (const supplier of suppliers) countries.set(supplier.country, (countries.get(supplier.country) ?? 0) + 1);
  const projects = new Map<string, { id: string; name: string; quotations: number; suppliers: Set<string>; approved: number }>();
  for (const row of rows) {
    if (!row.projectId || !row.projectName) continue;
    const project = projects.get(row.projectId) ?? { id: row.projectId, name: row.projectName, quotations: 0, suppliers: new Set<string>(), approved: 0 };
    project.quotations += 1;
    if (row.approvedAt) project.approved += 1;
    const supplierId = supplierIdOf(row);
    if (supplierId) project.suppliers.add(supplierId);
    projects.set(row.projectId, project);
  }
  return {
    totals: {
      documents: statuses.reduce((sum, row) => sum + row.count, 0), analyzed: rows.length, approved: rows.filter(row => row.approvedAt).length,
      reviewRequired: statusCount("review_required"), failed: statusCount("failed"), suppliers: suppliers.length,
      productsQuoted: rows.reduce((sum, row) => sum + row.productCount, 0),
    },
    statuses,
    monthly: months.map(month => ({ month, uploaded: uploads.find(row => row.month === month)?.count ?? 0, approved: approvals.find(row => row.month === month)?.count ?? 0 })),
    countries: [...countries].map(([country, total]) => ({ country, suppliers: total })).sort((a, b) => b.suppliers - a.suppliers || (a.country ?? "~").localeCompare(b.country ?? "~")),
    projects: [...projects.values()].map(project => ({ ...project, suppliers: project.suppliers.size }))
      .sort((a, b) => b.quotations - a.quotations || a.name.localeCompare(b.name)),
  };
}
