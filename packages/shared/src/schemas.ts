import { z } from 'zod';
import {
  MAX_BOARD_NAME_LENGTH,
  MAX_COORD,
  MAX_NAME_LENGTH,
  MAX_SIZE,
  MAX_STROKE_NUMBERS,
  MAX_TEXT_LENGTH,
  MIN_FONT_SIZE,
  MIN_SIZE,
  MIN_STROKE_WIDTH,
  MIN_TEXT_WIDTH,
  MAX_FONT_SIZE,
  MAX_STROKE_WIDTH,
} from './limits.js';


export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color #rrggbb');
export const FillColorSchema = z.union([HexColorSchema, z.literal('none')]);

export const CoordSchema = z.number().finite().min(-MAX_COORD).max(MAX_COORD);
export const DimensionSchema = z.number().finite().min(MIN_SIZE).max(MAX_SIZE);
export const StrokeWidthSchema = z.number().finite().min(MIN_STROKE_WIDTH).max(MAX_STROKE_WIDTH);
export const FontSizeSchema = z.number().finite().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE);
export const TextWidthSchema = z.number().finite().min(MIN_TEXT_WIDTH).max(MAX_SIZE);
export const TextContentSchema = z.string().max(MAX_TEXT_LENGTH);

export const RectPropsSchema = z.object({
  x: CoordSchema,
  y: CoordSchema,
  width: DimensionSchema,
  height: DimensionSchema,
  fill: FillColorSchema,
  stroke: HexColorSchema,
  strokeWidth: StrokeWidthSchema,
}).strict();

export const EllipsePropsSchema = z.object({
  x: CoordSchema,
  y: CoordSchema,
  width: DimensionSchema,
  height: DimensionSchema,
  fill: FillColorSchema,
  stroke: HexColorSchema,
  strokeWidth: StrokeWidthSchema,
}).strict();

export const LinePropsSchema = z.object({
  x1: CoordSchema,
  y1: CoordSchema,
  x2: CoordSchema,
  y2: CoordSchema,
  stroke: HexColorSchema,
  strokeWidth: StrokeWidthSchema,
}).strict().refine((data) => data.x1 !== data.x2 || data.y1 !== data.y2, {
  message: 'Line endpoints must differ',
});

export const StrokePropsSchema = z.object({
  x: CoordSchema,
  y: CoordSchema,
  points: z.array(CoordSchema)
    .min(4)
    .max(MAX_STROKE_NUMBERS)
    .refine((pts) => pts.length % 2 === 0, {
      message: 'Points array length must be even',
    }),
  color: HexColorSchema,
  strokeWidth: StrokeWidthSchema,
}).strict();

export const TextPropsSchema = z.object({
  x: CoordSchema,
  y: CoordSchema,
  width: TextWidthSchema,
  text: TextContentSchema,
  fontSize: FontSizeSchema,
  color: HexColorSchema,
}).strict();

export const ObjTypeSchema = z.enum(['rect', 'ellipse', 'line', 'stroke', 'text']);

export const ObjSchema = z.object({
  id: z.string().uuid(),
  type: ObjTypeSchema,
  deleted: z.boolean(),
  props: z.record(z.unknown()),
}).strict();

export const BoardStateSchema = z.object({
  objects: z.record(ObjSchema),
  order: z.array(z.string().uuid()),
}).strict();

export const ReorderActionSchema = z.enum(['front', 'back', 'forward', 'backward']);

export const CreateObjectOpSchema = z.object({
  type: z.literal('CREATE_OBJECT'),
  object: ObjSchema,
}).strict();

export const SetPropsOpSchema = z.object({
  type: z.literal('SET_PROPS'),
  objectId: z.string().uuid(),
  changes: z.record(z.unknown()),
  expect: z.record(z.unknown()).optional(),
}).strict();

export const DeleteObjectOpSchema = z.object({
  type: z.literal('DELETE_OBJECT'),
  objectId: z.string().uuid(),
}).strict();

export const RestoreObjectOpSchema = z.object({
  type: z.literal('RESTORE_OBJECT'),
  object: ObjSchema,
  index: z.number().int(),
}).strict();

export const ReorderOpSchema = z.object({
  type: z.literal('REORDER'),
  objectId: z.string().uuid(),
  action: ReorderActionSchema,
}).strict();

export const ReorderToOpSchema = z.object({
  type: z.literal('REORDER_TO'),
  objectId: z.string().uuid(),
  index: z.number().int(),
}).strict();

export const OpSchema = z.discriminatedUnion('type', [
  CreateObjectOpSchema,
  SetPropsOpSchema,
  DeleteObjectOpSchema,
  RestoreObjectOpSchema,
  ReorderOpSchema,
  ReorderToOpSchema,
]);

export const NackReasonSchema = z.enum([
  'INVALID',
  'NOT_FOUND',
  'DELETED',
  'DUPLICATE_ID',
  'FORBIDDEN',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'RETRY',
  'INTERNAL',
  'CONFLICT',
]);

