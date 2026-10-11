import { newDb } from 'pg-mem';
import type { DbPool } from '../src/db/pool.js';
import { setPool, getPool } from '../src/db/pool.js';
import { config } from '../src/config.js';

export async function setupTestDb(): Promise<DbPool> {
  // Test if real PostgreSQL is accessible
  try {
    const realPool = getPool();
    const client = await realPool.connect();
    client.release();
    console.log(`[Test] Running against REAL PostgreSQL at ${config.DATABASE_URL}`);
    setPool(realPool);
    return realPool;
  } catch (err) {
    console.log('[Test] Real PostgreSQL not reachable, falling back to pg-mem:', err);
    const db = newDb();

    // Register crypto/uuid functions if needed by schema
    db.public.registerFunction({
      name: 'now',
      returns: db.public.getType('timestamptz'),
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
    setPool(pool);
    return pool;
  }
}

export async function createTestBoard(namePrefix: string = 'Test Board'): Promise<{ id: string; name: string }> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const name = `${namePrefix} ${id.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO boards (id, name) VALUES ($1, $2)`,
    [id, name],
  );
  return { id, name };
}

export async function cleanupTestBoard(boardId: string): Promise<void> {
  const pool = getPool();
  try {
    // Delete board row (cascades to operations and snapshots)
    await pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
  } catch (err) {
    console.error(`[Test Cleanup] Failed to delete board ${boardId}:`, err);
  }
}
