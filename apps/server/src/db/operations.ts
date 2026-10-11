import type { CommittedOp, Op } from '@whiteboard/shared';
import { getPool, type DbPool } from './pool.js';

export class SeqMismatch extends Error {
  constructor(message = 'Sequence mismatch') {
    super(message);
    this.name = 'SeqMismatch';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: string }).code;
    return code === '23505';
  }
  return false;
}

export async function findOp(
  boardId: string,
  clientId: string,
  clientOpId: string,
  pool: DbPool = getPool(),
): Promise<number | undefined> {
  const res = await pool.query<{ seq: string | number }>(
    `SELECT seq FROM operations WHERE board_id = $1 AND client_id = $2 AND client_op_id = $3 LIMIT 1`,
    [boardId, clientId, clientOpId],
  );
  if (res.rows.length === 0 || !res.rows[0]) return undefined;
  return Number(res.rows[0].seq);
}

export async function commitOp(
  boardId: string,
  expectedSeq: number,
  clientId: string,
  clientOpId: string,
  op: Op,
  pool: DbPool = getPool(),
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query<{ current_seq: string | number }>(
      `UPDATE boards SET current_seq = current_seq + 1 WHERE id = $1 RETURNING current_seq`,
      [boardId],
    );

    if (updateRes.rows.length === 0 || !updateRes.rows[0]) {
      await client.query('ROLLBACK');
      throw new Error(`Board ${boardId} not found`);
    }

    const assignedSeq = Number(updateRes.rows[0].current_seq);
    if (assignedSeq !== expectedSeq) {
      await client.query('ROLLBACK');
      throw new SeqMismatch(`Expected seq ${expectedSeq} but got ${assignedSeq}`);
    }

    await client.query(
      `INSERT INTO operations (board_id, seq, client_id, client_op_id, op) VALUES ($1, $2, $3, $4, $5)`,
      [boardId, assignedSeq, clientId, clientOpId, JSON.stringify(op)],
    );

    await client.query('COMMIT');
    return assignedSeq;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors if already aborted
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function loadOpsAfter(
  boardId: string,
  afterSeq: number,
  pool: DbPool = getPool(),
): Promise<CommittedOp[]> {
  const res = await pool.query<{
    seq: string | number;
    client_id: string;
    client_op_id: string;
    op: Op | string;
  }>(
    `SELECT seq, client_id, client_op_id, op FROM operations WHERE board_id = $1 AND seq > $2 ORDER BY seq ASC`,
    [boardId, afterSeq],
  );

  return res.rows.map((row) => ({
    seq: Number(row.seq),
    clientId: row.client_id,
    clientOpId: row.client_op_id,
    op: typeof row.op === 'string' ? JSON.parse(row.op) : row.op,
  }));
}
