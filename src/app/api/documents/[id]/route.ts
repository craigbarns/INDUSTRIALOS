import { data, routeId, tenantRoute } from "@/lib/api";
import { deleteDocument, getDocument } from "@/lib/repository";
export const GET = tenantRoute(async (request, ctx) => data(await getDocument(ctx, routeId(request))));
export const DELETE = tenantRoute(async (request, ctx) => data(await deleteDocument(ctx, routeId(request))));
