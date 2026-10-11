import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import type { Obj, ServerMsg } from '@whiteboard/shared';
import { buildApp } from '../src/main.js';
import { setupTestDb, createTestBoard, cleanupTestBoard } from './test-helper.js';
import { createTicket } from '../src/services/tickets.js';

describe('Server Integration & Operation Pipeline (M3)', () => {
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

    const b = await createTestBoard('Test Integration Board');
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

  it('HTTP Health checks (/healthz and /readyz)', async () => {
    const health = await fastifyApp.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);

    const ready = await fastifyApp.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
  });

  it('Pipeline: Join, contiguous seqs, idempotent dedupe, deleted move NACK, and restart recovery', async () => {
    const clientId = 'c0000000-0000-0000-0000-000000000001';
    const { ticket } = createTicket(boardId, clientId, 'Alice');

    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket}`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    ws.on('error', (err) => console.error('Client WS error:', err));
    ws.on('close', (code, reason) => console.log('Client WS closed:', code, reason.toString()));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
    });


    // 1. Send JOIN -> expect SNAPSHOT with seq 0
    const snapshotPromise = waitForMessage(ws, (m) => m.t === 'SNAPSHOT');
    ws.send(JSON.stringify({ t: 'JOIN' }));
    const snapshot = await snapshotPromise;
    expect(snapshot.t).toBe('SNAPSHOT');
    if (snapshot.t === 'SNAPSHOT') {
      expect(snapshot.seq).toBe(0);
      expect(snapshot.you.clientId).toBe(clientId);
    }

    // 2. Send CREATE_OBJECT -> expect ACK seq 1 and OP seq 1
    const rectId = '20000000-0000-0000-0000-000000000001';
    const clientOpId1 = '30000000-0000-0000-0000-000000000001';
    const rectObj: Obj = {
      id: rectId,
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 20, width: 100, height: 50, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 },
    };

    const ackPromise1 = waitForMessage(ws, (m) => m.t === 'ACK' && m.clientOpId === clientOpId1);
    const opPromise1 = waitForMessage(ws, (m) => m.t === 'OP' && m.clientOpId === clientOpId1);

    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: clientOpId1,
      op: { type: 'CREATE_OBJECT', object: rectObj },
    }));

    const ack1 = await ackPromise1;
    const op1 = await opPromise1;
    expect(ack1).toEqual({ t: 'ACK', clientOpId: clientOpId1, seq: 1 });
    expect(op1.t).toBe('OP');
    if (op1.t === 'OP') expect(op1.seq).toBe(1);

    // 3. Send second operation -> expect strictly contiguous seq 2
    const clientOpId2 = '30000000-0000-0000-0000-000000000002';
    const ackPromise2 = waitForMessage(ws, (m) => m.t === 'ACK' && m.clientOpId === clientOpId2);
    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: clientOpId2,
      op: { type: 'SET_PROPS', objectId: rectId, changes: { x: 50, y: 60 } },
    }));

    const ack2 = await ackPromise2;
    expect(ack2).toEqual({ t: 'ACK', clientOpId: clientOpId2, seq: 2 });

    // 4. Retry op 1 (same client_id and client_op_id) -> expect deduplicated ACK with same seq 1
    const retryPromise = waitForMessage(ws, (m) => m.t === 'ACK' && m.clientOpId === clientOpId1);
    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: clientOpId1,
      op: { type: 'CREATE_OBJECT', object: rectObj },
    }));

    const retryAck = await retryPromise;
    expect(retryAck).toEqual({ t: 'ACK', clientOpId: clientOpId1, seq: 1 });

    // 5. Delete object -> expect seq 3
    const clientOpId3 = '30000000-0000-0000-0000-000000000003';
    const ackPromise3 = waitForMessage(ws, (m) => m.t === 'ACK' && m.clientOpId === clientOpId3);
    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: clientOpId3,
      op: { type: 'DELETE_OBJECT', objectId: rectId },
    }));
    const ack3 = await ackPromise3;
    expect(ack3).toEqual({ t: 'ACK', clientOpId: clientOpId3, seq: 3 });

    // 6. Move deleted object -> expect NACK DELETED
    const clientOpId4 = '30000000-0000-0000-0000-000000000004';
    const nackPromise = waitForMessage(ws, (m) => m.t === 'NACK' && m.clientOpId === clientOpId4);
    ws.send(JSON.stringify({
      t: 'OP',
      clientOpId: clientOpId4,
      op: { type: 'SET_PROPS', objectId: rectId, changes: { x: 100 } },
    }));
    const nack = await nackPromise;
    expect(nack).toEqual({ t: 'NACK', clientOpId: clientOpId4, reason: 'DELETED' });


    ws.close();

    // 7. Restart simulation: Connect a new client to the same board and verify state matches
    const client2Id = 'c0000000-0000-0000-0000-000000000002';
    const { ticket: ticket2 } = createTicket(boardId, client2Id, 'Bob');

    const ws2 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?ticket=${ticket2}`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    await new Promise<void>((resolve) => ws2.on('open', resolve));

    const snap2Promise = waitForMessage(ws2, (m) => m.t === 'SNAPSHOT');
    ws2.send(JSON.stringify({ t: 'JOIN' }));
    const snap2 = await snap2Promise;

    expect(snap2.t).toBe('SNAPSHOT');
    if (snap2.t === 'SNAPSHOT') {
      expect(snap2.seq).toBe(3);
      // Object was deleted, so stripped snapshot should have empty live order
      expect(snap2.state.order).toEqual([]);
    }

    ws2.close();
  });
});
