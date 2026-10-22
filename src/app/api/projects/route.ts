import { data, jsonBody, tenantRoute } from "@/lib/api";
import { createProject, createProjectSchema, listProjects } from "@/lib/repository";
export const GET = tenantRoute(async (_request, ctx) => data(await listProjects(ctx)));
export const POST = tenantRoute(async (request, ctx) => data(await createProject(ctx, await jsonBody(request, createProjectSchema)), 201));
