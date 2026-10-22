import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ZodError, z } from "zod";
import { getDb } from "./db";
import { AppError } from "./errors";
import { requireContext, type TenantContext } from "./authorization";
import { StorageError } from "./storage";
import { UploadValidationError } from "./upload-validation";

export function data(value: unknown, status = 200) { return Response.json({ data: value }, { status, headers: { "Cache-Control": "no-store" } }); }
export function errorResponse(error: unknown) {
  if (error instanceof UploadValidationError) return errorResponse(new AppError(error.code === "INVALID_FILE_SIZE" ? 413 : 400, error.code, error.message));
  if (error instanceof StorageError) return errorResponse(new AppError(503, error.code, error.message));
  if (error instanceof AppError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: { code: "INVALID_INPUT", message: "The request contains invalid or missing values." } }, { status: 400 });
  // Do not emit raw errors: SQL values, storage URLs and provider content may be confidential.
  console.error(JSON.stringify({ event: "api_failure", code: "INTERNAL_ERROR" }));
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed. Please try again." } }, { status: 500 });
}
export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== expected) throw new AppError(403, "INVALID_ORIGIN", "This request origin is not permitted.");
}
export async function consumeRateLimit(key: string, max = 100, windowSeconds = 60) {
  const id = createHash("sha256").update(key).digest("hex");
  const result = await getDb().execute(sql`
    INSERT INTO api_rate_limits (id, count, resets_at) VALUES (${id}, 1, now() + ${windowSeconds} * interval '1 second')
    ON CONFLICT (id) DO UPDATE SET
      count = CASE WHEN api_rate_limits.resets_at <= now() THEN 1 ELSE api_rate_limits.count + 1 END,
      resets_at = CASE WHEN api_rate_limits.resets_at <= now() THEN now() + ${windowSeconds} * interval '1 second' ELSE api_rate_limits.resets_at END
    RETURNING count`);
  if (Number(result.rows[0]?.count) > max) throw new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a minute and try again.");
}
export function tenantRoute(handler: (request: Request, ctx: TenantContext) => Promise<Response>, options: { limit?: number; bucket?: string } = {}) {
  return async (request: Request) => {
    try {
      assertSameOrigin(request);
      const ctx = await requireContext(request.headers);
      await consumeRateLimit(`${ctx.userId}:${ctx.organizationId}:${options.bucket ?? "api"}`, options.limit ?? 180);
      return await handler(request, ctx);
    } catch (error) { return errorResponse(error); }
  };
}
export async function jsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const bytes = await limitedBody(request, 128 * 1024);
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
export async function limitedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length") ?? "0") > max) throw new AppError(413, "TOO_LARGE", "The request exceeds the permitted size.");
  if (!request.body) throw new AppError(400, "EMPTY_BODY", "The request body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new AppError(413, "TOO_LARGE", "The request exceeds the permitted size."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
export function routeId(request: Request) {
  const segments = new URL(request.url).pathname.split("/");
  const base = segments.indexOf("documents") >= 0 ? "documents" : "projects";
  return z.uuid().parse(segments[segments.indexOf(base) + 1]);
}
