import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newDb, DataType } from 'pg-mem';
import { config } from '../config.js';

const { Pool } = pg;

export type DbPool = pg.Pool;

let activePool: DbPool | null = null;
let isInMemory = false;

export function getPool(): DbPool {
  if (!activePool) {
    const isCloudDb =
      config.DATABASE_URL.includes('sslmode=require') ||
      config.DATABASE_URL.includes('render.com') ||
      config.DATABASE_URL.includes('railway.app') ||
      config.DATABASE_URL.includes('supabase') ||
      config.DATABASE_URL.includes('neon.tech') ||
      process.env.DATABASE_SSL === 'true';

    activePool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      ssl: isCloudDb ? { rejectUnauthorized: false } : undefined,
    });
  }
  return activePool;
}

export function setPool(pool: DbPool): void {
  activePool = pool;
}

export async function closePool(): Promise<void> {
  if (activePool) {
    await activePool.end();
    activePool = null;
  }
}

export function createInMemoryDb(): DbPool {
  const db = newDb();
  db.public.registerFunction({
    name: 'now',
    returns: DataType.timestamp,
    implementation: () => new Date(),
  });

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS boards (
      id uuid PRIMARY KEY,
      name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      current_seq bigint NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS operations (
      board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      seq bigint NOT NULL,
      client_id text NOT NULL,
      client_op_id uuid NOT NULL,
      op jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (board_id, seq),
      UNIQUE (board_id, client_id, client_op_id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      seq bigint NOT NULL,
      state jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (board_id, seq)
    );
  `;

  db.public.none(schemaSql);
  const pgAdapter = db.adapters.createPg();
  const pool = new pgAdapter.Pool() as unknown as DbPool;
  return pool;
}

export async function runMigrations(): Promise<void> {
  if (activePool && isInMemory) {
    return; // Already initialized in memory
  }

  const pool = getPool();
  try {
    const client = await pool.connect();
    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const sqlPath = path.resolve(currentDir, '../../migrations/001_create_schema.sql');
      const schemaSql = fs.readFileSync(sqlPath, 'utf-8');
      await client.query(schemaSql);
      console.log('Database connected and schema verified against PostgreSQL.');
    } finally {
      client.release();
    }
  } catch (err) {
    if (config.ALLOW_IN_MEMORY_DB) {
      console.warn(`[DB] PostgreSQL not reachable at ${config.DATABASE_URL}.`);
      console.log('[DB] ALLOW_IN_MEMORY_DB is true: switching to in-memory PostgreSQL engine (pg-mem).');
      const memPool = createInMemoryDb();
      setPool(memPool);
      isInMemory = true;
      return;
    }

    console.error(
      `\n================================================================================\n` +
      `[FATAL DATABASE ERROR] Failed to connect to PostgreSQL at:\n` +
      `  ${config.DATABASE_URL}\n` +
      `In-memory database fallback (pg-mem) is disabled (ALLOW_IN_MEMORY_DB=false).\n` +
      `Error detail: ${(err as Error)?.message || String(err)}\n` +
      `Please ensure PostgreSQL is running or set ALLOW_IN_MEMORY_DB=true for mock testing.\n` +
      `================================================================================\n`
    );
    process.exit(1);
  }
}

