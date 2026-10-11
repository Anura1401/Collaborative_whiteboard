import type { BoardState, Obj, ObjType, Op } from '@whiteboard/shared';
import type { PRNG } from './prng.js';

const PALETTE = ['#0d99ff', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#000000', '#ffffff'];

export function generateRandomObject(prng: PRNG, type?: ObjType): Obj {
  const selectedType = type ?? prng.pick(['rect', 'ellipse', 'line', 'stroke', 'text'] as const);
  const id = prng.uuid();

  switch (selectedType) {
    case 'rect':
      return {
        id,
        type: 'rect',
        deleted: false,
        props: {
          x: prng.nextInt(0, 1200),
          y: prng.nextInt(0, 800),
          width: prng.nextInt(20, 300),
          height: prng.nextInt(20, 200),
          fill: prng.pick(['none', ...PALETTE]),
          stroke: prng.pick(PALETTE),
          strokeWidth: prng.nextInt(1, 8),
        },
      };

    case 'ellipse':
      return {
        id,
        type: 'ellipse',
        deleted: false,
        props: {
          x: prng.nextInt(0, 1200),
          y: prng.nextInt(0, 800),
          width: prng.nextInt(20, 300),
          height: prng.nextInt(20, 200),
          fill: prng.pick(['none', ...PALETTE]),
          stroke: prng.pick(PALETTE),
          strokeWidth: prng.nextInt(1, 8),
        },
      };

    case 'line':
      return {
        id,
        type: 'line',
        deleted: false,
        props: {
          x1: prng.nextInt(0, 1200),
          y1: prng.nextInt(0, 800),
          x2: prng.nextInt(0, 1200),
          y2: prng.nextInt(0, 800),
          stroke: prng.pick(PALETTE),
          strokeWidth: prng.nextInt(1, 8),
        },
      };

    case 'stroke': {
      const numPoints = prng.nextInt(4, 12);
      const points: number[] = [];
      let curX = 0;
      let curY = 0;
      for (let i = 0; i < numPoints; i++) {
        curX += prng.nextInt(-15, 15);
        curY += prng.nextInt(-15, 15);
        points.push(curX, curY);
      }
      return {
        id,
        type: 'stroke',
        deleted: false,
        props: {
          x: prng.nextInt(0, 1200),
          y: prng.nextInt(0, 800),
          points,
          color: prng.pick(PALETTE),
          strokeWidth: prng.nextInt(2, 6),
        },
      };
    }

    case 'text':
      return {
        id,
        type: 'text',
        deleted: false,
        props: {
          x: prng.nextInt(0, 1200),
          y: prng.nextInt(0, 800),
          width: prng.nextInt(100, 400),
          text: prng.pick(['Whiteboard test', 'Collaborative canvas', 'Real-time sync', 'Hello world', 'Simulated text']),
          fontSize: prng.pick([14, 16, 20, 24, 32]),
          color: prng.pick(PALETTE),
        },
      };

    default: {
      const _ex: never = selectedType;
      throw new Error(`Unknown type: ${_ex}`);
    }
  }
}

export function generateRandomOp(state: BoardState, prng: PRNG): Op {
  const liveIds = state.order.filter((id) => {
    const obj = state.objects[id];
    return obj && !obj.deleted;
  });

  // If no live objects exist or random chance (40%), create a new object
  if (liveIds.length === 0 || prng.next() < 0.4) {
    const object = generateRandomObject(prng);
    return {
      type: 'CREATE_OBJECT',
      object,
    };
  }

  const targetId = prng.pick(liveIds);
  const targetObj = state.objects[targetId]!;
  const actionRoll = prng.next();

  // 1. SET_PROPS (45% probability when objects exist)
  if (actionRoll < 0.45) {
    const changes: Record<string, unknown> = {};
    if (targetObj.type === 'rect' || targetObj.type === 'ellipse') {
      const propRoll = prng.next();
      if (propRoll < 0.5) {
        changes.x = prng.nextInt(0, 1200);
        changes.y = prng.nextInt(0, 800);
      } else if (propRoll < 0.8) {
        changes.width = prng.nextInt(20, 300);
        changes.height = prng.nextInt(20, 200);
      } else {
        changes.fill = prng.pick(['none', ...PALETTE]);
      }
    } else if (targetObj.type === 'line') {
      changes.x2 = prng.nextInt(0, 1200);
      changes.y2 = prng.nextInt(0, 800);
    } else if (targetObj.type === 'stroke') {
      changes.x = prng.nextInt(0, 1200);
      changes.y = prng.nextInt(0, 800);
    } else if (targetObj.type === 'text') {
      changes.text = `Updated ${prng.nextInt(1, 999)}`;
    }

    return {
      type: 'SET_PROPS',
      objectId: targetId,
      changes,
    };
  }

  // 2. DELETE_OBJECT (25% probability)
  if (actionRoll < 0.70) {
    return {
      type: 'DELETE_OBJECT',
      objectId: targetId,
    };
  }

  // 3. REORDER / REORDER_TO (30% probability)
  if (actionRoll < 0.85) {
    const action = prng.pick(['front', 'back', 'forward', 'backward'] as const);
    return {
      type: 'REORDER',
      objectId: targetId,
      action,
    };
  }

  return {
    type: 'REORDER_TO',
    objectId: targetId,
    index: prng.nextInt(0, Math.max(0, state.order.length - 1)),
  };
}
