import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Database = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & { portfolioDb?: Database };
let database: Database | undefined;

export function getDb(): Database {
  if (database) return database;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is missing.");

  database = globalForDb.portfolioDb ?? drizzle(new Pool({ connectionString, connectionTimeoutMillis: 5_000 }));
  if (process.env.NODE_ENV === "development") globalForDb.portfolioDb = database;
  return database;
}
