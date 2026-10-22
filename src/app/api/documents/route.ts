import { data, tenantRoute } from "@/lib/api";
import { listDocuments } from "@/lib/repository";
export const GET = tenantRoute(async (_request, ctx) => data(await listDocuments(ctx)));
