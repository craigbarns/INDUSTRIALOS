import { z } from "zod";

export const modelFieldSchema = z.object({
  value: z.string().max(8_000).nullable(),
  originalText: z.string().max(12_000).nullable(),
  pageNumber: z.number().int().positive().nullable(),
  status: z.enum(["extracted", "missing", "ambiguous"]),
}).strict();

export const evidenceFieldSchema = modelFieldSchema.extend({
  documentId: z.string().uuid(),
  status: z.enum(["extracted", "missing", "ambiguous", "corrected"]),
});

function createSchema<F extends z.ZodType>(field: F) {
  const priceBreak = z.object({
    minimumQuantity: field,
    maximumQuantity: field,
    quantityUnit: field,
    unitPrice: field,
    currency: field,
    priceBasis: field,
  }).strict();
  const product = z.object({
    manufacturerReference: field,
    description: field,
    material: field,
    dimensions: field,
    weight: field,
    weightBasis: field,
    capacity: field,
    color: field,
    packagingDetails: field,
    unitPrice: field,
    currency: field,
    priceBasis: field,
    minimumOrderQuantity: field,
    quantityUnit: field,
    toolingCosts: field,
    productionLeadTime: field,
    foodContactCompliance: field,
    priceBreaks: z.array(priceBreak).max(100),
  }).strict();
  return z.object({
    documentType: field,
    supplier: z.object({ name: field, country: field, address: field, email: field, website: field }).strict(),
    quotation: z.object({ number: field, date: field, validityDate: field, currency: field, paymentTerms: field }).strict(),
    products: z.array(product).max(500),
    pricing: z.object({ totalAmount: field, currency: field, toolingCosts: field, notes: field }).strict(),
    logistics: z.object({ incoterm: field, shippingOrigin: field, productionCountry: field, deliveryTerms: field }).strict(),
    compliance: z.object({ certificationsMentioned: field, foodContactDeclarations: field, technicalStandards: field, qualityRequirements: field }).strict(),
  }).strict();
}

/** The model cannot choose a document ID. It is assigned by the trusted application. */
export const modelExtractionSchema = createSchema(modelFieldSchema);
export const procurementExtractionSchema = createSchema(evidenceFieldSchema);
export type ModelExtraction = z.infer<typeof modelExtractionSchema>;
export type ProcurementExtraction = z.infer<typeof procurementExtractionSchema>;
export type EvidenceField = z.infer<typeof evidenceFieldSchema>;
export type EvidenceEntry = EvidenceField & { path: string };

export function flattenEvidence(data: ProcurementExtraction): EvidenceEntry[] {
  const entries: EvidenceEntry[] = [];
  function visit(value: unknown, path: string) {
    if (value !== null && typeof value === "object" && "status" in value && "documentId" in value) {
      entries.push({ ...(value as EvidenceField), path });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index}`));
    } else if (value !== null && typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
    }
  }
  visit(data, "");
  return entries;
}

/** Used for empty states and tests; it never introduces illustrative customer data. */
export function emptyModelExtraction(): ModelExtraction {
  const field = () => ({ value: null, originalText: null, pageNumber: null, status: "missing" as const });
  return {
    documentType: field(),
    supplier: { name: field(), country: field(), address: field(), email: field(), website: field() },
    quotation: { number: field(), date: field(), validityDate: field(), currency: field(), paymentTerms: field() },
    products: [],
    pricing: { totalAmount: field(), currency: field(), toolingCosts: field(), notes: field() },
    logistics: { incoterm: field(), shippingOrigin: field(), productionCountry: field(), deliveryTerms: field() },
    compliance: { certificationsMentioned: field(), foodContactDeclarations: field(), technicalStandards: field(), qualityRequirements: field() },
  };
}
