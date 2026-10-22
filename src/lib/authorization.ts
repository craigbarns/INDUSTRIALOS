import { and, eq } from "drizzle-orm";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { member, organizations } from "./db/schema";
import { AppError } from "./errors";

export interface TenantContext { userId: string; organizationId: string; role: string }
export function assertMembership(row: { userId: string; organizationId: string; role: string } | undefined, userId: string, organizationId: string): TenantContext {
  if (!row || row.userId !== userId || row.organizationId !== organizationId) throw new AppError(403, "FORBIDDEN", "You do not have access to this workspace.");
  return { userId, organizationId, role: row.role };
}
export function isAdministrator(ctx: TenantContext) {
  return ctx.role.split(",").some(r => r === "owner" || r === "admin");
}
export function assertAdministrator(ctx: TenantContext) {
  if (!isAdministrator(ctx)) throw new AppError(403, "FORBIDDEN", "An organization administrator is required.");
}
export async function requireSession(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return session;
}
export async function requireContext(headers: Headers) {
  const session = await requireSession(headers);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) throw new AppError(409, "ORGANIZATION_REQUIRED", "Create or select an organization to continue.");
  const [membership] = await getDb().select().from(member).where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId))).limit(1);
  return assertMembership(membership, session.user.id, organizationId);
}
export async function requireOrganization(ctx: TenantContext) {
  const [org] = await getDb().select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!org) throw new AppError(403, "FORBIDDEN", "This workspace is unavailable.");
  return org;
}
