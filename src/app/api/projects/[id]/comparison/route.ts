import { data, routeId, tenantRoute } from "@/lib/api";
import { projectComparison } from "@/lib/analytics";
import { csvResponse } from "@/lib/csv";
import { comparisonCsv } from "@/lib/exports";
export const GET = tenantRoute(async (request, ctx) => {
  const result = await projectComparison(ctx, routeId(request));
  if (new URL(request.url).searchParams.get("format") === "csv") return csvResponse(`${result.project.name} - quotation comparison`, comparisonCsv(result));
  return data(result);
});
