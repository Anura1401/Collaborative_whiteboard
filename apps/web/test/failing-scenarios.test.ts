import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/store/boardStore.js';
import type { Obj } from '@whiteboard/shared';

describe('Verification Failing Scenarios (Web Client)', () => {
  it('operations during SYNC over single WebSocket: gap triggers SYNC and catchup OPS applies in order', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');
    store.lastSeq = 1;

    // A gap arrives (seq 3 when lastSeq is 1): triggers SYNC
    let syncRequested = false;
    store.setConnection({
      send: (msg) => {
        if (msg.t === 'SYNC' && msg.lastSeenSeq === 1) syncRequested = true;
      },
    });

    store.handleServerMessage({
      t: 'OP',
      seq: 3,
      clientId: 'remote-client-1',
      clientOpId: 'remote-op-3',
      op: {
        type: 'CREATE_OBJECT',
        object: {
          id: 'obj-3',
          type: 'rect',
          deleted: false,
          props: { x: 50, y: 50, width: 100, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 2 },
        },
      },
    });

    expect(syncRequested).toBe(true);

    // In response to SYNC, server sends OPS catchup (seq 2 and 3)
    store.handleServerMessage({
      t: 'OPS',
      ops: [
        {
          seq: 2,
          clientId: 'remote-client-1',
          clientOpId: 'remote-op-2',
          op: {
            type: 'CREATE_OBJECT',
            object: {
              id: 'obj-2',
              type: 'rect',
              deleted: false,
              props: { x: 10, y: 10, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
            },
          },
        },
        {
          seq: 3,
          clientId: 'remote-client-1',
          clientOpId: 'remote-op-3',
          op: {
            type: 'CREATE_OBJECT',
            object: {
              id: 'obj-3',
              type: 'rect',
              deleted: false,
              props: { x: 50, y: 50, width: 100, height: 100, fill: 'none', stroke: '#000000', strokeWidth: 2 },
            },
          },
        },
      ],
      you: { clientId: store.myClientId, color: '#0d99ff' },
    });

    expect(store.lastSeq).toBe(3);
    expect(store.confirmed.objects['obj-2']).toBeDefined();
    expect(store.confirmed.objects['obj-3']).toBeDefined();
  });

  it('a NACKed operation removing its history entries from both undo and redo stacks', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');

    const testObj: Obj = {
      id: 'obj-1',
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 10, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
    };

    store.submit({ type: 'CREATE_OBJECT', object: testObj });
    const originalOpId = store.pending[0]!.clientOpId;

    // User undoes the action before server confirms
    store.undo();
    expect(store.canRedo()).toBe(true);

    // Server NACKs the original operation
    store.handleServerMessage({
      t: 'NACK',
      clientOpId: originalOpId,
      reason: 'LIMIT_EXCEEDED',
    });

    // The NACKed operation must be purged from the redo stack
    expect(store.canRedo()).toBe(false);
  });

  it('undo ignored while dragging or offline', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');

    const testObj: Obj = {
      id: 'obj-1',
      type: 'rect',
      deleted: false,
      props: { x: 10, y: 10, width: 50, height: 50, fill: 'none', stroke: '#000000', strokeWidth: 1 },
    };

    store.submit({ type: 'CREATE_OBJECT', object: testObj });
    expect(store.canUndo()).toBe(true);

    // 1. Undo should be ignored while actively dragging / resizing
    store.setIsResizing(true);
    store.setOverrides({ 'obj-1': { x: 100, y: 100 } });
    store.undo();
    // In current implementation, undo is NOT ignored while dragging (it pops and executes)
    expect(store.undoStack).toHaveLength(1);

    store.setIsResizing(false);
    store.setOverrides({});

    // 2. Undo should be ignored while offline / connecting / syncing
    store.setStatus('CONNECTING');
    expect(store.canUndo()).toBe(false);
    store.undo();
    expect(store.undoStack).toHaveLength(1);
  });
});
