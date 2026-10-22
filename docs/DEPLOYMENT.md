# Railway deployment

The same repository produces a Next.js web service and a dedicated Node.js document worker. PostgreSQL owns application data and the durable pg-boss queue. Original files stay in a private Railway bucket. No Supabase, Firebase, or Vercel service is required.

## 1. Provision resources

Create a Railway project and a staging environment. Add Railway PostgreSQL (PostgreSQL 15 or newer) and a bucket called `Documents`. Choose the data region required by your customer contracts before creating the bucket. Add two repository-backed services called `web` and `worker`, both using the root `Dockerfile`. Keep the worker as a persistent service, with sleeping/serverless mode disabled.

Railway documents bucket access in [Storage Buckets](https://docs.railway.com/storage-buckets). Credentials are `BUCKET`, `ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, and `SECRET_ACCESS_KEY`. They are bucket variable names; the application deliberately maps them to the `S3_*` variables listed in `.env.example`. Use the base endpoint from the Credentials tab and the actual bucket name. Current buckets use virtual hosted addressing; set `S3_FORCE_PATH_STYLE=true` only if the Credentials tab explicitly identifies a legacy path-style bucket.

## 2. Configure secrets and permissions

Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on both services. Supply the same S3 and Mistral variables to both. The web service needs a stable random `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=https://your-public-app-domain`. Never put credentials into `NEXT_PUBLIC_*` variables, source control, Docker build arguments, or application logs.

Set `S3_BUCKET=${{Documents.BUCKET}}`, `S3_ENDPOINT=${{Documents.ENDPOINT}}`, `S3_REGION=${{Documents.REGION}}`, `S3_ACCESS_KEY_ID=${{Documents.ACCESS_KEY_ID}}`, and `S3_SECRET_ACCESS_KEY=${{Documents.SECRET_ACCESS_KEY}}`. Keep Railway credentials scoped to this project and rotate them according to your access policy.

Leave `AI_PROCESSING_ENABLED=false` until the operator has reviewed the current Mistral agreement, data processing terms, retention, region, and customer permission requirements. Enabling this deployment flag alone does not authorize customer data: each organization's owner/admin must also enable AI processing in Organization settings. The worker rechecks this consent and the requesting user's membership before provider operations and before storing the result.

Configure SMTP and `REQUIRE_EMAIL_VERIFICATION=true` for public production registration and invitation acceptance. SMTP uses TLS; use port 465 with `SMTP_SECURE=true`, or STARTTLS on port 587. `OPENROUTER_API_KEY` is optional and unused.

## 3. Configure build and processes

`Dockerfile` installs pinned dependencies and builds the application without needing live provider credentials. It retains TypeScript tooling to run the separate worker and release migrations, and runs as the non-root `node` user. This image has not been deployed until a Railway deployment is explicitly executed.

| Setting | Web | Worker |
| --- | --- | --- |
| Build | Root Dockerfile | Root Dockerfile |
| Start | `node node_modules/next/dist/bin/next start --hostname 0.0.0.0` | `node --import tsx src/worker/index.ts` |
| Pre-deploy | `node --import tsx scripts/migrate.ts` | None |
| Health path | `/api/health` | `/health` |
| Health timeout | 120 seconds | 120 seconds |
| Draining | 30 seconds | 30 seconds |
| Restart | On failure | On failure |

Railway injects `PORT`; the worker health server binds to it. Only the web service needs a public domain. Both health endpoints return safe status information and check database connectivity.

`railway.web.json` and `railway.worker.json` preserve legacy deployment configuration; if using legacy Config as Code, choose the matching custom config file path for each service. Railway's current [Config as Code reference](https://docs.railway.com/config-as-code/reference) marks this format deprecated and states legacy support ends on December 1, 2026. For new services, apply the settings above in the dashboard or use the supported [Infrastructure as Code API](https://docs.railway.com/infrastructure-as-code/reference). Do not rely on legacy JSON after its retirement. A minimal modern service configuration is:

```ts
import { defineRailway, project, service } from "railway/iac";
export default defineRailway(() => project("industrial-os", {
  resources: [
    service("web", {
      start: "node node_modules/next/dist/bin/next start --hostname 0.0.0.0",
      preDeploy: "node --import tsx scripts/migrate.ts",
      healthcheck: "/api/health",
    }),
    service("worker", {
      start: "node --import tsx src/worker/index.ts",
      healthcheck: "/health",
    }),
  ],
}));
```

Use Railway's current CLI to generate/import `.railway/railway.ts` from the linked project and review the plan before applying it. The snippet preserves source/secrets managed in the dashboard and does not provision or destroy resources.

## 4. Migrate and release

Deploy the web service first. Its pre-deploy step applies version-controlled Drizzle SQL migrations and installs/updates pg-boss's maintained schema before the web process receives traffic. The application does not run `drizzle-kit push`. A failing migration must block the release. Deploy one release at a time; do not start parallel migration runs.

Start the worker after the initial migration succeeds. Neither the web producer nor the worker runs automatic queue schema migrations at runtime. Future dependency upgrades must run the same pre-deploy command before restarting workers. Application result writes lock the pinned pg-boss 12 job attempt to prevent a stale worker from overwriting a recovered attempt; changes to the pg-boss major version require review of this fence.

Jobs persist in PostgreSQL, carry only IDs, and use an exclusive singleton key per document. Queue enqueue and metadata updates share one transaction. The worker uses three retries after the initial attempt, 30-second exponential backoff capped at 300 seconds, a 60-second heartbeat, and a 15-minute attempt bound. pg-boss recovers expired or abandoned claims after process restart. Database writes are idempotent and version-fenced. Provider calls have at-least-once semantics: a crash after a provider response but before the result commits can repeat that paid API call. No claim of exactly-once external API execution is made.

On SIGTERM/SIGINT, health becomes unavailable, polling stops, and pg-boss drains for up to 25 seconds. Interrupted work remains recoverable. Keep the Railway draining period at least 30 seconds.

## 5. Domain and smoke test

Create a generated Railway domain for `web`, then attach the custom domain in Networking and configure the DNS records Railway provides. Set `BETTER_AUTH_URL` to the final HTTPS origin and redeploy before signing in. The app trusts that origin for sessions and CSRF checks.

Use a staging organization and a document you are authorized to send to Mistral. Sign up/sign in, create the organization, authorize processing in settings, create a project, upload a real PDF under 20 MB, and start analysis. Confirm queued → processing → review-required, original document rendering, page/source evidence, correction history, approval, and dashboard counts. Create a second organization and verify that the first organization's project/document IDs return 404 to its members. Disable organization processing while a job is queued and confirm no provider request occurs.

Restart the worker during staging processing and confirm recovery without duplicate extraction rows. Check failed-document retry controls. Test a malformed file and an oversized upload. Do not use confidential production supplier files for this smoke test until contractual safeguards are configured. Mocked automated tests do not establish a successful Railway or Mistral integration.

## 6. Backups and recovery

Enable scheduled PostgreSQL volume backups in Railway. Where available, enable point-in-time recovery before launch. Maintain an encrypted logical export in a separate restricted location. See Railway's [Postgres backup and restore guide](https://docs.railway.com/guides/postgres-backups-restores).

Use a PostgreSQL client version compatible with the server. With an authorized tunnel or database URL in your shell environment:

```sh
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=industrial-os-backup.dump
```

Store the dump encrypted and restrict access: it contains customer data, auth sessions, evidence, audit records, and queue payloads. Back up bucket objects separately to restricted storage using an S3-compatible transfer tool and verify object counts/checksums. PostgreSQL backups do not include original files. Retain a manifest of storage keys and hashes so documents can be reconciled after restoration. Do not assume object versioning or cross-region replication is enabled.

For a restore drill, pause workers, restore the database to a new isolated PostgreSQL service, and restore/copy the matching private bucket objects. Never overwrite production as a test. On the isolated database:

```sh
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges industrial-os-backup.dump
```

Point the staging application and worker at the restored resources, rotate authentication/session secrets if the incident requires session invalidation, and run the smoke workflow. Reconcile queued/processing records against pg-boss jobs and file manifests. Keep AI processing disabled during forensic recovery to avoid unintended paid reprocessing. Validate tenant isolation and approval history before a deliberate cutover. Record the recovery time and the oldest missing change; repeat restore drills on a schedule.
