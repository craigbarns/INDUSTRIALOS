import { data, tenantRoute } from "@/lib/api";
import { dashboard } from "@/lib/repository";
export const GET = tenantRoute(async (_request, ctx) => data(await dashboard(ctx)));
