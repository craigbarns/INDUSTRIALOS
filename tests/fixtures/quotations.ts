import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { emptyModelExtraction } from "@/lib/ai/extraction-schema";
import { validateExtraction } from "@/lib/ai/procurement-extractor";

/** Synthetic, source-grounded quotations for repository tests. Never customer data. */
export type Database = ReturnType<typeof getDb>;
export type TestContext = { userId: string; organizationId: string; role: string };
export type QuotationFields = Partial<Record<"name" | "country" | "email" | "number" | "date" | "validity" | "currency" | "total" | "incoterm", string>>;

export async function migratedDatabase(pg: PGlite, contexts: TestContext[]) {
  const folder = new URL("../../drizzle/", import.meta.url);
  for (const file of (await readdir(folder)).filter(file => file.endsWith(".sql")).sort()) await pg.exec(await readFile(new URL(file, folder), "utf8"));
  const database = drizzle(pg, { schema }) as unknown as Database;
  for (const ctx of contexts) {
    await database.insert(schema.user).values({ id: ctx.userId, name: ctx.userId, email: `${ctx.userId}@example.test` });
    await database.insert(schema.organizations).values({ id: ctx.organizationId, name: ctx.organizationId, slug: ctx.organizationId }).onConflictDoNothing();
  }
  return database;
}

export async function addQuotation(database: Database, ctx: TestContext, fields: QuotationFields, products: Array<{ reference: string; price: string }> = [], projectId: string | null = null) {
  const id = randomUUID();
  await database.insert(schema.documents).values({ id, organizationId: ctx.organizationId, projectId, fileName: `${fields.number ?? "quote"}.pdf`, mimeType: "application/pdf", size: 100, storageKey: `organizations/${ctx.organizationId}/documents/${id}/source.pdf`, sha256: "a".repeat(64), status: "review_required" });
  const raw = emptyModelExtraction();
  const set = (value: string | undefined) => value === undefined ? undefined : { value, originalText: value, pageNumber: 1, status: "extracted" as const };
  const assign = <T extends object>(target: T, key: keyof T, value: string | undefined) => { const field = set(value); if (field) (target[key] as unknown) = field; };
  assign(raw.supplier, "name", fields.name);
  assign(raw.supplier, "country", fields.country);
  assign(raw.supplier, "email", fields.email);
  assign(raw.quotation, "number", fields.number);
  assign(raw.quotation, "date", fields.date);
  assign(raw.quotation, "validityDate", fields.validity);
  assign(raw.quotation, "currency", fields.currency);
  assign(raw.pricing, "totalAmount", fields.total);
  assign(raw.pricing, "currency", fields.currency);
  assign(raw.logistics, "incoterm", fields.incoterm);
  raw.products = products.map(product => {
    const empty = emptyModelExtraction().supplier.name;
    const line = Object.fromEntries(["manufacturerReference", "description", "material", "dimensions", "weight", "weightBasis", "capacity", "color", "packagingDetails", "unitPrice", "currency", "priceBasis", "minimumOrderQuantity", "quantityUnit", "toolingCosts", "productionLeadTime", "foodContactCompliance"].map(key => [key, { ...empty }])) as unknown as (typeof raw.products)[number];
    line.manufacturerReference = set(product.reference)!;
    line.unitPrice = set(product.price)!;
    line.priceBasis = set("per piece")!;
    line.quantityUnit = set("piece")!;
    line.priceBreaks = [];
    return line;
  });
  const markdown = Object.values(fields).join(" ") + products.map(p => ` ${p.reference} ${p.price} per piece`).join("");
  const extracted = validateExtraction(raw, { documentId: id, provider: "mistral", model: "mock", pages: [{ pageNumber: 1, markdown }] }).data;
  await database.insert(schema.extractedDocuments).values({ organizationId: ctx.organizationId, documentId: id, originalData: extracted });
  return id;
}
