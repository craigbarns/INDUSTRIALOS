import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
export async function GET() {
  try { await getDb().execute(sql`select 1`); return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
