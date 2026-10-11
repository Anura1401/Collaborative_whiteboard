# Collaborative Whiteboard: Technical Spec

Server-authoritative design, version 1

## 1. Goal and scope
A web whiteboard where several people edit one board at the same time and see each other's changes within a fraction of a second.

**In scope:** rectangle, ellipse, line, freehand stroke, simple text; move, resize, delete, reorder; live cursors; presence; reconnect and catch-up; persistence across server restarts; anonymous board links; undo and redo (Part 3).
**Out of scope for v1:** rotation, user accounts and permissions, offline editing, multiple backend instances, character-level collaborative text.

**Core idea:** a board is the result of an ordered log of operations. The server gives every accepted operation the next sequence number for that board. Anyone who applies the same operations in the same order ends up with the same board. There are no clocks and no CRDT merging, because one server decides the order.

## 2. Architecture
```
Browser (React + TypeScript + Canvas)
  | WebSocket (ops, ephemeral events) + HTTPS (create board, ws ticket)
  v
Node.js server (one instance in v1)
  | Rooms: in-memory board state, serial queue per board
  | Pipeline: validate -> persist -> ack -> broadcast
  v
PostgreSQL: boards, operations (append-only log), snapshots
```
- **Shared package:** TypeScript types, zod schemas, and a pure function `applyOp(state, op)`. The client and the server both use it, so they cannot disagree about what an operation means.
- **Single instance:** v1 runs exactly one backend process. This is a stated assumption and is guarded in code.
- **Source of truth:** the PostgreSQL operation log. Broadcast is only a fast path. Anything a client misses can be recovered from the room state or the log.

## 3. Data model
```typescript
type BoardState = {
  objects: Record<string, Obj>; // includes tombstones until the next snapshot
  order: string[]; // ids of live objects, back to front
};

type Obj = {
  id: string; // client-generated UUID
  type: 'rect' | 'ellipse' | 'line' | 'stroke' | 'text';
  deleted: boolean; // tombstone flag
  props: Record<string, unknown>;
};
```
Layering is the `order` array only. There is no numeric z-index. Operations express intent ('bring to front') and the server computes the new position.

Each type has a whitelist of properties that may be changed after creation. Validation rejects anything else:
- `rect`, `ellipse`: Mutable (`x`, `y`, `width`, `height`, `fill`, `stroke`, `strokeWidth`), Immutable (`none`)
- `line`: Mutable (`x1`, `y1`, `x2`, `y2`, `stroke`, `strokeWidth`), Immutable (`none`)
- `stroke`: Mutable (`x`, `y` (offset), `color`, `strokeWidth`), Immutable (`points`)
- `text`: Mutable (`x`, `y`, `width`, `text`, `fontSize`, `color`), Immutable (`none`)

A finished pen stroke is created once with its full point list and never merged. Moving it changes only its x, y offset.

## 4. Operations
Every durable change is one operation inside an envelope.
```typescript
type Envelope = {
  clientId: string; // random per browser tab, kept in sessionStorage
  clientOpId: string; // UUID, unique per operation
  op: Op;
};

type Op =
  | { type: 'CREATE_OBJECT'; object: Obj }
  | { type: 'SET_PROPS'; objectId: string; changes: Record<string, unknown>; expect?: Record<string, unknown> }
  | { type: 'DELETE_OBJECT'; objectId: string }
  | { type: 'RESTORE_OBJECT'; object: Obj; index: number }
  | { type: 'REORDER'; objectId: string; action: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'REORDER_TO'; objectId: string; index: number };
```

## 5. Database Schema
```sql
CREATE TABLE boards (
  id uuid PRIMARY KEY,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  current_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE operations (
  board_id uuid NOT NULL REFERENCES boards(id),
  seq bigint NOT NULL,
  client_id text NOT NULL,
  client_op_id uuid NOT NULL,
  op jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq),
  UNIQUE (board_id, client_id, client_op_id)
);

CREATE TABLE snapshots (
  board_id uuid NOT NULL REFERENCES boards(id),
  seq bigint NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq)
);
```

## 6. Server Pipeline
1. Parse and check (64 KB limit, Zod validation, token bucket rate limit 30 ops/sec).
2. Enqueue on board's serial queue.
3. Dedupe via recent-operations map / DB.
4. Validate against room state using `applyOp`.
5. Transaction with row-lock `UPDATE boards SET current_seq = current_seq + 1 ...` verifying contiguous seq.
6. After commit: update room state, room seq, and ring buffer.
7. ACK sender, broadcast OP to room.
8. Snapshot if `seq % SNAPSHOT_EVERY == 0`.
