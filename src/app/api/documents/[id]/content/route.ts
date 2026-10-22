import { routeId, tenantRoute } from "@/lib/api";
import { getDocumentReference } from "@/lib/repository";
import { readDocumentFile } from "@/lib/storage";
export const GET = tenantRoute(async (request, ctx) => {
  const document = await getDocumentReference(ctx, routeId(request));
  const file = await readDocumentFile({ organizationId: ctx.organizationId, documentId: document.id, storageKey: document.storageKey });
  // Chrome's native PDF renderer cannot run inside a sandboxed response.
  // Upload validation rejects active PDFs; all originals still require membership authorization.
  const sandbox = document.mimeType === "application/pdf" ? "" : "sandbox; ";
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; ${sandbox}frame-ancestors 'self'`,
    },
  });
});
