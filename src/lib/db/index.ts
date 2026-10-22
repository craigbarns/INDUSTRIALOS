import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { AppError } from "../errors";

const globalDb = globalThis as unknown as { industrialPool?: Pool; industrialDb?: ReturnType<typeof createDb> };
function createDb(pool: Pool) { return drizzle(pool, { schema }); }
export function getDb() {
  if (!process.env.DATABASE_URL) throw new AppError(503, "SETUP_REQUIRED", "Configure the PostgreSQL connection to continue.");
  if (!globalDb.industrialDb) {
    globalDb.industrialPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 10000 });
    globalDb.industrialDb = createDb(globalDb.industrialPool);
  }
  return globalDb.industrialDb;
}
export async function closeDb() { await globalDb.industrialPool?.end(); globalDb.industrialDb = undefined; globalDb.industrialPool = undefined; }
