import { describe, it, expect } from 'vitest';
import {
  applyOp,
  OpError,
  stripTombstones,
  invert,
  MAX_OBJECTS_PER_BOARD,
  MAX_CHANGES_PER_OP,
  type BoardState,
  type Obj,
  type Op,
} from '../src/index.js';

describe('OpError', () => {
  it('constructs with reason and default message', () => {
    const err = new OpError('CONFLICT');
    expect(err.reason).toBe('CONFLICT');
    expect(err.name).toBe('OpError');
    expect(err.message).toContain('CONFLICT');
  });
});


const emptyState: BoardState = {
  objects: {},
  order: [],
};

const validRect: Obj = {
  id: 'a0000000-0000-0000-0000-000000000001',
  type: 'rect',
  deleted: false,
  props: {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 2,
  },
};

const validLine: Obj = {
  id: 'a0000000-0000-0000-0000-000000000002',
  type: 'line',
  deleted: false,
  props: {
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
    stroke: '#ff0000',
    strokeWidth: 4,
  },
};

describe('applyOp - CREATE_OBJECT', () => {
  it('creates an object and pushes to order', () => {
    const op: Op = { type: 'CREATE_OBJECT', object: validRect };
    const next = applyOp(emptyState, op);

    expect(next.objects[validRect.id]).toEqual(validRect);
    expect(next.order).toEqual([validRect.id]);
    expect(next.objects[validRect.id]?.deleted).toBe(false);
  });

  it('rejects DUPLICATE_ID if object exists live', () => {
    const s1 = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });
    expect(() => applyOp(s1, { type: 'CREATE_OBJECT', object: validRect })).toThrowError(
      expect.objectContaining({ reason: 'DUPLICATE_ID' }),
    );
  });

  it('rejects DUPLICATE_ID if object exists as tombstone', () => {
    const s1 = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });
    const s2 = applyOp(s1, { type: 'DELETE_OBJECT', objectId: validRect.id });
    expect(() => applyOp(s2, { type: 'CREATE_OBJECT', object: validRect })).toThrowError(
      expect.objectContaining({ reason: 'DUPLICATE_ID' }),
    );
  });

  it('rejects INVALID on missing or invalid required props', () => {
    const badRect: Obj = {
      ...validRect,
      id: 'a0000000-0000-0000-0000-000000000003',
      props: { x: 0, y: 0, width: -10, height: 10, fill: '#fff', stroke: '#000', strokeWidth: 1 },
    };
    expect(() => applyOp(emptyState, { type: 'CREATE_OBJECT', object: badRect })).toThrowError(
      expect.objectContaining({ reason: 'INVALID' }),
    );
  });

  it('rejects INVALID if line endpoints are identical', () => {
    const zeroLine: Obj = {
      ...validLine,
      props: { x1: 50, y1: 50, x2: 50, y2: 50, stroke: '#000000', strokeWidth: 2 },
    };
    expect(() => applyOp(emptyState, { type: 'CREATE_OBJECT', object: zeroLine })).toThrowError(
      expect.objectContaining({ reason: 'INVALID' }),
    );
  });

  it('rejects LIMIT_EXCEEDED when board reaches max objects', () => {
    const fullOrder = Array.from({ length: MAX_OBJECTS_PER_BOARD }, (_, i) => `id-${i}`);
    const state: BoardState = {
      objects: {},
      order: fullOrder,
    };
    expect(() => applyOp(state, { type: 'CREATE_OBJECT', object: validRect })).toThrowError(
      expect.objectContaining({ reason: 'LIMIT_EXCEEDED' }),
    );
  });
});

