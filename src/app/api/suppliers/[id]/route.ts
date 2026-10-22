import { data, tenantRoute } from "@/lib/api";
import { csvResponse } from "@/lib/csv";
import { supplierProductsCsv } from "@/lib/exports";
import { getSupplier } from "@/lib/suppliers";
// Supplier IDs are opaque name hashes, validated by getSupplier rather than routeId's UUID check.
export const GET = tenantRoute(async (request, ctx) => {
  const url = new URL(request.url);
  const result = await getSupplier(ctx, url.pathname.split("/").at(-1) ?? "");
  if (url.searchParams.get("format") === "csv") return csvResponse(`${result.supplier.name} - products`, supplierProductsCsv(result.products));
  return data(result);
});
