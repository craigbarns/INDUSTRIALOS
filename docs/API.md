# API reference

All application routes below require a Better Auth session cookie and a current, server-verified organization membership. The organization is derived from the session; request bodies cannot override it. Unauthenticated requests return 401, missing active organization returns 409, and inaccessible record IDs return 404. Mutation requests must provide the same `Origin` as `BETTER_AUTH_URL`.

Successful JSON responses use `{ "data": ... }`. Errors use `{ "error": { "code": "INVALID_INPUT", "message": "..." } }`. Dates are ISO strings. IDs of application-owned records are UUIDs. Private file bytes are the only non-JSON success response. Responses containing customer information use `Cache-Control: no-store`.

| Method and route | Request | Successful `data` |
| --- | --- | --- |
| `GET /api/workspace` | — | `user`, `organization` or null, `role`, accessible `organizations` |
| `GET /api/dashboard` | — | `metrics`, `recentProjects`, `recentDocuments` |
| `POST /api/projects` | `{name, description?: string \| null}` | Created project, 201 |
| `GET /api/projects` | — | Current organization's projects, newest updated first |
| `GET /api/projects/:id` | — | `{project, documents}` |
| `PATCH /api/projects/:id` | `{name?, description?, status?: "active" \| "completed" \| "archived"}` | Updated project |
| `GET /api/projects/:id/comparison` | — | `{project, quotations, supplierCount}`: the project's analyzed quotations with supplier, total, currency, Incoterm, validity and `lowestInCurrency`, cheapest first within each currency |
| `POST /api/documents/upload` | Multipart: one `file`, optional `projectId` | Stored document metadata, 201 |
| `GET /api/documents` | — | Current organization's document metadata |
| `GET /api/documents/:id` | — | Document metadata, without object storage key |
| `PATCH /api/documents/:id` | `{projectId: uuid \| null}` | Document metadata. Any member may move a document into a project of the same organization, between projects, or out (`null`). Archived projects return 409 `PROJECT_ARCHIVED`; each actual move adds a `document.moved` audit record |
| `DELETE /api/documents/:id` | — | `{id}`. Uploader or owner/admin only (403 otherwise). Removes the private file first, then the document, pages, analysis and jobs; adds a `document.deleted` audit record. Storage failure returns 503 and leaves the document in place so the request can be retried |
| `GET /api/documents/:id/content` | — | Authorized file bytes; private/no-store/nosniff |
| `POST /api/documents/:id/analyze` | `{}` | `{jobId, documentId, status, duplicate}`, 202 |
| `GET /api/documents/:id/status` | — | `{status, errorCode, pageCount, approvedAt}` |
| `GET /api/documents/:id/extraction` | — | Current `data`, immutable `originalData`, flattened `fields`, `version`, `pages`, `corrections`, `issues`, `approvalIssues`, `approvedAt` |
| `PATCH /api/documents/:id/extraction` | `{version, corrections: [{path, value: string \| null, status: "corrected" \| "ambiguous"}]}` | Updated extraction |
| `POST /api/documents/:id/approve` | `{version}` | Approved extraction |
| `GET /api/suppliers` | — | Suppliers found in analyzed documents: `id`, `name`, `aliases`, `country`, `email`, `website`, `quotationCount`, `approvedCount`, `productCount`, `currencies`, `projects`, `lastActivityAt` |
| `GET /api/suppliers/:id` | — | `{supplier, quotations, products}` for one supplier |
| `GET /api/analytics` | — | `totals`, document `statuses`, 12 UTC `monthly` buckets of uploads and approvals, supplier `countries`, quotation coverage per `projects` |
| `GET /api/settings/organization` | — | Organization name, slug, AI permission and deployment AI availability |
| `PATCH /api/settings/organization` | `{name?, aiProcessingEnabled?}` | Updated organization settings; owner/admin required |
| `GET /api/health` | — | Public database readiness status, 200 or 503 |

Project names are 1–160 characters, descriptions at most 5,000. Lists currently return at most 1,000 records; larger workspaces require pagination before rollout. Uploads support PDF/PNG/JPEG up to 20 MiB with server validation. Upload and analysis routes each permit ten requests per user/workspace/minute; other application routes share a 180-request limit. Better Auth separately applies database-backed auth rate limits.

## Suppliers

Suppliers are not stored as separate records yet. They are derived on each request from the current (corrected, otherwise original) extraction of the organization's analyzed documents, grouped by a normalized supplier name: case, accents, punctuation and trailing legal forms such as `Co., Ltd.`, `GmbH` or `SAS` are ignored. A supplier `id` is an opaque 24-character hash of that normalized name, scoped to the organization; it is not a UUID and changes if every quotation's supplier name is corrected to a different name. Profile fields prefer approved quotations, then the most recent ones. Values from unapproved quotations are returned with `approved: false` and still require review. Documents without a supplier name are not listed.

## CSV exports

`GET /api/projects/:id/comparison`, `GET /api/suppliers` and `GET /api/suppliers/:id` accept `?format=csv` and then return a private attachment (`text/csv; charset=utf-8`, `Cache-Control: private, no-store`) instead of JSON: the quotation comparison, the supplier list, and one supplier's quoted products. Files are RFC 4180 with comma separators, CRLF rows and a UTF-8 byte order mark. Amounts keep their exact extracted decimal strings with a `.` decimal point. Because cell values come from untrusted documents, any value starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an apostrophe so spreadsheets do not evaluate it as a formula.

## Analytics and quotation comparison

Analytics are computed on request from the organization's own documents and current extractions; nothing is pre-aggregated or seeded. Quotation totals are compared only within one currency, as exact decimal strings, with no exchange-rate conversion. Every quotation tied for the lowest total in its currency has `lowestInCurrency: true`. Quotations without a total or currency are listed last. The comparison does not check that quotations cover the same quantities, Incoterm or validity period; the user interface says so.

## Correction example

```json
{
  "version": 1,
  "corrections": [
    {
      "path": "products.0.unitPrice",
      "value": "0.8500",
      "status": "corrected"
    }
  ]
}
```

This is request syntax only, not customer data. Financial values remain exact decimal strings. Only existing schema leaf paths can be edited. The frontend cannot rewrite source text, page references or document IDs. Missing original evidence remains explicitly missing for a user-added value. All changes include the previous value, corrected value, original evidence, author, timestamp and version in the audit trail.

Stale writes return `409 VERSION_CONFLICT`. Approval with unresolved uncertainty or absent price/quantity basis returns `422 REVIEW_REQUIRED`. A correction after approval resets approval. An analysis that already exists cannot be replaced by another job. Duplicate queued analysis requests return the existing job ID without another provider task.

## Better Auth

The maintained Better Auth handler is mounted at `/api/auth/*`; the UI uses its typed client for signup, signin, session handling, signout, profile/password changes, organization creation/selection and member/invitation actions. Its error response format follows Better Auth rather than the application envelope. Invitations require verified ownership of the recipient email, including when a link is copied manually. No invite is sent through an external tool by this application workflow.

## Processing failures

`AI_PROCESSING_DISABLED` means deployment or organization permission is absent. `MISTRAL_NOT_CONFIGURED` and `STORAGE_NOT_CONFIGURED` identify missing configuration. `OCR_EMPTY_DOCUMENT`, `OCR_MISSING_PAGES`, provider failures and `EXTRACTION_DOCUMENT_TOO_LONG` are safe status codes without confidential OCR content. Transient provider/network failures retry durably; unsupported or oversized input requires user action.
