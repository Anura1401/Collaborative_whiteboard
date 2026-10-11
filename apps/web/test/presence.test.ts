import { describe, it, expect, beforeEach } from 'vitest';
import { BoardStore } from '../src/store/BoardStore.js';
import type { PresenceUser } from '@whiteboard/shared';

describe('Milestone 5: Presence & Ephemeral Collaborative Features', () => {
  let store: BoardStore;

  beforeEach(() => {
    store = new BoardStore();
  });

  it('updates presence list and prunes disconnected client cursors and drag previews', () => {
    const user1: PresenceUser = { clientId: 'client-1', name: 'Alice', color: '#ff0000' };
    const user2: PresenceUser = { clientId: 'client-2', name: 'Bob', color: '#00ff00' };

    store.handleServerMessage({
      t: 'PRESENCE',
      users: [user1, user2],
    });

    expect(store.presenceUsers).toHaveLength(2);

    // Simulate incoming cursors and drag previews for both
    store.handleServerMessage({
      t: 'CURSOR',
      clientId: 'client-1',
      x: 100,
      y: 200,
    });

    store.handleServerMessage({
      t: 'DRAG_PREVIEW',
      clientId: 'client-2',
      objectId: 'obj-123',
      changes: { x: 50, y: 75 },
    });

    expect(store.remoteCursors['client-1']).toBeDefined();
    expect(store.remoteCursors['client-1']?.x).toBe(100);
    expect(store.remoteDragPreviews['obj-123']).toBeDefined();
    expect(store.remoteDragPreviews['obj-123']?.clientId).toBe('client-2');

    // Bob disconnects -> PRESENCE update with only Alice
    store.handleServerMessage({
      t: 'PRESENCE',
      users: [user1],
    });

    expect(store.presenceUsers).toHaveLength(1);
    expect(store.remoteCursors['client-1']).toBeDefined();
    // Bob's drag preview should be pruned automatically
    expect(store.remoteDragPreviews['obj-123']).toBeUndefined();
  });

  it('handles null changes in DRAG_PREVIEW to clear live drag ghosts', () => {
    store.handleServerMessage({
      t: 'DRAG_PREVIEW',
      clientId: 'client-1',
      objectId: 'rect-1',
      changes: { width: 300 },
    });

    expect(store.remoteDragPreviews['rect-1']?.changes).toEqual({ width: 300 });

    // Drag ended: changes is null
    store.handleServerMessage({
      t: 'DRAG_PREVIEW',
      clientId: 'client-1',
      objectId: 'rect-1',
      changes: null,
    });

    expect(store.remoteDragPreviews['rect-1']).toBeUndefined();
  });
});
