import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyOp,
  invert,
  simplifyPoints,
  type BoardState,
  type Obj,
  type Op,
} from '../src/index.js';

describe('Property Tests (fast-check)', () => {
  it('Property: simplifyPoints never leaves fewer than 2 points (4 numbers) when input has >= 2 points', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -10000, max: 10000, noNaN: true }), {
          minLength: 4,
          maxLength: 100,
        }).map((arr) => (arr.length % 2 === 0 ? arr : [...arr, 0])),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        (points, epsilon) => {
          const simplified = simplifyPoints(points, epsilon);
          expect(simplified.length).toBeGreaterThanOrEqual(4);
          expect(simplified.length % 2).toBe(0);
          expect(simplified.length).toBeLessThanOrEqual(points.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: Applying any sequence of operations maintains order integrity (no deleted or missing IDs in order)', () => {
    const emptyState: BoardState = { objects: {}, order: [] };

    // Helper to generate UUID-like string
    const idArbitrary = fc.uuid();

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: idArbitrary,
            x: fc.integer({ min: -1000, max: 1000 }),
            y: fc.integer({ min: -1000, max: 1000 }),
            width: fc.integer({ min: 10, max: 500 }),
            height: fc.integer({ min: 10, max: 500 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (objectsToCreate) => {
          let state = emptyState;
          const createdIds: string[] = [];

          // Create objects
          for (const item of objectsToCreate) {
            if (state.objects[item.id]) continue;
            const obj: Obj = {
              id: item.id,
              type: 'rect',
              deleted: false,
              props: {
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                fill: '#ffffff',
                stroke: '#000000',
                strokeWidth: 2,
              },
            };
            state = applyOp(state, { type: 'CREATE_OBJECT', object: obj });
            createdIds.push(item.id);
          }

          // Random mutations: moves, deletes, reorders
          for (const id of createdIds) {
            // Reorder
            state = applyOp(state, { type: 'REORDER', objectId: id, action: 'front' });
            // Set props
            state = applyOp(state, {
              type: 'SET_PROPS',
              objectId: id,
              changes: { x: 50, y: 50 },
            });
          }

          // Delete some
          if (createdIds.length > 0 && createdIds[0]) {
            state = applyOp(state, { type: 'DELETE_OBJECT', objectId: createdIds[0] });
          }

          // Invariant assertion: order must only contain existing, non-deleted objects
          for (const orderId of state.order) {
            const obj = state.objects[orderId];
            expect(obj).toBeDefined();
            expect(obj?.deleted).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: Undo all operations returns board to initial state', () => {
    const initialState: BoardState = { objects: {}, order: [] };

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            x: fc.integer({ min: 0, max: 500 }),
            y: fc.integer({ min: 0, max: 500 }),
            width: fc.integer({ min: 10, max: 200 }),
            height: fc.integer({ min: 10, max: 200 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (shapes) => {
          let currentState = initialState;
          const undoStack: Op[] = [];

          // Apply creations and record inverts
          for (const shape of shapes) {
            if (currentState.objects[shape.id]) continue;
            const op: Op = {
              type: 'CREATE_OBJECT',
              object: {
                id: shape.id,
                type: 'rect',
                deleted: false,
                props: {
                  x: shape.x,
                  y: shape.y,
                  width: shape.width,
                  height: shape.height,
                  fill: '#ffffff',
                  stroke: '#000000',
                  strokeWidth: 2,
                },
              },
            };

            const inv = invert(op, currentState);
            if (inv) {
              undoStack.push(inv);
            }
            currentState = applyOp(currentState, op);
          }

          // Now pop and apply all undos in reverse
          while (undoStack.length > 0) {
            const undoOp = undoStack.pop()!;
            currentState = applyOp(currentState, undoOp);
          }

          // State should now have empty live order
          expect(currentState.order).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
