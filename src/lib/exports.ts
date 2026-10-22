import { toCsv } from "./csv";
import type { ComparedQuotation } from "./analytics";
import type { SupplierProduct, SupplierSummary } from "./suppliers";

// Financial values stay the exact decimal strings from the extraction; nothing is reformatted or converted.
export function comparisonCsv(result: { quotations: ComparedQuotation[] }) {
  return toCsv(
    ["Supplier", "Quotation", "Quotation date", "Valid until", "Total", "Currency", "Lowest in currency", "Incoterm", "Products", "Approved", "File"],
    result.quotations.map(q => [q.supplierName, q.quotationNumber, q.quotationDate, q.validityDate, q.totalAmount, q.currency, q.lowestInCurrency, q.incoterm, q.productCount, q.approved, q.fileName]),
  );
}
export function suppliersCsv(suppliers: SupplierSummary[]) {
  return toCsv(
    ["Supplier", "Country", "Email", "Website", "Quotations", "Approved quotations", "Products quoted", "Currencies", "Projects", "Names in documents", "Last activity"],
    suppliers.map(s => [s.name, s.country, s.email, s.website, s.quotationCount, s.approvedCount, s.productCount, s.currencies.join("; "), s.projects.map(p => p.name).join("; "), s.aliases.join("; "), s.lastActivityAt.toISOString().slice(0, 10)]),
  );
}
export function supplierProductsCsv(products: SupplierProduct[]) {
  return toCsv(
    ["Reference", "Description", "Material", "Unit price", "Currency", "Price basis", "Minimum order", "Quantity unit", "Lead time", "Quotation", "Quotation date", "Approved"],
    products.map(p => [p.reference, p.description, p.material, p.unitPrice, p.currency, p.priceBasis, p.minimumOrderQuantity, p.quantityUnit, p.leadTime, p.quotationNumber, p.quotationDate, p.approved]),
  );
}
