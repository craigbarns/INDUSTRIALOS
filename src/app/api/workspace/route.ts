import { and, eq } from "drizzle-orm";
import { data, errorResponse } from "@/lib/api";
import { requireSession } from "@/lib/authorization";
import { getDb } from "@/lib/db";
import { member, organizations } from "@/lib/db/schema";
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const rows = await getDb().select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: member.role }).from(organizations).innerJoin(member, and(eq(member.organizationId, organizations.id), eq(member.userId, session.user.id)));
    const active = rows.find(row => row.id === session.session.activeOrganizationId);
    return data({ user: { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: session.user.emailVerified }, organization: active ? { id: active.id, name: active.name, slug: active.slug } : null, role: active?.role ?? null, organizations: rows.map(({ id, name, slug }) => ({ id, name, slug })) });
  } catch (error) { return errorResponse(error); }
}
