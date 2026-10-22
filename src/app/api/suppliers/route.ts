import { data, tenantRoute } from "@/lib/api";
import { csvResponse } from "@/lib/csv";
import { suppliersCsv } from "@/lib/exports";
import { listSuppliers } from "@/lib/suppliers";
export const GET = tenantRoute(async (request, ctx) => {
  const suppliers = await listSuppliers(ctx);
  if (new URL(request.url).searchParams.get("format") === "csv") return csvResponse("Suppliers", suppliersCsv(suppliers));
  return data(suppliers);
});
