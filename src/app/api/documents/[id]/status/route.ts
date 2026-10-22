import { data, routeId, tenantRoute } from "@/lib/api";
import { getDocument } from "@/lib/repository";
export const GET = tenantRoute(async (request, ctx) => {
  const document = await getDocument(ctx, routeId(request));
  return data({ status: document.status, errorCode: document.errorCode, pageCount: document.pageCount, approvedAt: document.approvedAt });
});
