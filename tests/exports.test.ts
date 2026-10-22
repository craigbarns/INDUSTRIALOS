import { describe, expect, it } from "vitest";
import { csvResponse, toCsv } from "@/lib/csv";
import { comparisonCsv, supplierProductsCsv, suppliersCsv } from "@/lib/exports";

describe("CSV encoding", () => {
  it("quotes separators, quotes and line breaks per RFC 4180 with CRLF rows", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",\r\n');
  });
  it("neutralizes spreadsheet formulas coming from untrusted documents", () => {
    const csv = toCsv(["value"], [["=HYPERLINK(\"http://evil\")"], ["+1"], ["-cmd"], ["@SUM(A1)"], ["\tTAB"], ["\rCR"], ["0.142"]]);
    expect(csv.split("\r\n").slice(1, -1)).toEqual([`"'=HYPERLINK(""http://evil"")"`, "'+1", "'-cmd", "'@SUM(A1)", "'\tTAB", `"'\rCR"`, "0.142"]);
  });
  it("keeps numbers and booleans as plain values", () => {
    expect(toCsv(["n", "b"], [[3, true]])).toBe("﻿n,b\r\n3,yes\r\n");
  });
  it("serves a private, non-cacheable attachment with a safe file name", async () => {
    expect(csvResponse("Cups 2026 - comparison", "").headers.get("content-disposition")).toContain('filename="Cups-2026-comparison.csv"');
    const response = csvResponse('Quote "A"/../ comparison', "﻿a\r\n");
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="Quote-A-comparison.csv"; filename*=UTF-8''Quote%20%22A%22%2F..%2F%20comparison.csv`);
    // Text decoding drops the BOM, so check the bytes a spreadsheet receives.
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]);
  });
});

describe("Export builders", () => {
  it("exports a project comparison with exact totals and the lowest flag", () => {
    const csv = comparisonCsv({
      quotations: [{ documentId: "d", fileName: "q.pdf", documentStatus: "completed", approved: true, supplierId: "s", supplierName: "Ningbo", quotationNumber: "N-1", quotationDate: "2026-03-01", validityDate: null, currency: "USD", totalAmount: "1150.00", incoterm: "FOB", productCount: 2, lowestInCurrency: true }],
    });
    expect(csv.split("\r\n")[0]).toBe("﻿Supplier,Quotation,Quotation date,Valid until,Total,Currency,Lowest in currency,Incoterm,Products,Approved,File");
    expect(csv.split("\r\n")[1]).toBe("Ningbo,N-1,2026-03-01,,1150.00,USD,yes,FOB,2,yes,q.pdf");
  });
  it("exports suppliers and supplier products", () => {
    const suppliers = suppliersCsv([{ id: "s", name: "Ningbo", aliases: ["Ningbo", "NINGBO CO"], country: "China", email: null, website: null, quotationCount: 2, approvedCount: 1, productCount: 3, currencies: ["USD", "EUR"], projects: [{ id: "p", name: "Cups" }], lastActivityAt: new Date("2026-03-01T10:00:00Z") }]);
    expect(suppliers.split("\r\n")[1]).toBe("Ningbo,China,,,2,1,3,USD; EUR,Cups,Ningbo; NINGBO CO,2026-03-01");
    const products = supplierProductsCsv([{ documentId: "d", quotationNumber: "N-1", quotationDate: null, approved: false, reference: "CUP-1", description: "Cup, 330 ml", material: "PP", unitPrice: "0.142", currency: "USD", priceBasis: "per piece", minimumOrderQuantity: "50000", quantityUnit: "pieces", leadTime: "25 days" }]);
    expect(products.split("\r\n")[1]).toBe('CUP-1,"Cup, 330 ml",PP,0.142,USD,per piece,50000,pieces,25 days,N-1,,no');
  });
});
