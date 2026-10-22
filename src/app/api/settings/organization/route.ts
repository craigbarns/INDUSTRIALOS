import { eq } from "drizzle-orm";
import { z } from "zod";
import { data, jsonBody, tenantRoute } from "@/lib/api";
import { assertAdministrator, requireOrganization } from "@/lib/authorization";
import { getDb } from "@/lib/db";
import { auditLogs, organizations } from "@/lib/db/schema";
export const GET = tenantRoute(async (_request, ctx) => {
  const org = await requireOrganization(ctx);
  return data({ id: org.id, name: org.name, slug: org.slug, aiProcessingEnabled: org.aiProcessingEnabled, deploymentAiEnabled: process.env.AI_PROCESSING_ENABLED === "true" });
});
export const PATCH = tenantRoute(async (request, ctx) => {
  assertAdministrator(ctx);
  const input = await jsonBody(request, z.object({ name: z.string().trim().min(1).max(160).optional(), aiProcessingEnabled: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0));
  const org = await getDb().transaction(async tx => {
    const [result] = await tx.update(organizations).set(input).where(eq(organizations.id, ctx.organizationId)).returning();
    await tx.insert(auditLogs).values({ organizationId: ctx.organizationId, userId: ctx.userId, action: "organization.settings_updated", details: input });
    return result;
  });
  return data({ id: org.id, name: org.name, slug: org.slug, aiProcessingEnabled: org.aiProcessingEnabled });
});
