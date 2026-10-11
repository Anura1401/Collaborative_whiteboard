import { MAX_CHANGES_PER_OP, MAX_OBJECTS_PER_BOARD } from './limits.js';
import {
  EllipsePropsSchema,
  LinePropsSchema,
  MUTABLE_PROPS_BY_TYPE,
  RectPropsSchema,
  StrokePropsSchema,
  TextPropsSchema,
} from './schemas.js';


import type { BoardState, NackReason, Obj, ObjType, Op } from './types.js';

export class OpError extends Error {
  readonly reason: NackReason;

  constructor(reason: NackReason, message?: string) {
    super(message ?? `Operation failed with reason: ${reason}`);
    this.name = 'OpError';
    this.reason = reason;
  }
}

export function validateObjProps(type: ObjType, props: Record<string, unknown>): boolean {
  switch (type) {
    case 'rect':
      return RectPropsSchema.safeParse(props).success;
    case 'ellipse':
      return EllipsePropsSchema.safeParse(props).success;
    case 'line':
      return LinePropsSchema.safeParse(props).success;
    case 'stroke':
      return StrokePropsSchema.safeParse(props).success;
    case 'text':
      return TextPropsSchema.safeParse(props).success;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function stripTombstones(state: BoardState): BoardState {
  const nextObjects: Record<string, Obj> = {};
  const liveOrderSet = new Set<string>();

  for (const id of state.order) {
    const obj = state.objects[id];
    if (obj && !obj.deleted) {
      nextObjects[id] = obj;
      liveOrderSet.add(id);
    }
  }

  // Also include any non-deleted object that might not be in order (fallback)
  for (const [id, obj] of Object.entries(state.objects)) {
    if (!obj.deleted && !nextObjects[id]) {
      nextObjects[id] = obj;
    }
  }

  const nextOrder = state.order.filter((id) => liveOrderSet.has(id));

  return {
    objects: nextObjects,
    order: nextOrder,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function applyOp(state: BoardState, op: Op): BoardState {
  switch (op.type) {
    case 'CREATE_OBJECT': {
      const { object } = op;
      if (state.objects[object.id] !== undefined) {
        throw new OpError('DUPLICATE_ID', `Object ${object.id} already exists`);
      }

      if (state.order.length >= MAX_OBJECTS_PER_BOARD) {
        throw new OpError(
          'LIMIT_EXCEEDED',
          `Cannot exceed max objects per board (${MAX_OBJECTS_PER_BOARD})`,
        );
      }

      if (!validateObjProps(object.type, object.props)) {
        throw new OpError('INVALID', `Invalid properties for object type ${object.type}`);
      }

      const createdObj: Obj = {
        id: object.id,
        type: object.type,
        deleted: false,
        props: { ...object.props },
      };

      return {
        objects: {
          ...state.objects,
          [object.id]: createdObj,
        },
        order: [...state.order, object.id],
      };
    }

    case 'SET_PROPS': {
      const existing = state.objects[op.objectId];
      if (!existing) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found`);
      }
      if (existing.deleted) {
        throw new OpError('DELETED', `Object ${op.objectId} is deleted`);
      }

      const changeKeys = Object.keys(op.changes);
      if (changeKeys.length === 0 || changeKeys.length > MAX_CHANGES_PER_OP) {
        throw new OpError('INVALID', `Invalid number of changes (${changeKeys.length})`);
      }

      const allowedMutable = MUTABLE_PROPS_BY_TYPE[existing.type] ?? [];
      for (const key of changeKeys) {
        if (!allowedMutable.includes(key)) {
          throw new OpError(
            'INVALID',
            `Property '${key}' is not mutable on object type '${existing.type}'`,
          );
        }
      }

      // Check expect (compare-and-set for undo/redo)
      if (op.expect !== undefined) {
        const expectKeys = Object.keys(op.expect);
        for (const key of expectKeys) {
          if (!(key in op.changes)) {
            throw new OpError('INVALID', `Expect key '${key}' must also be in changes`);
          }
          if (existing.props[key] !== op.expect[key]) {
            throw new OpError('CONFLICT', `Value for '${key}' does not match expected value`);
          }
        }
      }

      const mergedProps = {
        ...existing.props,
        ...op.changes,
      };

      if (!validateObjProps(existing.type, mergedProps)) {
        throw new OpError('INVALID', `Merged properties are invalid for type '${existing.type}'`);
      }

      const updatedObj: Obj = {
        ...existing,
        props: mergedProps,
      };

      return {
        ...state,
        objects: {
          ...state.objects,
          [op.objectId]: updatedObj,
        },
      };
    }

    case 'DELETE_OBJECT': {
      const existing = state.objects[op.objectId];
      if (!existing) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found`);
      }
      if (existing.deleted) {
        throw new OpError('DELETED', `Object ${op.objectId} is already deleted`);
      }

      const deletedObj: Obj = {
        ...existing,
        deleted: true,
      };

      return {
        objects: {
          ...state.objects,
          [op.objectId]: deletedObj,
        },
        order: state.order.filter((id) => id !== op.objectId),
      };
    }

    case 'RESTORE_OBJECT': {
      const { object, index } = op;
      const existing = state.objects[object.id];

      if (existing && !existing.deleted) {
        throw new OpError('DUPLICATE_ID', `Object ${object.id} is already live`);
      }

      if (state.order.length >= MAX_OBJECTS_PER_BOARD) {
        throw new OpError(
          'LIMIT_EXCEEDED',
          `Cannot exceed max objects per board (${MAX_OBJECTS_PER_BOARD})`,
        );
      }

      if (!validateObjProps(object.type, object.props)) {
        throw new OpError('INVALID', `Invalid properties for restored object type ${object.type}`);
      }

      const restoredObj: Obj = {
        id: object.id,
        type: object.type,
        deleted: false,
        props: { ...object.props },
      };

      const insertIndex = clamp(index, 0, state.order.length);
      const nextOrder = [...state.order];
      nextOrder.splice(insertIndex, 0, object.id);

      return {
        objects: {
          ...state.objects,
          [object.id]: restoredObj,
        },
        order: nextOrder,
      };
    }

    case 'REORDER': {
      const existing = state.objects[op.objectId];
      if (!existing) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found`);
      }
      if (existing.deleted) {
        throw new OpError('DELETED', `Object ${op.objectId} is deleted`);
      }

      const currentIndex = state.order.indexOf(op.objectId);
      if (currentIndex === -1) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found in order`);
      }

      let targetIndex = currentIndex;
      switch (op.action) {
        case 'front':
          targetIndex = state.order.length - 1;
          break;
        case 'back':
          targetIndex = 0;
          break;
        case 'forward':
          targetIndex = Math.min(state.order.length - 1, currentIndex + 1);
          break;
        case 'backward':
          targetIndex = Math.max(0, currentIndex - 1);
          break;
        default: {
          const _exhaustive: never = op.action;
          return _exhaustive;
        }
      }

      if (targetIndex === currentIndex) {
        return state;
      }

      const nextOrder = [...state.order];
      nextOrder.splice(currentIndex, 1);
      nextOrder.splice(targetIndex, 0, op.objectId);

      return {
        ...state,
        order: nextOrder,
      };
    }

    case 'REORDER_TO': {
      const existing = state.objects[op.objectId];
      if (!existing) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found`);
      }
      if (existing.deleted) {
        throw new OpError('DELETED', `Object ${op.objectId} is deleted`);
      }

      const currentIndex = state.order.indexOf(op.objectId);
      if (currentIndex === -1) {
        throw new OpError('NOT_FOUND', `Object ${op.objectId} not found in order`);
      }

      const targetIndex = clamp(op.index, 0, state.order.length - 1);
      if (targetIndex === currentIndex) {
        return state;
      }

      const nextOrder = [...state.order];
      nextOrder.splice(currentIndex, 1);
      nextOrder.splice(targetIndex, 0, op.objectId);

      return {
        ...state,
        order: nextOrder,
      };
    }

    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function invert(op: Op, view: BoardState): Op | null {
  switch (op.type) {
    case 'CREATE_OBJECT':
      return {
        type: 'DELETE_OBJECT',
        objectId: op.object.id,
      };

    case 'SET_PROPS': {
      const obj = view.objects[op.objectId];
      if (!obj || obj.deleted) return null;

      const before: Record<string, unknown> = {};
      for (const key of Object.keys(op.changes)) {
        if (key in obj.props) {
          before[key] = obj.props[key];
        }
      }

      return {
        type: 'SET_PROPS',
        objectId: op.objectId,
        changes: before,
        expect: { ...op.changes },
      };
    }

    case 'DELETE_OBJECT': {
      const obj = view.objects[op.objectId];
      if (!obj || obj.deleted) return null;

      const index = view.order.indexOf(op.objectId);
      return {
        type: 'RESTORE_OBJECT',
        object: {
          id: obj.id,
          type: obj.type,
          deleted: false,
          props: { ...obj.props },
        },
        index: index === -1 ? 0 : index,
      };
    }

    case 'RESTORE_OBJECT':
      return {
        type: 'DELETE_OBJECT',
        objectId: op.object.id,
      };

    case 'REORDER':
    case 'REORDER_TO': {
      const obj = view.objects[op.objectId];
      if (!obj || obj.deleted) return null;

      const index = view.order.indexOf(op.objectId);
      if (index === -1) return null;

      return {
        type: 'REORDER_TO',
        objectId: op.objectId,
        index,
      };
    }

    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}
