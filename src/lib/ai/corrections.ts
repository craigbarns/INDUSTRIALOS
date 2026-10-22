import { z } from "zod";
import { flattenEvidence, procurementExtractionSchema, type EvidenceField, type ProcurementExtraction } from "./extraction-schema";
import { decimalKeys, isDecimalString } from "./field-validation";

export const correctionSchema = z.object({
  path: z.string().min(1).max(200),
  value: z.string().trim().min(1).max(8_000).nullable(),
  status: z.enum(["corrected", "ambiguous"]).default("corrected"),
}).strict().superRefine((correction, ctx) => {
  const key = correction.path.split(".").at(-1);
  if (correction.value !== null && key && decimalKeys.has(key) && !isDecimalString(correction.value)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Use an exact non-negative decimal string, without currency symbols, grouping, rounding or unit conversion." });
  }
  if (correction.value !== null && key === "currency" && !/^[A-Z]{3}$/.test(correction.value)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "Currency must be an explicit three-letter uppercase code. Flag an uncertain currency for review." });
  }
});
export const correctionsSchema = z.array(correctionSchema).min(1).max(200).superRefine((corrections, ctx) => {
  const paths = new Set<string>();
  corrections.forEach((correction, index) => {
    if (paths.has(correction.path)) ctx.addIssue({ code: "custom", path: [index, "path"], message: "A field may only be corrected once per request." });
    paths.add(correction.path);
  });
});
export type FieldCorrection = z.infer<typeof correctionSchema>;
export interface FieldChange {
  path: string;
  before: EvidenceField;
  after: EvidenceField;
  original: EvidenceField;
}

/** The API must persist changes with actor, organization, document, version and timestamp. */
export function applyCorrections(
  current: ProcurementExtraction,
  original: ProcurementExtraction,
  input: unknown,
): { data: ProcurementExtraction; changes: FieldChange[] } {
  const corrections = correctionsSchema.parse(input);
  const data = procurementExtractionSchema.parse(structuredClone(current));
  const originalData = procurementExtractionSchema.parse(original);
  const currentFields = new Map(flattenEvidence(data).map(({ path, ...field }) => [path, field]));
  const originalFields = new Map(flattenEvidence(originalData).map(({ path, ...field }) => [path, field]));
  const changes: FieldChange[] = [];
  for (const correction of corrections) {
    const before = currentFields.get(correction.path);
    const source = originalFields.get(correction.path);
    if (!before || !source || correction.path.split(".").some((key) => ["__proto__", "prototype", "constructor"].includes(key))) {
      throw new z.ZodError([{ code: "custom", path: ["corrections"], message: "Invalid correction field path." }]);
    }
    if (before.documentId !== source.documentId) throw new z.ZodError([{ code: "custom", path: ["corrections"], message: "Correction source document mismatch." }]);
    const after: EvidenceField = {
      value: correction.value,
      status: correction.status,
      documentId: source.documentId,
      // Users correct interpretations, not the stored OCR evidence. Missing source stays explicit.
      originalText: source.originalText,
      pageNumber: source.pageNumber,
    };
    const parts = correction.path.split(".");
    let target: unknown = data;
    for (const key of parts.slice(0, -1)) {
      target = (target as Record<string, unknown>)[key];
    }
    (target as Record<string, unknown>)[parts.at(-1)!] = after;
    changes.push({ path: correction.path, before, after, original: source });
  }
  return { data: procurementExtractionSchema.parse(data), changes };
}

export function approvalIssues(data: ProcurementExtraction): string[] {
  const fields = flattenEvidence(procurementExtractionSchema.parse(data));
  const issues = fields.filter((field) => field.status === "ambiguous").map((field) => `${field.path}: resolve or explicitly correct the uncertain field before approval`);
  data.products.forEach((product, index) => {
    const requireBasis = (amount: EvidenceField, basis: EvidenceField, path: string) => {
      if (amount.value !== null && basis.value === null) issues.push(`${path}: supply the source's explicit unit or basis before approval`);
    };
    requireBasis(product.unitPrice, product.priceBasis, `products.${index}.priceBasis`);
    requireBasis(product.minimumOrderQuantity, product.quantityUnit, `products.${index}.quantityUnit`);
    requireBasis(product.weight, product.weightBasis, `products.${index}.weightBasis`);
    product.priceBreaks.forEach((tier, tierIndex) => {
      requireBasis(tier.unitPrice, tier.priceBasis, `products.${index}.priceBreaks.${tierIndex}.priceBasis`);
      requireBasis(tier.minimumQuantity, tier.quantityUnit, `products.${index}.priceBreaks.${tierIndex}.quantityUnit`);
    });
  });
  return issues;
}

export function canApprove(data: ProcurementExtraction): boolean {
  return approvalIssues(data).length === 0;
}
