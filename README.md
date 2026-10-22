# Industrial OS

Industrial procurement document intelligence, built with Next.js, React, TypeScript, Tailwind, shadcn/ui patterns, Better Auth, Drizzle and PostgreSQL. Railway hosts the web application, a separate durable worker, PostgreSQL and a private S3-compatible bucket. Mistral OCR and structured extraction are separate direct API operations.

Sprint 1 includes email/password authentication, organization workspaces and membership, procurement projects, private document uploads, document processing, source-linked extraction, corrections, approval and audit history. A Suppliers directory groups the suppliers found in analyzed documents with their quotations and quoted products. Analytics shows processing and review activity, suppliers per country and quotation coverage per project, and each project compares its quotations side by side within the same currency. Dashboard metrics come from PostgreSQL; there is no seeded customer or analytical data.

## Requirements

- Node.js 22.12 or newer and npm. The Railway container uses Node 22.
- PostgreSQL 15 or newer. PostgreSQL 17 or 18 is suitable for local development.
- A private Railway bucket, or a local S3-compatible service for development.
- A Mistral API key only when you choose to enable real document processing.
- SMTP for email verification and accepting invitations. No invitation email is sent automatically; administrators copy the invitation link.

## Local setup

```sh
npm ci
cp .env.example .env
```

Create a local PostgreSQL database. For example, with Docker installed:

```sh
docker run --name industrial-os-postgres \
  -e POSTGRES_USER=industrial \
  -e POSTGRES_PASSWORD=local-development-only \
  -e POSTGRES_DB=industrial_os \
  -p 5432:5432 -v industrial-os-pg:/var/lib/postgresql/data \
  -d postgres:17
```

Set `DATABASE_URL=postgresql://industrial:local-development-only@localhost:5432/industrial_os` in `.env`. Generate a secret with `openssl rand -base64 48` and place it in `BETTER_AUTH_SECRET`. Set `BETTER_AUTH_URL=http://localhost:3000`.

Apply the committed migrations, including the maintained pg-boss schema:

```sh
npm run db:migrate
```

Start the web application and worker in separate terminals:

```sh
npm run dev
```

```sh
npm run worker
```

Open `http://localhost:3000`, sign up, and create your organization. A new login may require selecting your existing organization. Without storage or Mistral credentials, authentication, organization settings and projects still work; document operations report the configuration that is missing.

The web and worker read `.env` locally. Next.js also supports `.env.local`; put shared worker variables in `.env`. Web and worker health endpoints are `/api/health` and `http://localhost:3001/health` respectively.

## Environment variables

The complete commented template is [`.env.example`](.env.example).

| Variables | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for web, migrations and worker |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Stable session secret and exact public origin; HTTPS is required in production |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION` | Private object storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Server-only bucket credentials |
| `S3_FORCE_PATH_STYLE` | `false` for current Railway buckets; only use `true` for compatible local/legacy storage |
| `MISTRAL_API_KEY`, `MISTRAL_OCR_MODEL`, `MISTRAL_EXTRACTION_MODEL` | Direct OCR and extraction provider configuration |
| `MISTRAL_EXTRACTION_MAX_TOKENS` | Output budget per extraction page range, default `65536`; adapt when changing models |
| `AI_PROCESSING_ENABLED` | Deployment permission, disabled by default |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | TLS email verification transport |
| `REQUIRE_EMAIL_VERIFICATION` | Enable with SMTP for public production registration; invitations always require verified email |
| `WORKER_HEALTH_PORT` | Local worker port; Railway supplies `PORT` |
| `OPENROUTER_API_KEY` | Reserved and unused in Sprint 1 |

Railway bucket variables are named `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, and `SECRET_ACCESS_KEY`; map them to the application `S3_*` variables. No secret belongs in a `NEXT_PUBLIC_*` variable.

Before sending documents to Mistral, the operator must configure contractual and privacy safeguards and set `AI_PROCESSING_ENABLED=true`. An organization owner/admin must separately enable processing in Settings → Organization. The worker checks these permissions before each provider operation and before saving results.

## Document workflow

1. Sign in and select an organization.
2. Create a procurement project.
3. Upload a PDF, PNG or JPEG of up to 20 MiB.
4. Open the document and choose Analyze document.
5. The upload request returns independently of OCR. PostgreSQL holds a durable pg-boss job for the worker.
6. Review the original beside structured supplier, quotation, product, pricing, logistics and compliance fields.
7. Correct missing or inaccurate values, resolve uncertain fields and save.
8. Approve the current version. Further corrections invalidate approval and require another review.

