import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addQuotation, migratedDatabase, type Database } from "../fixtures/quotations";
import { approveExtraction, createProject } from "@/lib/repository";
import { analyticsOverview, projectComparison, recentMonths } from "@/lib/analytics";

const pg = new PGlite();
let database: Database;
const ctxA = { userId: "user-a", organizationId: "org-a", role: "owner" };
const ctxB = { userId: "user-b", organizationId: "org-b", role: "owner" };
let cups: string;
let lids: string;
const quotes: Record<string, string> = {};

beforeAll(async () => {
  database = await migratedDatabase(pg, [ctxA, ctxB]);
  cups = (await createProject(ctxA, { name: "Cups" }, database)).id;
  lids = (await createProject(ctxA, { name: "Lids" }, database)).id;
  quotes.ningbo = await addQuotation(database, ctxA, { name: "Ningbo Plastics Co., Ltd.", country: "China", number: "N-1", currency: "USD", total: "1200.00", incoterm: "FOB", validity: "2026-12-31" }, [{ reference: "CUP-1", price: "0.12" }], cups);
  quotes.lyon = await addQuotation(database, ctxA, { name: "Lyon Emballages", country: "France", number: "L-1", currency: "EUR", total: "980.50" }, [], cups);
  quotes.saigon = await addQuotation(database, ctxA, { name: "Saigon Molding", country: "Vietnam", number: "S-1", currency: "USD", total: "1150.00" }, [], cups);
  quotes.ningboAgain = await addQuotation(database, ctxA, { name: "NINGBO PLASTICS CO LTD", number: "N-2", currency: "USD", total: "1150.0" }, [{ reference: "CUP-2", price: "0.11" }], cups);
  quotes.delta = await addQuotation(database, ctxA, { name: "Delta Packaging", number: "D-1" }, [], cups);
  quotes.lyonLids = await addQuotation(database, ctxA, { name: "Lyon Emballages SAS", number: "L-2", currency: "EUR", total: "300" }, [], lids);
  quotes.berlin = await addQuotation(database, ctxA, { name: "Berlin Formteile GmbH", country: "Germany", number: "B-1" });
  await addQuotation(database, ctxB, { name: "Other Tenant Supplier", number: "SECRET-1", currency: "USD", total: "1" });
  await approveExtraction(ctxA, quotes.ningbo, { version: 1 }, database);
}, 60000);
afterAll(async () => { await pg.close(); });

describe("Project quotation comparison", () => {
  it("lists the project's quotations grouped by currency, cheapest first, missing totals last", async () => {
    const { quotations } = await projectComparison(ctxA, cups, database);
    // Equal totals (1150.00 and 1150.0) are ordered by supplier name.
    expect(quotations.map(q => q.quotationNumber)).toEqual(["L-1", "N-2", "S-1", "N-1", "D-1"]);
    expect(quotations.find(q => q.quotationNumber === "N-1")).toMatchObject({ supplierName: "Ningbo Plastics Co., Ltd.", totalAmount: "1200.00", currency: "USD", incoterm: "FOB", validityDate: "2026-12-31", approved: true, productCount: 1 });
  });
  it("marks every quotation that ties for the lowest total in its currency", async () => {
    const { quotations } = await projectComparison(ctxA, cups, database);
    const lowest = Object.fromEntries(quotations.map(q => [q.quotationNumber, q.lowestInCurrency]));
    expect(lowest).toEqual({ "L-1": true, "S-1": true, "N-2": true, "N-1": false, "D-1": false });
  });
  it("links quotations to their supplier, merging name variants", async () => {
    const { quotations, supplierCount } = await projectComparison(ctxA, cups, database);
    const id = (number: string) => quotations.find(q => q.quotationNumber === number)!.supplierId;
    expect(id("N-1")).toBe(id("N-2"));
    expect(id("N-1")).toMatch(/^[a-f0-9]{24}$/);
    expect(supplierCount).toBe(4);
  });
  it("hides other organizations' projects", async () => {
    await expect(projectComparison(ctxB, cups, database)).rejects.toMatchObject({ status: 404 });
  });
});

describe("Analytics overview", () => {
  it("counts documents, review progress, suppliers and products for the tenant only", async () => {
    const overview = await analyticsOverview(ctxA, database);
    expect(overview.totals).toEqual({ documents: 7, analyzed: 7, approved: 1, reviewRequired: 6, failed: 0, suppliers: 5, productsQuoted: 2 });
    expect(overview.statuses).toEqual(expect.arrayContaining([{ status: "review_required", count: 6 }, { status: "completed", count: 1 }]));
    const other = await analyticsOverview(ctxB, database);
    expect(other.totals).toMatchObject({ documents: 1, suppliers: 1 });
    expect(JSON.stringify(other)).not.toContain("Ningbo");
  });
  it("returns twelve months of upload and approval activity", async () => {
    const { monthly } = await analyticsOverview(ctxA, database);
    expect(monthly.map(m => m.month)).toEqual(recentMonths(new Date()));
    expect(monthly.at(-1)).toMatchObject({ uploaded: 7, approved: 1 });
    expect(monthly.slice(0, -1).every(m => m.uploaded === 0 && m.approved === 0)).toBe(true);
  });
  it("summarizes suppliers per country and quotation coverage per project", async () => {
    const { countries, projects } = await analyticsOverview(ctxA, database);
    expect(countries).toEqual(expect.arrayContaining([{ country: "China", suppliers: 1 }, { country: "Germany", suppliers: 1 }, { country: null, suppliers: 1 }]));
    expect(countries.reduce((sum, c) => sum + c.suppliers, 0)).toBe(5);
    expect(projects).toEqual([
      { id: cups, name: "Cups", quotations: 5, suppliers: 4, approved: 1 },
      { id: lids, name: "Lids", quotations: 1, suppliers: 1, approved: 0 },
    ]);
  });
});
