import { describe, it, expect } from 'vitest';
import { BoardStore } from '../src/store/boardStore.js';
import type { Obj, ClientMsg } from '@whiteboard/shared';

describe('BoardStore ACK and reconnect handling', () => {
  it('case 1: clears pending on ACK with seq <= lastSeq after reconnect and SNAPSHOT', () => {
    const store = new BoardStore();
    const sent: ClientMsg[] = [];
    store.setConnection({
      send: (msg: ClientMsg) => sent.push(msg),
    } as any);
    store.setStatus('LIVE');

    const testRect: Obj = {
      id: 'rect-1',
      type: 'rect',
      deleted: false,
      props: {
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 2,
      },
    };

    // Client sends an operation
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    expect(store.pending).toHaveLength(1);
    const sentOpId = store.pending[0].clientOpId;

    // Server commits it (at seq 1), connection drops before client sees any reply
    store.setStatus('DISCONNECTED');

    // Client reconnects
    store.setStatus('SYNCING');

    // Server replies with a SNAPSHOT that already contains the operation
    store.handleServerMessage({
      t: 'SNAPSHOT',
      seq: 1,
      state: {
        objects: { [testRect.id]: testRect },
        order: [testRect.id],
      },
      you: { clientId: store.myClientId, color: '#00ff00' },
    });

    expect(store.lastSeq).toBe(1);

    // Client becomes LIVE and resends pending operations
    store.setStatus('LIVE');
    store.onLiveReady();

    // Verify client resent the op
    const resends = sent.filter((m) => m.t === 'OP' && m.clientOpId === sentOpId);
    expect(resends.length).toBe(2); // Initial send + resend

    // Server answers ACK with a seq at or below lastSeq (seq: 1 <= lastSeq: 1)
    store.handleServerMessage({
      t: 'ACK',
      clientOpId: sentOpId,
      seq: 1,
    });

    // Expected: pending becomes empty
    expect(store.pending).toEqual([]);
  });

  it('case 2: an ACK with seq above lastSeq keeps the operation pending until OP stream arrives', () => {
    const store = new BoardStore();
    const sent: ClientMsg[] = [];
    store.setConnection({
      send: (msg: ClientMsg) => sent.push(msg),
    } as any);
    store.setStatus('LIVE');
    store.lastSeq = 5;

    const testRect: Obj = {
      id: 'rect-2',
      type: 'rect',
      deleted: false,
      props: {
        x: 20,
        y: 20,
        width: 60,
        height: 40,
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 1,
      },
    };

    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    expect(store.pending).toHaveLength(1);
    const sentOpId = store.pending[0].clientOpId;

    // Server answers ACK with seq above lastSeq (seq 6 > lastSeq 5)
    store.handleServerMessage({
      t: 'ACK',
      clientOpId: sentOpId,
      seq: 6,
    });

    // Expected: must keep operation pending
    expect(store.pending).toHaveLength(1);
    expect(store.pending[0].clientOpId).toBe(sentOpId);

    // Now the OP stream arrives with seq 6
    store.handleServerMessage({
      t: 'OP',
      seq: 6,
      clientId: store.myClientId,
      clientOpId: sentOpId,
      op: { type: 'CREATE_OBJECT', object: testRect },
    });

    // Expected: pending now becomes empty
    expect(store.pending).toEqual([]);
    expect(store.lastSeq).toBe(6);
  });
});
