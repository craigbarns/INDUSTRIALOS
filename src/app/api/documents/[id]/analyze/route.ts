import { z } from "zod";
import { data, jsonBody, routeId, tenantRoute } from "@/lib/api";
import { enqueueDocumentAnalysis } from "@/lib/jobs/queue";
export const POST = tenantRoute(async (request, ctx) => {
  await jsonBody(request, z.object({}).strict());
  return data(await enqueueDocumentAnalysis(ctx, routeId(request)), 202);
}, { bucket: "analysis", limit: 10 });