describe('applyOp - SET_PROPS', () => {
  const s1 = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });

  it('updates mutable properties without changing order or unmentioned props', () => {
    const op: Op = {
      type: 'SET_PROPS',
      objectId: validRect.id,
      changes: { x: 50, y: 60 },
    };
    const s2 = applyOp(s1, op);
    expect(s2.objects[validRect.id]?.props.x).toBe(50);
    expect(s2.objects[validRect.id]?.props.y).toBe(60);
    expect(s2.objects[validRect.id]?.props.width).toBe(100);
    expect(s2.order).toBe(s1.order); // same reference
  });

  it('rejects NOT_FOUND if object does not exist', () => {
    expect(() =>
      applyOp(s1, {
        type: 'SET_PROPS',
        objectId: 'b0000000-0000-0000-0000-000000000099',
        changes: { x: 1 },
      }),
    ).toThrowError(expect.objectContaining({ reason: 'NOT_FOUND' }));
  });

  it('rejects DELETED if object is a tombstone', () => {
    const sDel = applyOp(s1, { type: 'DELETE_OBJECT', objectId: validRect.id });
    expect(() =>
      applyOp(sDel, {
        type: 'SET_PROPS',
        objectId: validRect.id,
        changes: { x: 20 },
      }),
    ).toThrowError(expect.objectContaining({ reason: 'DELETED' }));
  });

  it('rejects INVALID if changes is empty or exceeds MAX_CHANGES_PER_OP', () => {
    expect(() =>
      applyOp(s1, {
        type: 'SET_PROPS',
        objectId: validRect.id,
        changes: {},
      }),
    ).toThrowError(expect.objectContaining({ reason: 'INVALID' }));

    const tooManyChanges: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_CHANGES_PER_OP; i++) {
      tooManyChanges[`k${i}`] = i;
    }
    expect(() =>
      applyOp(s1, {
        type: 'SET_PROPS',
        objectId: validRect.id,
        changes: tooManyChanges,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'INVALID' }));
  });

  it('rejects INVALID on non-mutable property modification (e.g. stroke points)', () => {
    const strokeObj: Obj = {
      id: 'a0000000-0000-0000-0000-000000000005',
      type: 'stroke',
      deleted: false,
      props: {
        x: 0,
        y: 0,
        points: [0, 0, 10, 10],
        color: '#000000',
        strokeWidth: 2,
      },
    };
    const sStroke = applyOp(emptyState, { type: 'CREATE_OBJECT', object: strokeObj });
    expect(() =>
      applyOp(sStroke, {
        type: 'SET_PROPS',
        objectId: strokeObj.id,
        changes: { points: [0, 0, 20, 20] },
      }),
    ).toThrowError(expect.objectContaining({ reason: 'INVALID' }));
  });

  it('supports compare-and-set with expect (passes when matching, CONFLICT when mismatched)', () => {
    // Matching expect
    const s2 = applyOp(s1, {
      type: 'SET_PROPS',
      objectId: validRect.id,
      changes: { x: 200 },
      expect: { x: 10 },
    });
    expect(s2.objects[validRect.id]?.props.x).toBe(200);

    // Mismatched expect returns CONFLICT
    expect(() =>
      applyOp(s2, {
        type: 'SET_PROPS',
        objectId: validRect.id,
        changes: { x: 300 },
        expect: { x: 999 },
      }),
    ).toThrowError(expect.objectContaining({ reason: 'CONFLICT' }));
  });

  it('rejects INVALID if expect key is not present in changes', () => {
    expect(() =>
      applyOp(s1, {
        type: 'SET_PROPS',
        objectId: validRect.id,
        changes: { x: 200 },
        expect: { y: 20 },
      }),
    ).toThrowError(expect.objectContaining({ reason: 'INVALID' }));
  });
});

describe('applyOp - DELETE_OBJECT', () => {
  const s1 = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });

  it('sets deleted to true and removes from order', () => {
    const s2 = applyOp(s1, { type: 'DELETE_OBJECT', objectId: validRect.id });
    expect(s2.objects[validRect.id]?.deleted).toBe(true);
    expect(s2.order).toEqual([]);
  });

  it('rejects NOT_FOUND for unknown id and DELETED for already deleted', () => {
    expect(() =>
      applyOp(emptyState, { type: 'DELETE_OBJECT', objectId: validRect.id }),
    ).toThrowError(expect.objectContaining({ reason: 'NOT_FOUND' }));

    const s2 = applyOp(s1, { type: 'DELETE_OBJECT', objectId: validRect.id });
    expect(() => applyOp(s2, { type: 'DELETE_OBJECT', objectId: validRect.id })).toThrowError(
      expect.objectContaining({ reason: 'DELETED' }),
    );
  });
});

