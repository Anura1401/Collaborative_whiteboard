import type { BoardState } from '@whiteboard/shared';
import { getPool, type DbPool } from './pool.js';

export interface SnapshotRow {
  board_id: string;
  seq: number;
  state: BoardState;
  created_at: Date;
}

export async function saveSnapshot(
  boardId: string,
  seq: number,
  state: BoardState,
  pool: DbPool = getPool(),
): Promise<void> {
  await pool.query(
    `INSERT INTO snapshots (board_id, seq, state) VALUES ($1, $2, $3)
     ON CONFLICT (board_id, seq) DO UPDATE SET state = $3, created_at = now()`,
    [boardId, seq, JSON.stringify(state)],
  );
}

export async function loadLatestSnapshot(
  boardId: string,
  pool: DbPool = getPool(),
): Promise<{ seq: number; state: BoardState } | null> {
  const res = await pool.query<{ seq: string | number; state: BoardState | string }>(
    `SELECT seq, state FROM snapshots WHERE board_id = $1 ORDER BY seq DESC LIMIT 1`,
    [boardId],
  );

  if (res.rows.length === 0 || !res.rows[0]) return null;

  const row = res.rows[0];
  return {
    seq: Number(row.seq),
    state: typeof row.state === 'string' ? JSON.parse(row.state) : row.state,
  };
}

export async function pruneSnapshots(
  boardId: string,
  keepLatestCount = 2,
  pool: DbPool = getPool(),
): Promise<void> {
  await pool.query(
    `DELETE FROM snapshots WHERE board_id = $1 AND seq NOT IN (
      SELECT seq FROM snapshots WHERE board_id = $1 ORDER BY seq DESC LIMIT $2
    )`,
    [boardId, keepLatestCount],
  );
}
