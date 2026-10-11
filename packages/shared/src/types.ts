export type ObjType = 'rect' | 'ellipse' | 'line' | 'stroke' | 'text';

export interface BaseProps {
  [key: string]: unknown;
}

export interface RectProps extends BaseProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string; // #rrggbb or 'none'
  stroke: string; // #rrggbb
  strokeWidth: number;
}

export interface EllipseProps extends BaseProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string; // #rrggbb or 'none'
  stroke: string; // #rrggbb
  strokeWidth: number;
}

export interface LineProps extends BaseProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string; // #rrggbb
  strokeWidth: number;
}

export interface StrokeProps extends BaseProps {
  x: number;
  y: number;
  points: number[]; // flat [x0, y0, x1, y1, ...], immutable
  color: string; // #rrggbb
  strokeWidth: number;
}

export interface TextProps extends BaseProps {
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  color: string; // #rrggbb
}

export interface Obj {
  id: string; // UUID
  type: ObjType;
  deleted: boolean;
  props: Record<string, unknown>;
}

export interface BoardState {
  objects: Record<string, Obj>;
  order: string[]; // ids of live objects, back to front
}

export type ReorderAction = 'front' | 'back' | 'forward' | 'backward';

export type Op =
  | { type: 'CREATE_OBJECT'; object: Obj }
  | {
      type: 'SET_PROPS';
      objectId: string;
      changes: Record<string, unknown>;
      expect?: Record<string, unknown>;
    }
  | { type: 'DELETE_OBJECT'; objectId: string }
  | { type: 'RESTORE_OBJECT'; object: Obj; index: number }
  | { type: 'REORDER'; objectId: string; action: ReorderAction }
  | { type: 'REORDER_TO'; objectId: string; index: number };

export interface Envelope {
  clientId: string;
  clientOpId: string;
  op: Op;
}

export interface CommittedOp {
  seq: number;
  clientId: string;
  clientOpId: string;
  op: Op;
}

export interface You {
  clientId: string;
  color: string;
}

export type NackReason =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'DELETED'
  | 'DUPLICATE_ID'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'LIMIT_EXCEEDED'
  | 'RETRY'
  | 'INTERNAL'
  | 'CONFLICT';

export interface PresenceUser {
  clientId: string;
  name: string;
  color: string;
}

export type ClientMsg =
  | { t: 'JOIN'; lastSeenSeq?: number }
  | { t: 'SYNC'; lastSeenSeq: number }
  | { t: 'OP'; clientOpId: string; op: Op }
  | { t: 'CURSOR'; x: number; y: number }
  | { t: 'DRAG_PREVIEW'; objectId: string; changes: Record<string, unknown> | null }
  | { t: 'PING' };

export type ServerMsg =
  | { t: 'SNAPSHOT'; seq: number; state: BoardState; you: You }
  | { t: 'OPS'; ops: CommittedOp[]; you: You }
  | { t: 'OP'; seq: number; clientId: string; clientOpId: string; op: Op }
  | { t: 'ACK'; clientOpId: string; seq: number }
  | { t: 'NACK'; clientOpId: string; reason: NackReason }
  | { t: 'PRESENCE'; users: PresenceUser[] }
  | { t: 'CURSOR'; clientId: string; x: number; y: number }
  | {
      t: 'DRAG_PREVIEW';
      clientId: string;
      objectId: string;
      changes: Record<string, unknown> | null;
    }
  | { t: 'PONG' }
  | { t: 'ERROR'; code: string; message: string };

export interface TicketPayload {
  b: string; // boardId
  c: string; // clientId
  n: string; // displayName
  exp: number; // expiration timestamp (seconds or ms)
  jti: string; // unique random id
}

export type HandleType =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw'
  | 'start'
  | 'end';

export interface Point {
  x: number;
  y: number;
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HistoryEntry {
  op: Op;
  sourceOpId: string;
}
