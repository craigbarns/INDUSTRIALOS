import { data, tenantRoute } from "@/lib/api";
import { analyticsOverview } from "@/lib/analytics";
export const GET = tenantRoute(async (_request, ctx) => data(await analyticsOverview(ctx)));