Every extracted leaf contains its value, source text, document ID, page and status. Monetary values are decimal strings. Original extraction and OCR pages remain separate from user corrections. Corrections and approvals use optimistic versions and transactional audit records. Audit history retains the original document ID even after document deletion. The person who uploaded a document, or an organization owner/admin, can delete it from the document page: the private file is removed from storage first, then its pages, analysis and corrections; the audit trail records the deletion.

## Migrations

Schema changes belong in `src/lib/db/schema.ts`. Generate and review a new migration:

```sh
npm run db:generate
npm run db:migrate
```

Commit the SQL migrations and Drizzle metadata together. Run migrations once per release before starting the worker. Do not use `drizzle-kit push` for production releases. Better Auth uses its maintained organization plugin and application-generated text IDs; it does not rely on missing database defaults for authentication IDs. Application-owned entities use PostgreSQL UUIDs.

## Tests and production build

```sh
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
```

`npm test` includes `tests/integration`. These tests apply the committed migrations to PGlite, an embedded PostgreSQL engine, and exercise real Better Auth sessions, tenant-scoped queries, correction/approval transactions, audit retention and pg-boss SQL. Mistral and S3 tests use controlled responses; no production documents or paid API calls are involved. PGlite does not replace a deployment test on Railway or a multi-process PostgreSQL concurrency test.

The private PDF regression test launches installed Google Chrome, serves the actual authorized content handler with a synthetic storage fixture, and verifies the native PDF iframe. For CI without Chrome, install Chromium with `npx playwright install --with-deps chromium` and run tests with `PLAYWRIGHT_CHANNEL=chromium`. The test saves a screenshot under `test-results/` for visual verification.

Queue tests can also target a disposable PostgreSQL server:

```sh
TEST_DATABASE_URL=postgresql://... npm run test:db
```

They create and remove their own randomly named queue schema. Never point test configuration at production. An optional real Mistral test requires all of `RUN_MISTRAL_INTEGRATION=true`, `AI_PROCESSING_ENABLED=true`, `MISTRAL_API_KEY`, and `MISTRAL_INTEGRATION_FIXTURE=/absolute/path/to/an/authorized/sample.pdf`:

```sh
npm run test:mistral
```

This sends the supplied sample to Mistral and may incur charges. It is disabled unless explicitly configured. A successful mocked test is not evidence of successful provider integration.

## Architecture and limits

```text
Browser → Next.js API → Better Auth membership check → PostgreSQL
                    → private S3 bucket
                    → PostgreSQL pg-boss queue
                              ↓
                     dedicated Railway worker
                              ↓
                     Mistral OCR → structured extraction
                              ↓
                     PostgreSQL evidence and review data
```

The worker uses durable retries, exponential backoff, heartbeat recovery and transaction/version fences. A retry can repeat a provider call if the process stopped before committing the response; external calls are not exactly once. Completed/corrected analyses cannot be overwritten by re-analysis.

Extraction handles up to 350,000 OCR characters and 500 product rows. It processes bounded page ranges and subdivides ranges when output is truncated. A single page that still exceeds the output limit returns `EXTRACTION_DOCUMENT_TOO_LONG`; partial JSON is never saved. Products continuing across pages require careful human review. Conflicting document-level fields are marked ambiguous. These are explicit Sprint 1 limits, not silent truncation.

Upload validation checks size, extension, MIME and signatures, and rejects active/encrypted/embedded PDF indicators. It is not a full antivirus or file-sanitization engine. Authorization is enforced by the API and scoped repositories, with composite foreign keys preventing cross-organization relationships. Database row-level security is not enabled; database credentials must stay private.

## Deployment and reference

- [Railway setup, services, bucket mapping, migrations, health checks, backups and restore](docs/DEPLOYMENT.md)
- [API request/response formats](docs/API.md)
- [Mistral data flow, grounding checks, privacy configuration and limitations](docs/AI-DATA.md)

The implementation is prepared for Railway deployment. A real Railway/S3/Mistral end-to-end acceptance run still requires configured credentials and an authorized quotation. Future providers can implement the OCR/extraction interfaces without changing project, review or audit business logic. Autonomous sourcing, supplier communications and purchasing actions are outside Sprint 1.
