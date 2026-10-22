import { describe, expect, it } from "vitest";
import { normalizeSupplierName, supplierKey } from "@/lib/suppliers";

describe("supplier name normalization", () => {
  it("groups spelling, case, accent and legal-form variants of one supplier", () => {
    const variants = ["Ningbo Plastics Co., Ltd.", "NINGBO PLASTICS CO LTD", "  ningbo   plastics ", "Ningbo Plastics Company Limited"];
    expect(new Set(variants.map(normalizeSupplierName))).toEqual(new Set(["ningbo plastics"]));
    expect(normalizeSupplierName("Société Générale d'Emballage S.A.S.")).toBe("societe generale d emballage");
    expect(normalizeSupplierName("Müller & Söhne GmbH")).toBe("muller and sohne");
  });
  it("keeps distinct suppliers apart and preserves non-Latin names", () => {
    expect(normalizeSupplierName("Ningbo Plastics")).not.toBe(normalizeSupplierName("Ningbo Packaging"));
    expect(normalizeSupplierName("宁波塑料有限公司")).toBe("宁波塑料有限公司");
  });
  it("never reduces a name made only of a legal form to nothing", () => {
    expect(normalizeSupplierName("Limited")).toBe("limited");
    expect(normalizeSupplierName("")).toBeNull();
    expect(normalizeSupplierName("  .,- ")).toBeNull();
    expect(normalizeSupplierName(null)).toBeNull();
  });
  it("derives a stable, opaque URL key from the normalized name", () => {
    expect(supplierKey("ningbo plastics")).toMatch(/^[a-f0-9]{24}$/);
    expect(supplierKey("ningbo plastics")).toBe(supplierKey("ningbo plastics"));
    expect(supplierKey("ningbo plastics")).not.toBe(supplierKey("ningbo packaging"));
  });
});
