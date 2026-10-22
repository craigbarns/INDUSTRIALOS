import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { fromPglite, PgBoss } from "pg-boss";

// Always exercise real PostgreSQL SQL through PGlite; an explicit URL also tests a server.
// Each run creates and drops only its own random queue schema.
const connectionString = process.env.TEST_DATABASE_URL;
const schema = `queue_test_${randomUUID().replaceAll("-", "")}`;
const queue = "analysis-integration";
let boss: PgBoss;
let pool: Pool | undefined;
let embedded: PGlite | undefined;
function instance(migrate = false) {
  const backend = connectionString
    ? { connectionString }
    : { backend: "pglite" as const, db: fromPglite(embedded!) };
  const result = new PgBoss({ ...backend, schema, migrate, supervise: false, schedule: false });
  result.on("error", () => undefined);
  return result;
}

describe("PostgreSQL durable queue integration", () => {
  beforeAll(async () => {
    if (connectionString) pool = new Pool({ connectionString });
    else embedded = new PGlite();
    boss = instance(true);
    await boss.start();
    await boss.createQueue(queue, { policy: "exclusive", retryLimit: 1, retryDelay: 0, expireInSeconds: 1 });
  }, 30000);
  afterAll(async () => {
    await boss?.stop();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
    await embedded?.close();
  });

  it("rejects a duplicate singleton while the job is pending", async () => {
    const key = randomUUID();
    const id = await boss.send(queue, { documentId: randomUUID() }, { singletonKey: key });
    expect(id).toBeTypeOf("string");
    expect(await boss.send(queue, { documentId: randomUUID() }, { singletonKey: key })).toBeNull();
    await boss.deleteJob(queue, id!);
  });

  it("preserves a pending job across new process connections", async () => {
    const id = await boss.send(queue, { documentId: randomUUID() }, { singletonKey: randomUUID() });
    await boss.stop();
    boss = instance();
    await boss.start();
    const [job] = await boss.fetch(queue);
    expect(job?.id).toBe(id);
    await boss.complete(queue, job);
  });

  it("retries an unsuccessful attempt and completes its next claim", async () => {
    const id = await boss.send(queue, { documentId: randomUUID() }, { singletonKey: randomUUID() });
    const [first] = await boss.fetch(queue);
    expect(first?.id).toBe(id);
    await boss.fail(queue, first, { code: "MOCK_PROVIDER_FAILURE" });
    const [second] = await boss.fetch(queue);
    expect(second?.id).toBe(id);
    expect(second?.retryCount).toBe(1);
    await boss.complete(queue, second);
    const result = await boss.getJobById(queue, id!);
    expect(result?.state).toBe("completed");
  });

  it("recovers an abandoned expired claim after a worker restart", async () => {
    const id = await boss.send(queue, { documentId: randomUUID() }, { singletonKey: randomUUID() });
    const [first] = await boss.fetch(queue);
    expect(first?.id).toBe(id);
    await boss.stop();
    // Simulate the crashed worker's stale timestamp without waiting for the monitor interval.
    const query = `UPDATE "${schema}".job SET started_on = now() - interval '1 hour' WHERE id = $1`;
    if (pool) await pool.query(query, [id]);
    else await embedded!.query(query, [id]);
    boss = instance();
    await boss.start();
    await boss.supervise(queue);
    const [recovered] = await boss.fetch(queue);
    expect(recovered?.id).toBe(id);
    expect(recovered?.retryCount).toBe(1);
    await boss.complete(queue, recovered);
  });

  it("retains permanently failed jobs after retries are exhausted", async () => {
    const id = await boss.send(queue, { documentId: randomUUID() }, { singletonKey: randomUUID() });
    const [first] = await boss.fetch(queue);
    await boss.fail(queue, first, { code: "MOCK_FAILURE" });
    const [last] = await boss.fetch(queue);
    await boss.fail(queue, last, { code: "MOCK_FAILURE" });
    expect((await boss.getJobById(queue, id!))?.state).toBe("failed");
  });
});