export const ClientJoinMsgSchema = z.object({
  t: z.literal('JOIN'),
  lastSeenSeq: z.number().int().nonnegative().optional(),
}).strict();

export const ClientSyncMsgSchema = z.object({
  t: z.literal('SYNC'),
  lastSeenSeq: z.number().int().nonnegative(),
}).strict();

export const ClientOpMsgSchema = z.object({
  t: z.literal('OP'),
  clientOpId: z.string().uuid(),
  op: OpSchema,
}).strict();

export const ClientCursorMsgSchema = z.object({
  t: z.literal('CURSOR'),
  x: CoordSchema,
  y: CoordSchema,
}).strict();

export const ClientDragPreviewMsgSchema = z.object({
  t: z.literal('DRAG_PREVIEW'),
  objectId: z.string().uuid(),
  changes: z.record(z.unknown()).nullable(),
}).strict();

export const ClientPingMsgSchema = z.object({
  t: z.literal('PING'),
}).strict();

export const ClientMsgSchema = z.discriminatedUnion('t', [
  ClientJoinMsgSchema,
  ClientSyncMsgSchema,
  ClientOpMsgSchema,
  ClientCursorMsgSchema,
  ClientDragPreviewMsgSchema,
  ClientPingMsgSchema,
]);

export const CommittedOpSchema = z.object({
  seq: z.number().int().positive(),
  clientId: z.string(),
  clientOpId: z.string().uuid(),
  op: OpSchema,
}).strict();

export const YouSchema = z.object({
  clientId: z.string(),
  color: HexColorSchema,
}).strict();

export const ServerSnapshotMsgSchema = z.object({
  t: z.literal('SNAPSHOT'),
  seq: z.number().int().nonnegative(),
  state: BoardStateSchema,
  you: YouSchema,
}).strict();

export const ServerOpsMsgSchema = z.object({
  t: z.literal('OPS'),
  ops: z.array(CommittedOpSchema),
  you: YouSchema,
}).strict();

export const ServerOpMsgSchema = z.object({
  t: z.literal('OP'),
  seq: z.number().int().positive(),
  clientId: z.string(),
  clientOpId: z.string().uuid(),
  op: OpSchema,
}).strict();

export const ServerAckMsgSchema = z.object({
  t: z.literal('ACK'),
  clientOpId: z.string().uuid(),
  seq: z.number().int().positive(),
}).strict();

export const ServerNackMsgSchema = z.object({
  t: z.literal('NACK'),
  clientOpId: z.string().uuid(),
  reason: NackReasonSchema,
}).strict();

export const PresenceUserSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  color: HexColorSchema,
}).strict();

export const ServerPresenceMsgSchema = z.object({
  t: z.literal('PRESENCE'),
  users: z.array(PresenceUserSchema),
}).strict();

export const ServerCursorMsgSchema = z.object({
  t: z.literal('CURSOR'),
  clientId: z.string(),
  x: CoordSchema,
  y: CoordSchema,
}).strict();

export const ServerDragPreviewMsgSchema = z.object({
  t: z.literal('DRAG_PREVIEW'),
  clientId: z.string(),
  objectId: z.string().uuid(),
  changes: z.record(z.unknown()).nullable(),
}).strict();

export const ServerPongMsgSchema = z.object({
  t: z.literal('PONG'),
}).strict();

export const ServerErrorMsgSchema = z.object({
  t: z.literal('ERROR'),
  code: z.string(),
  message: z.string(),
}).strict();

export const ServerMsgSchema = z.discriminatedUnion('t', [
  ServerSnapshotMsgSchema,
  ServerOpsMsgSchema,
  ServerOpMsgSchema,
  ServerAckMsgSchema,
  ServerNackMsgSchema,
  ServerPresenceMsgSchema,
  ServerCursorMsgSchema,
  ServerDragPreviewMsgSchema,
  ServerPongMsgSchema,
  ServerErrorMsgSchema,
]);

export const CreateBoardRequestSchema = z.object({
  name: z.string().max(MAX_BOARD_NAME_LENGTH).optional(),
}).strict();

export const WsTicketRequestSchema = z.object({
  clientId: z.string().uuid(),
  displayName: z.string().min(1).max(MAX_NAME_LENGTH),
}).strict();

export const TicketPayloadSchema = z.object({
  b: z.string().uuid(),
  c: z.string().uuid(),
  n: z.string().min(1).max(MAX_NAME_LENGTH),
  exp: z.number().int(),
  jti: z.string(),
}).strict();

export const MUTABLE_PROPS_BY_TYPE: Record<string, readonly string[]> = {
  rect: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth'],
  ellipse: ['x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth'],
  line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'strokeWidth'],
  stroke: ['x', 'y', 'color', 'strokeWidth'],
  text: ['x', 'y', 'width', 'text', 'fontSize', 'color'],
} as const;

export const IMMUTABLE_PROPS_BY_TYPE: Record<string, readonly string[]> = {
  rect: [],
  ellipse: [],
  line: [],
  stroke: ['points'],
  text: [],
} as const;
