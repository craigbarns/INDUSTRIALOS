import { data, jsonBody, routeId, tenantRoute } from "@/lib/api";
import { correctExtraction, correctionRequestSchema, getExtraction } from "@/lib/repository";
export const GET = tenantRoute(async (request, ctx) => data(await getExtraction(ctx, routeId(request))));
export const PATCH = tenantRoute(async (request, ctx) => data(await correctExtraction(ctx, routeId(request), await jsonBody(request, correctionRequestSchema))));
