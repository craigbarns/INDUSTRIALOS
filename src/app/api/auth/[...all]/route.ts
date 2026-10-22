import { getAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
export const runtime = "nodejs";
async function handler(request: Request) { try { return await getAuth().handler(request); } catch (error) { return errorResponse(error); } }
export const GET = handler;
export const POST = handler;
