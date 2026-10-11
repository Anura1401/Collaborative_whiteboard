import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/store/boardStore.js';
import type { Obj } from '@whiteboard/shared';

describe('BoardStore Guards (Item 7)', () => {
  it('ignores SNAPSHOT with seq lower than lastSeq', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');
    store.lastSeq = 10;
    store.confirmed = {
      objects: {
        'rect-1': {
          id: 'rect-1',
          type: 'rect',
          deleted: false,
          props: { x: 10, y: 10, width: 20, height: 20, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 },
        },
      },
      order: ['rect-1'],
    };
    store.recomputeView();

    // Stale snapshot with seq 5 (< lastSeq 10) arrives
    store.handleServerMessage({
      t: 'SNAPSHOT',
      seq: 5,
      state: { objects: {}, order: [] },
      you: { clientId: store.myClientId, color: '#ff0000' },
    });

    // Guard: must ignore stale snapshot, state and lastSeq remain intact
    expect(store.lastSeq).toBe(10);
    expect(store.confirmed.objects['rect-1']).toBeDefined();
    expect(store.view.order).toEqual(['rect-1']);
  });

  it('ignores OPS with seq lower than or equal to lastSeq', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');
    store.lastSeq = 15;

    const dummyObj: Obj = {
      id: 'rect-old',
      type: 'rect',
      deleted: false,
      props: { x: 0, y: 0, width: 10, height: 10, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 },
    };

    // Stale ops with seq 12 and 14
    store.handleServerMessage({
      t: 'OPS',
      ops: [
        { seq: 12, clientId: 'other', clientOpId: 'op-12', op: { type: 'CREATE_OBJECT', object: dummyObj } },
        { seq: 14, clientId: 'other', clientOpId: 'op-14', op: { type: 'DELETE_OBJECT', objectId: 'rect-old' } },
      ],
      you: { clientId: store.myClientId, color: '#ff0000' },
    });

    // Guard: must ignore stale catchup ops
    expect(store.lastSeq).toBe(15);
    expect(store.confirmed.objects['rect-old']).toBeUndefined();
  });

  it('ignores messages from a socket that has been replaced by a newer one', () => {
    const store = new BoardStore();
    store.setStatus('LIVE');

    const oldSocketId = 'socket-gen-1';
    const newSocketId = 'socket-gen-2';

    // Socket 2 is now active
    store.setActiveSocketId(newSocketId);

    const testRect: Obj = {
      id: 'rect-new',
      type: 'rect',
      deleted: false,
      props: { x: 50, y: 50, width: 50, height: 50, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 },
    };

    // Message arrives from obsolete old socket 1
    store.handleServerMessage(
      {
        t: 'OP',
        seq: store.lastSeq + 1,
        clientId: 'remote',
        clientOpId: 'op-old',
        op: { type: 'CREATE_OBJECT', object: testRect },
      },
      oldSocketId,
    );

    // Guard: message from replaced socket must be ignored
    expect(store.lastSeq).toBe(0);
    expect(store.confirmed.objects['rect-new']).toBeUndefined();

    // Message arrives from active new socket 2
    store.handleServerMessage(
      {
        t: 'OP',
        seq: store.lastSeq + 1,
        clientId: 'remote',
        clientOpId: 'op-new',
        op: { type: 'CREATE_OBJECT', object: testRect },
      },
      newSocketId,
    );

    // Accepted from active socket
    expect(store.lastSeq).toBe(1);
    expect(store.confirmed.objects['rect-new']).toBeDefined();
  });
});
