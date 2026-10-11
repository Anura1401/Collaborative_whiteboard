import { describe, it, expect, beforeEach } from 'vitest';
import { BoardStore } from '../src/store/boardStore.js';
import type { Obj, CommittedOp } from '@whiteboard/shared';

describe('Client Networking & Optimistic Sync (M4)', () => {
  let store: BoardStore;

  const testRect: Obj = {
    id: '10000000-0000-0000-0000-000000000001',
    type: 'rect',
    deleted: false,
    props: {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
    },
  };

  const remoteCircle: Obj = {
    id: '20000000-0000-0000-0000-000000000002',
    type: 'ellipse',
    deleted: false,
    props: {
      x: 300,
      y: 300,
      width: 80,
      height: 80,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 2,
    },
  };

  beforeEach(() => {
    store = new BoardStore();
    store.setStatus('LIVE');
  });

  it('performs optimistic local update with pending queue', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });

    // Instantly visible in view
    expect(store.view.objects[testRect.id]).toEqual(testRect);
    expect(store.view.order).toEqual([testRect.id]);
    expect(store.pending).toHaveLength(1);
    // Confirmed remains at seq 0 until server broadcasts OP
    expect(store.confirmed.order).toEqual([]);
    expect(store.lastSeq).toBe(0);
  });

  it('reconciles when matching OP arrives from server', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    const pendingOp = store.pending[0]!;

    const serverOp: CommittedOp = {
      seq: 1,
      clientId: store.myClientId,
      clientOpId: pendingOp.clientOpId,
      op: pendingOp.op,
    };

    store.handleServerMessage({
      t: 'OP',
      ...serverOp,
    });


    expect(store.pending).toHaveLength(0);
    expect(store.confirmed.objects[testRect.id]).toBeDefined();
    expect(store.confirmed.order).toEqual([testRect.id]);
    expect(store.lastSeq).toBe(1);
  });

  it('interleaves remote edits while preserving local pending updates', () => {
    // 1. Local creates rectangle optimistically
    store.submit({ type: 'CREATE_OBJECT', object: testRect });

    // 2. Remote collaborator creates circle at seq 1
    store.handleServerMessage({
      t: 'OP',
      seq: 1,
      clientId: 'remote-client-1',
      clientOpId: 'remote-op-1',
      op: { type: 'CREATE_OBJECT', object: remoteCircle },
    });

    // Confirmed contains remote circle
    expect(store.confirmed.order).toEqual([remoteCircle.id]);
    expect(store.lastSeq).toBe(1);

    // View contains BOTH remote circle (confirmed) and local rect (pending)
    expect(store.view.order).toEqual([remoteCircle.id, testRect.id]);
  });

  it('handles NACK by rolling back pending operation and restoring view', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    expect(store.view.order).toEqual([testRect.id]);

    const pendingOpId = store.pending[0]!.clientOpId;

    store.handleServerMessage({
      t: 'NACK',
      clientOpId: pendingOpId,
      reason: 'LIMIT_EXCEEDED',
    });

    expect(store.pending).toHaveLength(0);
    expect(store.view.order).toEqual([]);
    expect(store.toasts.length).toBeGreaterThan(0);
    expect(store.toasts[0]?.message).toContain('limit');
  });

  it('detects sequence gap and ignores out-of-order live ops until sync', () => {
    let syncRequested = false;
    store.setConnection({
      send: (msg) => {
        if (msg.t === 'SYNC') syncRequested = true;
      },
    } as unknown as Parameters<typeof store.setConnection>[0]);

    // Current seq is 0, receiving seq 5
    store.handleServerMessage({
      t: 'OP',
      seq: 5,
      clientId: 'remote-client',
      clientOpId: 'remote-op-5',
      op: { type: 'CREATE_OBJECT', object: remoteCircle },
    });

    expect(syncRequested).toBe(true);
    expect(store.lastSeq).toBe(0);
    expect(store.confirmed.order).toEqual([]);
  });
});
