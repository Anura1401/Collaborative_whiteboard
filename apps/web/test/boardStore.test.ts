import { describe, it, expect, beforeEach } from 'vitest';
import { BoardStore } from '../src/store/boardStore.js';
import type { Obj } from '@whiteboard/shared';

describe('BoardStore (single user local mode)', () => {
  let store: BoardStore;

  const testRect: Obj = {
    id: '11111111-1111-1111-1111-111111111111',
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

  beforeEach(() => {
    store = new BoardStore();
    store.setStatus('LIVE');
  });

  it('submits CREATE_OBJECT and updates view', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    expect(store.view.objects[testRect.id]).toEqual(testRect);
    expect(store.view.order).toEqual([testRect.id]);
  });

  it('updates properties with SET_PROPS', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    store.submit({
      type: 'SET_PROPS',
      objectId: testRect.id,
      changes: { x: 300, y: 400 },
    });
    expect(store.view.objects[testRect.id]?.props.x).toBe(300);
    expect(store.view.objects[testRect.id]?.props.y).toBe(400);
  });

  it('deletes selected object', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    store.setSelected(testRect.id);
    store.deleteSelection();
    expect(store.view.order).toEqual([]);
    expect(store.view.objects[testRect.id]?.deleted).toBe(true);
    expect(store.selectedId).toBeNull();
  });

  it('duplicates selected object with +16px offset', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    store.setSelected(testRect.id);
    store.duplicateSelection();
    expect(store.view.order).toHaveLength(2);
    const newId = store.selectedId;
    expect(newId).not.toBe(testRect.id);
    expect(store.view.objects[newId!]?.props.x).toBe(116);
    expect(store.view.objects[newId!]?.props.y).toBe(116);
  });

  it('performs undo and redo', () => {
    store.submit({ type: 'CREATE_OBJECT', object: testRect });
    expect(store.view.order).toEqual([testRect.id]);
    expect(store.canUndo()).toBe(true);

    // Undo create -> deleted
    store.undo();
    expect(store.view.order).toEqual([]);
    expect(store.canRedo()).toBe(true);

    // Redo -> restored
    store.redo();
    expect(store.view.order).toEqual([testRect.id]);
  });
});
