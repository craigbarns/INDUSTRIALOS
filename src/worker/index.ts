import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../lib/db";
import { MistralOCRProvider } from "../lib/ai/mistral-ocr";
import { MistralProcurementExtractor } from "../lib/ai/procurement-extractor";
import { readDocumentFile } from "../lib/storage";
import { ANALYSIS_QUEUE, getJobQueue, stopJobQueue, type AnalysisJobData } from "../lib/jobs/queue";
import { processDocumentJob } from "../lib/jobs/processor";
import { analysisRepository } from "../lib/jobs/repository";

let ready = false;
const health = createServer(async (req, res) => {
  if (req.url !== "/health") { res.writeHead(404).end(); return; }
  try {
    if (!ready) throw new Error("not-ready");
    await getDb().execute(sql`select 1`);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"status":"ok","service":"worker"}');
  } catch { res.writeHead(503, { "Content-Type": "application/json" }).end('{"status":"unavailable"}'); }
});
health.listen(Number(process.env.PORT ?? process.env.WORKER_HEALTH_PORT ?? 3001), "0.0.0.0");

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  health.close();
  try { await stopJobQueue(); await closeDb(); }
  finally { process.exitCode = code; }
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

async function start() {
  const boss = await getJobQueue({ worker: true });
  const deps = { repository: analysisRepository, ocr: new MistralOCRProvider(), extractor: new MistralProcurementExtractor(), loadFile: readDocumentFile };
  const options = { includeMetadata: true, batchSize: 1, localConcurrency: 2, groupConcurrency: 1, heartbeatRefreshSeconds: 20, pollingIntervalSeconds: 2, perJobResults: true } as const;
  await boss.work<AnalysisJobData, unknown, typeof options>(ANALYSIS_QUEUE, options, async jobs => {
    return Promise.all(jobs.map(async job => {
      const result = await processDocumentJob(job, deps);
      return { id: job.id, status: result.status, output: result.code ? { code: result.code } : undefined };
    }));
  });
  ready = true;
  console.info(JSON.stringify({ event: "worker_ready", service: "industrial-os", queue: ANALYSIS_QUEUE }));
}
start().catch(async () => {
  console.error(JSON.stringify({ event: "worker_start_failed", code: "WORKER_CONFIGURATION_ERROR" }));
  await shutdown(1);
});
