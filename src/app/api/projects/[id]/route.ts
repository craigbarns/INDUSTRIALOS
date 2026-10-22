import { data, jsonBody, routeId, tenantRoute } from "@/lib/api";
import { getProject, listDocuments, updateProject, updateProjectSchema } from "@/lib/repository";
export const GET = tenantRoute(async (request, ctx) => {
  const id = routeId(request);
  const project = await getProject(ctx, id);
  return data({ project, documents: await listDocuments(ctx, id) });
});
export const PATCH = tenantRoute(async (request, ctx) => data(await updateProject(ctx, routeId(request), await jsonBody(request, updateProjectSchema))));