describe('applyOp - RESTORE_OBJECT', () => {
  const s1 = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });
  const s2 = applyOp(s1, { type: 'DELETE_OBJECT', objectId: validRect.id });

  it('restores tombstoned object at specified index', () => {
    const s3 = applyOp(s2, {
      type: 'RESTORE_OBJECT',
      object: validRect,
      index: 0,
    });
    expect(s3.objects[validRect.id]?.deleted).toBe(false);
    expect(s3.order).toEqual([validRect.id]);
  });

  it('restores an absent object (e.g. after snapshot stripped tombstone)', () => {
    const s3 = applyOp(emptyState, {
      type: 'RESTORE_OBJECT',
      object: validRect,
      index: 0,
    });
    expect(s3.objects[validRect.id]?.deleted).toBe(false);
    expect(s3.order).toEqual([validRect.id]);
  });

  it('rejects DUPLICATE_ID if already live', () => {
    expect(() =>
      applyOp(s1, {
        type: 'RESTORE_OBJECT',
        object: validRect,
        index: 0,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'DUPLICATE_ID' }));
  });
});

describe('applyOp - REORDER and REORDER_TO', () => {
  const obj1: Obj = { ...validRect, id: '11111111-1111-1111-1111-111111111111' };
  const obj2: Obj = { ...validRect, id: '22222222-2222-2222-2222-222222222222' };
  const obj3: Obj = { ...validRect, id: '33333333-3333-3333-3333-333333333333' };

  let s = applyOp(emptyState, { type: 'CREATE_OBJECT', object: obj1 });
  s = applyOp(s, { type: 'CREATE_OBJECT', object: obj2 });
  s = applyOp(s, { type: 'CREATE_OBJECT', object: obj3 });
  // Order: [1, 2, 3]

  it('reorders forward, backward, front, back', () => {
    // backward: 2 moves to 0 -> [2, 1, 3]
    let res = applyOp(s, { type: 'REORDER', objectId: obj2.id, action: 'backward' });
    expect(res.order).toEqual([obj2.id, obj1.id, obj3.id]);

    // front: 1 moves to end -> [2, 3, 1]
    res = applyOp(res, { type: 'REORDER', objectId: obj1.id, action: 'front' });
    expect(res.order).toEqual([obj2.id, obj3.id, obj1.id]);

    // back: 1 moves to 0 -> [1, 2, 3]
    res = applyOp(res, { type: 'REORDER', objectId: obj1.id, action: 'back' });
    expect(res.order).toEqual([obj1.id, obj2.id, obj3.id]);

    // forward: 1 moves to 1 -> [2, 1, 3]
    res = applyOp(res, { type: 'REORDER', objectId: obj1.id, action: 'forward' });
    expect(res.order).toEqual([obj2.id, obj1.id, obj3.id]);
  });

  it('handles REORDER_TO and clamps indices', () => {
    const res = applyOp(s, { type: 'REORDER_TO', objectId: obj1.id, index: 2 });
    expect(res.order).toEqual([obj2.id, obj3.id, obj1.id]);

    // Clamp beyond max index
    const resClamped = applyOp(s, { type: 'REORDER_TO', objectId: obj1.id, index: 100 });
    expect(resClamped.order).toEqual([obj2.id, obj3.id, obj1.id]);
  });

  it('no-op when reorder is already at boundary (preserves reference)', () => {
    const res = applyOp(s, { type: 'REORDER', objectId: obj1.id, action: 'back' });
    expect(res).toBe(s);
  });
});

describe('stripTombstones and invert', () => {
  it('stripTombstones purges deleted objects', () => {
    let s = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });
    s = applyOp(s, { type: 'DELETE_OBJECT', objectId: validRect.id });
    expect(s.objects[validRect.id]).toBeDefined();

    const stripped = stripTombstones(s);
    expect(stripped.objects[validRect.id]).toBeUndefined();
    expect(stripped.order).toEqual([]);
  });

  it('invert correctly computes inverse operations', () => {
    const s = applyOp(emptyState, { type: 'CREATE_OBJECT', object: validRect });

    // CREATE -> DELETE
    expect(invert({ type: 'CREATE_OBJECT', object: validRect }, emptyState)).toEqual({
      type: 'DELETE_OBJECT',
      objectId: validRect.id,
    });

    // SET_PROPS -> SET_PROPS with before and expect
    expect(
      invert({ type: 'SET_PROPS', objectId: validRect.id, changes: { x: 100, y: 200 } }, s),
    ).toEqual({
      type: 'SET_PROPS',
      objectId: validRect.id,
      changes: { x: 10, y: 20 },
      expect: { x: 100, y: 200 },
    });

    // DELETE -> RESTORE
    expect(invert({ type: 'DELETE_OBJECT', objectId: validRect.id }, s)).toEqual({
      type: 'RESTORE_OBJECT',
      object: validRect,
      index: 0,
    });
  });
});
