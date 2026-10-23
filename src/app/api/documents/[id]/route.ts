import { data, jsonBody, routeId, tenantRoute } from "@/lib/api";
import { deleteDocument, getDocument, moveDocument, moveDocumentSchema } from "@/lib/repository";
export const GET = tenantRoute(async (request, ctx) => data(await getDocument(ctx, routeId(request))));
export const PATCH = tenantRoute(async (request, ctx) => data(await moveDocument(ctx, routeId(request), await jsonBody(request, moveDocumentSchema))));
export const DELETE = tenantRoute(async (request, ctx) => data(await deleteDocument(ctx, routeId(request))));
