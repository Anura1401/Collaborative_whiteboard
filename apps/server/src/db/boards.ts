import { getPool, type DbPool } from './pool.js';

export interface BoardRow {
  id: string;
  name: string | null;
  created_at: Date;
  current_seq: string | number;
}

export async function createBoard(name?: string, customId?: string, pool: DbPool = getPool()): Promise<{ id: string; name: string | null }> {
  const id = customId ?? crypto.randomUUID();
  const boardName = name && name.trim() ? name.trim() : 'Whiteboard';

  const res = await pool.query<BoardRow>(
    `INSERT INTO boards (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id, name, created_at, current_seq`,
    [id, boardName],
  );

  const row = res.rows[0];
  if (!row) throw new Error('Failed to create board');

  return {
    id: row.id,
    name: row.name,
  };
}

export async function getBoard(id: string, pool: DbPool = getPool()): Promise<BoardRow | null> {
  const res = await pool.query<BoardRow>(
    `SELECT id, name, created_at, current_seq FROM boards WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function deleteBoard(id: string, pool: DbPool = getPool()): Promise<void> {
  await pool.query(`DELETE FROM boards WHERE id = $1`, [id]);
}
