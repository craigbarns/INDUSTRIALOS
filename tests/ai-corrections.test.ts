import { describe, expect, it } from "vitest";
import { applyCorrections, canApprove, correctionsSchema } from "../src/lib/ai/corrections";
import { emptyModelExtraction } from "../src/lib/ai/extraction-schema";
import { validateExtraction } from "../src/lib/ai/procurement-extractor";

function fixture() {
  const raw = emptyModelExtraction();
  raw.supplier.name = { value: "Supplier", originalText: "Supplier", pageNumber: 1, status: "extracted" };
  return validateExtraction(raw, { documentId: "fdc45a27-8774-478d-8b41-3484674dd67b", provider: "mistral", model: "mock", pages: [{ pageNumber: 1, markdown: "Supplier" }] }).data;
}

describe("Review corrections and immutable source evidence", () => {
  it("preserves original machine extraction and source while recording user correction separately", () => {
    const original = fixture();
    const { data, changes } = applyCorrections(original, original, [{ path: "supplier.name", value: "Verified Supplier", status: "corrected" }]);
    expect(original.supplier.name.value).toBe("Supplier");
    expect(data.supplier.name).toMatchObject({ value: "Verified Supplier", status: "corrected", originalText: "Supplier", pageNumber: 1 });
    expect(changes[0]).toMatchObject({ path: "supplier.name", before: { value: "Supplier" }, after: { value: "Verified Supplier" }, original: { value: "Supplier" } });
  });

  it("adds a missing value without inventing supporting source text", () => {
    const original = fixture();
    const { data } = applyCorrections(original, original, [{ path: "supplier.country", value: "France" }]);
    expect(data.supplier.country).toMatchObject({ value: "France", status: "corrected", originalText: null, pageNumber: null });
  });

  it("preserves the original source across repeated user corrections", () => {
    const original = fixture();
    const first = applyCorrections(original, original, [{ path: "supplier.name", value: "First correction" }]);
    const second = applyCorrections(first.data, original, [{ path: "supplier.name", value: "Second correction" }]);
    expect(second.changes[0]!.before.value).toBe("First correction");
    expect(second.changes[0]!.original.value).toBe("Supplier");
    expect(second.data.supplier.name.originalText).toBe("Supplier");
  });

  it.each(["__proto__.polluted", "supplier.constructor", "products.999.unitPrice", "supplier.unknown", "supplier.name.value"])("rejects unrecognized or unsafe leaf path %s", (path) => {
    const original = fixture();
    expect(() => applyCorrections(original, original, [{ path, value: "0.85" }])).toThrow("Invalid correction field path");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects frontend-supplied source changes and duplicate corrections", () => {
    expect(correctionsSchema.safeParse([{ path: "supplier.name", value: "x", originalText: "new forged source" }]).success).toBe(false);
    expect(correctionsSchema.safeParse([{ path: "supplier.name", value: "x" }, { path: "supplier.name", value: "y" }]).success).toBe(false);
  });

  it.each(["0,85", "$0.85", "1,000.00", "0.85 per piece", "NaN", "-1"])("rejects ambiguous or invalid financial correction %s", (value) => {
    expect(correctionsSchema.safeParse([{ path: "pricing.totalAmount", value }]).success).toBe(false);
  });

  it("keeps exact financial decimal strings and permits an explicit missing value", () => {
    const original = fixture();
    const { data } = applyCorrections(original, original, [{ path: "pricing.totalAmount", value: "12345678901234567890.850000" }, { path: "supplier.name", value: null }]);
    expect(data.pricing.totalAmount.value).toBe("12345678901234567890.850000");
    expect(data.supplier.name.value).toBeNull();
    expect(data.supplier.name.status).toBe("corrected");
  });

  it("blocks approval until uncertain fields are explicitly resolved", () => {
    const original = fixture();
    const uncertain = applyCorrections(original, original, [{ path: "supplier.name", value: "Supplier?", status: "ambiguous" }]);
    expect(canApprove(uncertain.data)).toBe(false);
    const resolved = applyCorrections(uncertain.data, original, [{ path: "supplier.name", value: "Supplier", status: "corrected" }]);
    expect(canApprove(resolved.data)).toBe(true);
  });
});
