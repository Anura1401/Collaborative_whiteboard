import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import type { Obj, ServerMsg } from '@whiteboard/shared';
import { buildApp } from '../src/main.js';
import { setupTestDb, createTestBoard, cleanupTestBoard } from './test-helper.js';
import { createTicket } from '../src/services/tickets.js';
import { roomManager } from '../src/rooms/RoomManager.js';
import { Room } from '../src/rooms/Room.js';
import { commitOp } from '../src/db/operations.js';

describe('Verification Failing Scenarios (Server)', () => {
  let serverPort: number;
  let fastifyApp: Awaited<ReturnType<typeof buildApp>>['fastify'];
  let boardId: string;

  beforeAll(async () => {
    await setupTestDb();
    const { fastify } = await buildApp();
    fastifyApp = fastify;

    const address = await fastifyApp.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL(address);
    serverPort = Number(url.port);

    const b = await createTestBoard('Failing Test Board');
    boardId = b.id;
  });

  afterAll(async () => {
    await cleanupTestBoard(boardId);
    await fastifyApp.close();
  });

  function waitForMessage(ws: WebSocket, predicate: (msg: ServerMsg) => boolean): Promise<ServerMsg> {
    return new Promise((resolve, reject) => {
      const handler = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString('utf-8')) as ServerMsg;
          if (predicate(msg)) {
            ws.off('message', handler);
            resolve(msg);
          }
        } catch (err) {
          reject(err);
        }
      };
      ws.on('message', handler);
    });
  }

  it('snapshot state equals the state rebuilt on restart', async () => {
    const board = await createTestBoard('Snapshot Restart Board');
    const bId = board.id;
    const room = await roomManager.getOrLoad(bId);

    const obj1: Obj = {
      id: 'obj-restart-1',
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 10, width: 100, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 2 },
    };

    // 1. Commit create op
    await commitOp(bId, 1, 'client-1', '30000000-0000-0000-0000-000000000001', { type: 'CREATE_OBJECT', object: obj1 });
    // 2. Commit delete op (tombstone created)
    await commitOp(bId, 2, 'client-1', '30000000-0000-0000-0000-000000000002', { type: 'DELETE_OBJECT', objectId: obj1.id });
    await room.reload();

    // Take snapshot at seq 2
    room.takeSnapshot();

    // Restart: instantiate fresh room simulating server restart
    const restartedRoom = new Room(bId);
    await restartedRoom.load();

    // Replay purely from operations log (scratch rebuild without snapshot)
    const { applyOp, stripTombstones } = await import('@whiteboard/shared');
    let scratchState = { objects: {}, order: [] };
    scratchState = applyOp(scratchState, { type: 'CREATE_OBJECT', object: obj1 });
    scratchState = applyOp(scratchState, { type: 'DELETE_OBJECT', objectId: obj1.id });

    // Compare live objects and order only, ignoring tombstones (snapshot strips tombstones)
    expect(stripTombstones(restartedRoom.state)).toEqual(stripTombstones(scratchState));
    expect(restartedRoom.state.order).toEqual(scratchState.order);

    await cleanupTestBoard(bId);
  });

  it('ephemeral messages over the rate limit must never trigger a 4008 close', async () => {
    const clientId = 'c0000000-0000-0000-0000-000000000099';
    const { ticket } = createTicket(boardId, clientId, 'Spammer');

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const snapshotPromise = waitForMessage(ws, (m) => m.t === 'SNAPSHOT');
    ws.send(JSON.stringify({ t: 'JOIN' }));
    await snapshotPromise;

    let closeCode: number | null = null;
    ws.on('close', (code) => {
      closeCode = code;
    });

    // Send 150 rapid CURSOR messages (rate limit is 30/sec)
    for (let i = 0; i < 150; i++) {
      ws.send(JSON.stringify({
        t: 'CURSOR',
        x: i,
        y: i,
      }));
    }

    // Give server time to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ephemeral messages over rate limit must never close the socket with 4008
    expect(closeCode).not.toBe(4008);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });
});
