import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "../src/lib/db";
import { initializeJobQueue } from "../src/lib/jobs/queue";
try {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await initializeJobQueue();
  console.info("Application and durable job queue migrations applied.");
} finally { await closeDb(); }
