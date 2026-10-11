import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { Obj, ServerMsg } from '@whiteboard/shared';
import { buildApp } from '../src/main.js';
import { setupTestDb, createTestBoard, cleanupTestBoard } from './test-helper.js';
import { createTicket } from '../src/services/tickets.js';
import { roomManager } from '../src/rooms/RoomManager.js';
import { Room } from '../src/rooms/Room.js';
import { commitOp } from '../src/db/operations.js';
import { saveSnapshot } from '../src/db/snapshots.js';
import { getPool } from '../src/db/pool.js';
import * as opDb from '../src/db/operations.js';

describe('Real PostgreSQL Integration Scenarios', { timeout: 15000 }, () => {
  let serverPort: number;
  let fastifyApp: Awaited<ReturnType<typeof buildApp>>['fastify'];

  beforeAll(async () => {
    await setupTestDb();
    const { fastify } = await buildApp();
    fastifyApp = fastify;

    const address = await fastifyApp.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL(address);
    serverPort = Number(url.port);
  });

  afterAll(async () => {
    await roomManager.closeAll();
    await fastifyApp.close();
  });

  function waitForMessage(ws: WebSocket, predicate: (msg: ServerMsg) => boolean, timeoutMs = 8000): Promise<ServerMsg> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', handler);
        reject(new Error(`Timeout after ${timeoutMs}ms waiting for message`));
      }, timeoutMs);

      const handler = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString('utf-8')) as ServerMsg;
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(msg);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      };
      ws.on('message', handler);
    });
  }

  function connectWs(boardId: string, clientId: string, displayName = 'User'): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const { ticket } = createTicket(boardId, clientId, displayName);
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      ws.on('open', () => resolve(ws));
      ws.on('error', (err) => reject(err));
    });
  }

  // 1. Concurrent WebSocket clients -> operations table has seq 1..N with no gaps and no duplicates
  it('several WebSocket clients sending operations at the same time to one board: seq 1..N with no gaps and no duplicates', async () => {
    const board = await createTestBoard('Concurrent Clients Board');
    const boardId = board.id;

    const clientCount = 4;
    const opsPerClient = 5;
    const sockets: WebSocket[] = [];

    for (let c = 0; c < clientCount; c++) {
      const cid = `c0000000-0000-0000-0000-0000000000${c + 10}`;
      const ws = await connectWs(boardId, cid, `Client-${c}`);
      sockets.push(ws);

      const snapshotPromise = waitForMessage(ws, (m) => m.t === 'SNAPSHOT');
      ws.send(JSON.stringify({ t: 'JOIN' }));
      await snapshotPromise;
    }

    // Launch all operations concurrently from all clients
    const ackPromises: Promise<ServerMsg>[] = [];
    for (let c = 0; c < clientCount; c++) {
      const ws = sockets[c]!;
      for (let o = 0; o < opsPerClient; o++) {
        const opId = crypto.randomUUID();
        const objId = crypto.randomUUID();
        const ackPromise = waitForMessage(ws, (m) => m.t === 'ACK' && (m as { clientOpId: string }).clientOpId === opId);
        ackPromises.push(ackPromise);

        ws.send(JSON.stringify({
          t: 'OP',
          clientOpId: opId,
          op: {
            type: 'CREATE_OBJECT',
            object: {
              id: objId,
              type: 'rect',
              deleted: false,
              props: { x: c * 50, y: o * 50, width: 40, height: 40, fill: 'none', stroke: '#000000', strokeWidth: 1 },
            },
          },
        }));
      }
    }

    await Promise.all(ackPromises);

    // Verify operations in real PostgreSQL
    const pool = getPool();
    const dbRes = await pool.query<{ seq: string | number; client_op_id: string }>(
      `SELECT seq, client_op_id FROM operations WHERE board_id = $1 ORDER BY seq ASC`,
      [boardId],
    );

    const totalExpected = clientCount * opsPerClient;
    expect(dbRes.rows).toHaveLength(totalExpected);

    const seqs = dbRes.rows.map((r) => Number(r.seq));
    for (let i = 0; i < totalExpected; i++) {
      expect(seqs[i]).toBe(i + 1); // Contiguous 1..N with no gaps
    }

    // No duplicate seqs
    const uniqueSeqs = new Set(seqs);
    expect(uniqueSeqs.size).toBe(totalExpected);

    for (const ws of sockets) ws.close();
    await cleanupTestBoard(boardId);
  });

  // 2. Same clientOpId sent from two different connections of the same client -> 1 row, same seq in both ACKs
  it('the same clientOpId sent from two different connections of the same client: one row, same seq in both ACKs', async () => {
    const board = await createTestBoard('Duplicate clientOpId Board');
    const boardId = board.id;
    const clientId = 'c0000000-0000-0000-0000-000000000020';

    const ws1 = await connectWs(boardId, clientId, 'Alice-Tab1');
    const ws2 = await connectWs(boardId, clientId, 'Alice-Tab2');

    const join1 = waitForMessage(ws1, (m) => m.t === 'SNAPSHOT');
    const join2 = waitForMessage(ws2, (m) => m.t === 'SNAPSHOT');
    ws1.send(JSON.stringify({ t: 'JOIN' }));
    ws2.send(JSON.stringify({ t: 'JOIN' }));
    await Promise.all([join1, join2]);

    const sharedClientOpId = '50000000-0000-0000-0000-000000000001';
    const sharedObjId = '10000000-0000-0000-0000-000000000001';
    const createOp: Obj = {
      id: sharedObjId,
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 10, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
    };

    const ack1Promise = waitForMessage(ws1, (m) => m.t === 'ACK' && (m as { clientOpId: string }).clientOpId === sharedClientOpId);
    const ack2Promise = waitForMessage(ws2, (m) => m.t === 'ACK' && (m as { clientOpId: string }).clientOpId === sharedClientOpId);

    // Send identical clientOpId from both connections
    ws1.send(JSON.stringify({ t: 'OP', clientOpId: sharedClientOpId, op: { type: 'CREATE_OBJECT', object: createOp } }));
    ws2.send(JSON.stringify({ t: 'OP', clientOpId: sharedClientOpId, op: { type: 'CREATE_OBJECT', object: createOp } }));

    const ack1 = (await ack1Promise) as Extract<ServerMsg, { t: 'ACK' }>;
    const ack2 = (await ack2Promise) as Extract<ServerMsg, { t: 'ACK' }>;

    // Both connections receive ACKs with the exact same sequence number
    expect(ack1.seq).toBe(ack2.seq);

    // Database has exactly 1 row
    const pool = getPool();
    const rows = await pool.query(
      `SELECT seq, client_op_id FROM operations WHERE board_id = $1 AND client_id = $2 AND client_op_id = $3`,
      [boardId, clientId, sharedClientOpId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(Number(rows.rows[0].seq)).toBe(ack1.seq);

    ws1.close();
    ws2.close();
    await cleanupTestBoard(boardId);
  });

  // 3. Simulated commit failure: sender gets NACK INTERNAL, room memory unchanged, retry with same IDs succeeds
  it('simulated commit failure: sender gets NACK INTERNAL, room memory is unchanged, and a retry with the same ids succeeds', async () => {
    const board = await createTestBoard('Commit Failure Board');
    const boardId = board.id;
    const clientId = 'c0000000-0000-0000-0000-000000000030';

    const ws = await connectWs(boardId, clientId, 'Bob');
    const joinPromise = waitForMessage(ws, (m) => m.t === 'SNAPSHOT');
    ws.send(JSON.stringify({ t: 'JOIN' }));
    await joinPromise;

    const room = await roomManager.getOrLoad(boardId);
    const initialSeq = room.seq;
    const initialMemoryObjectsCount = Object.keys(room.state.objects).length;

    const clientOpId = '60000000-0000-0000-0000-000000000001';
    const testObjId = '20000000-0000-0000-0000-000000000001';
    const testObj: Obj = {
      id: testObjId,
      type: 'rect',
      deleted: false,
      props: { x: 20, y: 20, width: 100, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 2 },
    };

    // Spy on commitOp to simulate a database failure on first attempt
    let failureInjected = true;
    const originalCommitOp = opDb.commitOp;
    const spy = vi.spyOn(opDb, 'commitOp').mockImplementation(async (...args) => {
      if (failureInjected) {
        failureInjected = false;
        throw new Error('Simulated transient DB commit failure');
      }
      return originalCommitOp(...args);
    });

    try {
      const nackPromise = waitForMessage(ws, (m) => m.t === 'NACK' && (m as { clientOpId: string }).clientOpId === clientOpId);
      ws.send(JSON.stringify({
        t: 'OP',
        clientOpId,
        op: { type: 'CREATE_OBJECT', object: testObj },
      }));

      const nackMsg = (await nackPromise) as Extract<ServerMsg, { t: 'NACK' }>;
      expect(nackMsg.reason).toBe('INTERNAL');

      // Room memory is unchanged after failure
      expect(room.seq).toBe(initialSeq);
      expect(Object.keys(room.state.objects).length).toBe(initialMemoryObjectsCount);
      expect(room.state.objects[testObjId]).toBeUndefined();

      // Retry with the exact same clientOpId and operation succeeds
      const ackPromise = waitForMessage(ws, (m) => m.t === 'ACK' && (m as { clientOpId: string }).clientOpId === clientOpId);
      ws.send(JSON.stringify({
        t: 'OP',
        clientOpId,
        op: { type: 'CREATE_OBJECT', object: testObj },
      }));

      const ackMsg = (await ackPromise) as Extract<ServerMsg, { t: 'ACK' }>;
      expect(ackMsg.seq).toBe(initialSeq + 1);

      // Memory now contains the committed object
      expect(room.seq).toBe(initialSeq + 1);
      expect(room.state.objects[testObjId]).toBeDefined();
    } finally {
      spy.mockRestore();
      ws.close();
      await cleanupTestBoard(boardId);
    }
  });

  // 4. SeqMismatch (move board counter manually): room reloads, sender gets NACK RETRY, next op succeeds
  it('SeqMismatch (move board counter manually): room reloads, sender gets NACK RETRY, and next operation succeeds', async () => {
    const board = await createTestBoard('SeqMismatch Board');
    const boardId = board.id;
    const clientId = 'c0000000-0000-0000-0000-000000000040';

    const ws = await connectWs(boardId, clientId, 'Charlie');
    const joinPromise = waitForMessage(ws, (m) => m.t === 'SNAPSHOT');
    ws.send(JSON.stringify({ t: 'JOIN' }));
    await joinPromise;

    const pool = getPool();
    // Manually advance current_seq in database by 5 to create a mismatch with Room's in-memory seq
    await pool.query(`UPDATE boards SET current_seq = current_seq + 5 WHERE id = $1`, [boardId]);

    const mismatchedOpId = '70000000-0000-0000-0000-000000000001';
    const mismatchedObjId = '30000000-0000-0000-0000-000000000001';
    const nackPromise = waitForMessage(ws, (m) => m.t === 'NACK' && (m as { clientOpId: string }).clientOpId === mismatchedOpId);

    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: mismatchedOpId,
      op: {
        type: 'CREATE_OBJECT',
        object: {
          id: mismatchedObjId,
          type: 'rect',
          deleted: false,
          props: { x: 10, y: 10, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
        },
      },
    }));

    const nackMsg = (await nackPromise) as Extract<ServerMsg, { t: 'NACK' }>;
    // Server caught SeqMismatch and returned NACK RETRY
    expect(nackMsg.reason).toBe('RETRY');

    // Room reloaded its counter from DB: Room.seq is now 5
    const room = await roomManager.getOrLoad(boardId);
    expect(room.seq).toBe(5);

    // Next operation succeeds cleanly
    const nextOpId = '70000000-0000-0000-0000-000000000002';
    const nextObjId = '30000000-0000-0000-0000-000000000002';
    const ackPromise = waitForMessage(ws, (m) => m.t === 'ACK' && (m as { clientOpId: string }).clientOpId === nextOpId);

    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: nextOpId,
      op: {
        type: 'CREATE_OBJECT',
        object: {
          id: nextObjId,
          type: 'rect',
          deleted: false,
          props: { x: 30, y: 30, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
        },
      },
    }));

    const ackMsg = (await ackPromise) as Extract<ServerMsg, { t: 'ACK' }>;
    expect(ackMsg.seq).toBe(6);
    expect(room.seq).toBe(6);

    ws.close();
    await cleanupTestBoard(boardId);
  });

  // 5. Snapshot taken, server restarted: restored room equals log-replayed room when compared ignoring tombstones
  it('a snapshot taken, the server restarted, and restored room equals log-replayed room when compared ignoring tombstones', async () => {
    const board = await createTestBoard('Snapshot Restart Comparison Board');
    const boardId = board.id;
    const room = await roomManager.getOrLoad(boardId);

    const obj1: Obj = {
      id: '40000000-0000-0000-0000-000000000001',
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 10, width: 100, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 2 },
    };
    const obj2: Obj = {
      id: '40000000-0000-0000-0000-000000000002',
      type: 'ellipse',
      deleted: false,
      props: { x: 50, y: 50, width: 80, height: 80, fill: '#ff0000', stroke: '#000000', strokeWidth: 2 },
    };

    // 1. Commit create obj1
    await commitOp(boardId, 1, 'client-snap', '80000000-0000-0000-0000-000000000001', { type: 'CREATE_OBJECT', object: obj1 });
    // 2. Commit delete obj1 (tombstone)
    await commitOp(boardId, 2, 'client-snap', '80000000-0000-0000-0000-000000000002', { type: 'DELETE_OBJECT', objectId: obj1.id });
    // 3. Commit create obj2
    await commitOp(boardId, 3, 'client-snap', '80000000-0000-0000-0000-000000000003', { type: 'CREATE_OBJECT', object: obj2 });
    await room.reload();

    // 4. Take snapshot at seq 3 and persist to DB
    const { stripTombstones, applyOp } = await import('@whiteboard/shared');
    const snapshotState = stripTombstones(room.state);
    await saveSnapshot(boardId, 3, snapshotState);

    // 5. Restart server: instantiate brand new Room loaded from database
    const restartedRoom = new Room(boardId);
    await restartedRoom.load();

    // 6. Build room purely from operations log replay from seq 0
    let logReplayedState = { objects: {}, order: [] };
    logReplayedState = applyOp(logReplayedState, { type: 'CREATE_OBJECT', object: obj1 });
    logReplayedState = applyOp(logReplayedState, { type: 'DELETE_OBJECT', objectId: obj1.id });
    logReplayedState = applyOp(logReplayedState, { type: 'CREATE_OBJECT', object: obj2 });

    // Restored room equals log-replayed room when compared ignoring tombstones
    expect(stripTombstones(restartedRoom.state)).toEqual(stripTombstones(logReplayedState));
    expect(restartedRoom.state.order).toEqual(logReplayedState.order);

    // obj1 (deleted tombstone) is purged in snapshot, while obj2 (live) is identical
    expect(restartedRoom.state.objects[obj1.id]).toBeUndefined();
    expect(restartedRoom.state.objects[obj2.id]).toEqual(obj2);

    await cleanupTestBoard(boardId);
  });

  // 6. Reconnecting client with old lastSeenSeq receives OPS from ring buffer, very old or future seq receives SNAPSHOT
  it('client reconnecting with old lastSeenSeq receives OPS from ring buffer, very old or future seq receives SNAPSHOT', async () => {
    const board = await createTestBoard('Ring Buffer Reconnect Board');
    const boardId = board.id;
    const room = await roomManager.getOrLoad(boardId);

    // Commit 5 operations to populate ring buffer
    for (let i = 1; i <= 5; i++) {
      const opObj: Obj = {
        id: `50000000-0000-0000-0000-00000000000${i}`,
        type: 'rect',
        deleted: false,
        props: { x: i * 10, y: i * 10, width: 20, height: 20, fill: 'none', stroke: '#000000', strokeWidth: 1 },
      };
      await commitOp(boardId, i, 'c-seed', `90000000-0000-0000-0000-00000000000${i}`, {
        type: 'CREATE_OBJECT',
        object: opObj,
      });
    }
    await room.reload();
    expect(room.seq).toBe(5);

    // Only keep ops 4 and 5 in ring buffer (simulating eviction of ops 1..3 from ring buffer)
    (room as any).ring.splice(0, 3);
    expect(room.ring).toHaveLength(2);
    expect(room.ring.map((o) => o.seq)).toEqual([4, 5]);

    // Client A reconnects with lastSeenSeq = 3 (within ring buffer): receives OPS
    const wsA = await connectWs(boardId, 'c0000000-0000-0000-0000-0000000000A1', 'ClientA');
    const msgAPromise = waitForMessage(wsA, (m) => m.t === 'OPS' || m.t === 'SNAPSHOT');
    wsA.send(JSON.stringify({ t: 'JOIN', lastSeenSeq: 3 }));
    const msgA = await msgAPromise;
    expect(msgA.t).toBe('OPS');
    const opsA = (msgA as Extract<ServerMsg, { t: 'OPS' }>).ops;
    expect(opsA).toHaveLength(2);
    expect(opsA.map((o) => o.seq)).toEqual([4, 5]);
    wsA.close();

    // Client B reconnects with future lastSeenSeq = 999: receives SNAPSHOT
    const wsB = await connectWs(boardId, 'c0000000-0000-0000-0000-0000000000B1', 'ClientB');
    const msgBPromise = waitForMessage(wsB, (m) => m.t === 'OPS' || m.t === 'SNAPSHOT');
    wsB.send(JSON.stringify({ t: 'JOIN', lastSeenSeq: 999 }));
    const msgB = await msgBPromise;
    expect(msgB.t).toBe('SNAPSHOT');
    expect((msgB as Extract<ServerMsg, { t: 'SNAPSHOT' }>).seq).toBe(5);
    wsB.close();

    // Client C reconnects with very old seq = 1 (evicted from ring buffer): receives SNAPSHOT
    const wsC = await connectWs(boardId, 'c0000000-0000-0000-0000-0000000000C1', 'ClientC');
    const msgCPromise = waitForMessage(wsC, (m) => m.t === 'OPS' || m.t === 'SNAPSHOT');
    wsC.send(JSON.stringify({ t: 'JOIN', lastSeenSeq: 1 }));
    const msgC = await msgCPromise;
    expect(msgC.t).toBe('SNAPSHOT');
    expect((msgC as Extract<ServerMsg, { t: 'SNAPSHOT' }>).seq).toBe(5);
    wsC.close();

    await cleanupTestBoard(boardId);
  });
});
