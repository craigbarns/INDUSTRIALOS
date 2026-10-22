import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addQuotation, migratedDatabase, type Database } from "../fixtures/quotations";
import { approveExtraction, correctExtraction, createProject } from "@/lib/repository";
import { getSupplier, listSuppliers, normalizeSupplierName, supplierKey } from "@/lib/suppliers";

const pg = new PGlite();
let database: Database;
const ctxA = { userId: "user-a", organizationId: "org-a", role: "owner" };
const ctxB = { userId: "user-b", organizationId: "org-b", role: "owner" };
let projectA: string;
const ningbo = supplierKey(normalizeSupplierName("Ningbo Plastics")!);

let approvedQuote: string;
beforeAll(async () => {
  database = await migratedDatabase(pg, [ctxA, ctxB]);
  projectA = (await createProject(ctxA, { name: "Cups 2026" }, database)).id;
  approvedQuote = await addQuotation(database, ctxA, { name: "Ningbo Plastics Co., Ltd.", country: "China", number: "Q-100", date: "2026-03-01", currency: "USD", total: "1200.00", incoterm: "FOB" }, [{ reference: "CUP-01", price: "0.12" }], projectA);
  await addQuotation(database, ctxA, { name: "NINGBO PLASTICS CO LTD", email: "sales@ningbo.example", number: "Q-200", currency: "EUR" }, [{ reference: "CUP-02", price: "0.15" }, { reference: "LID-02", price: "0.04" }]);
  await addQuotation(database, ctxA, { name: "Lyon Emballages SAS", country: "France", number: "F-1" });
  await addQuotation(database, ctxA, { number: "NO-SUPPLIER" });
  await addQuotation(database, ctxB, { name: "Ningbo Plastics", country: "Vietnam", number: "B-SECRET" });
  // The current reviewed value, not the original AI value, decides the supplier.
  const corrected = await addQuotation(database, ctxA, { name: "Wrong Name Ltd", number: "C-1" });
  await correctExtraction(ctxA, corrected, { version: 1, corrections: [{ path: "supplier.name", value: "Ningbo Plastics", status: "corrected" }] }, database);
  await approveExtraction(ctxA, approvedQuote, { version: 1 }, database);
}, 60000);
afterAll(async () => { await pg.close(); });

describe("Supplier directory derived from analyzed documents", () => {
  it("groups quotations of one supplier and skips documents without a supplier", async () => {
    const suppliers = await listSuppliers(ctxA, database);
    expect(suppliers.map(s => s.name).sort()).toEqual(["Lyon Emballages SAS", "Ningbo Plastics Co., Ltd."]);
    const supplier = suppliers.find(s => s.id === ningbo)!;
    expect(supplier).toMatchObject({ quotationCount: 3, approvedCount: 1, productCount: 3, country: "China", email: "sales@ningbo.example" });
    expect(supplier.currencies.sort()).toEqual(["EUR", "USD"]);
    expect(supplier.projects).toEqual([{ id: projectA, name: "Cups 2026" }]);
    expect(supplier.aliases.sort()).toEqual(["NINGBO PLASTICS CO LTD", "Ningbo Plastics", "Ningbo Plastics Co., Ltd."].sort());
  });
  it("prefers values from approved quotations for the supplier profile", async () => {
    const [profile] = (await listSuppliers(ctxA, database)).filter(s => s.id === ningbo);
    expect(profile.name).toBe("Ningbo Plastics Co., Ltd.");
  });
  it("returns quotations and line items for one supplier", async () => {
    const detail = await getSupplier(ctxA, ningbo, database);
    expect(detail.supplier.quotationCount).toBe(3);
    const approved = detail.quotations.find(q => q.documentId === approvedQuote)!;
    expect(approved).toMatchObject({ quotationNumber: "Q-100", quotationDate: "2026-03-01", currency: "USD", totalAmount: "1200.00", incoterm: "FOB", approved: true, projectName: "Cups 2026", productCount: 1 });
    expect(detail.products.map(p => [p.reference, p.unitPrice, p.currency]).sort()).toEqual([["CUP-01", "0.12", "USD"], ["CUP-02", "0.15", "EUR"], ["LID-02", "0.04", "EUR"]]);
    expect(detail.products.find(p => p.reference === "CUP-01")).toMatchObject({ documentId: approvedQuote, quotationNumber: "Q-100", approved: true, quantityUnit: "piece" });
  });
  it("isolates suppliers per organization", async () => {
    const other = await listSuppliers(ctxB, database);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ id: ningbo, quotationCount: 1, country: "Vietnam" });
    const detail = await getSupplier(ctxB, ningbo, database);
    expect(detail.quotations.map(q => q.quotationNumber)).toEqual(["B-SECRET"]);
    expect(JSON.stringify(await getSupplier(ctxA, ningbo, database))).not.toContain("B-SECRET");
  });
  it("returns not found for an unknown or malformed supplier key", async () => {
    await expect(getSupplier(ctxA, supplierKey("unknown supplier"), database)).rejects.toMatchObject({ status: 404 });
    await expect(getSupplier(ctxA, "../../etc", database)).rejects.toMatchObject({ status: 404 });
    await expect(getSupplier({ ...ctxA, organizationId: "org-missing" }, ningbo, database)).rejects.toMatchObject({ status: 404 });
  });
});
