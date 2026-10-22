import { data, jsonBody, routeId, tenantRoute } from "@/lib/api";
import { approveExtraction, approvalRequestSchema } from "@/lib/repository";
export const POST = tenantRoute(async (request, ctx) => data(await approveExtraction(ctx, routeId(request), await jsonBody(request, approvalRequestSchema))));
