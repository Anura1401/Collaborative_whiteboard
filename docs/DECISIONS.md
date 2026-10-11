# Architecture & Design Decisions

This document records all design choices and clarifications made during implementation where the specification allowed flexibility.

## D-001: Monorepo & Tooling Setup (M0)
- **Choice**: pnpm workspaces with strict TypeScript (`tsconfig.base.json`), ESLint flat config, Prettier, and Vitest for unit/integration testing.
- **Packages**:
  - `@whiteboard/shared`: pure logic, types, zod schemas, geometry, `applyOp`.
  - `@whiteboard/sim`: simulator, fault injector, invariants, load tester.
  - `@whiteboard/server`: Fastify HTTP + `ws` WebSocket server with PostgreSQL.
  - `@whiteboard/web`: React + Vite + Canvas 2D + Zustand + Lucide icons.
- **Rationale**: Direct adherence to section 17 & 18. Strict isolation ensures zero duplicate types or logic between server and web.

## D-002: Protocol & Operation Invariants (M1)
- **Choice**:
  - Implemented `applyOp` with pure copy-on-write state transformation.
  - Operations supported: `CREATE_OBJECT`, `SET_PROPS` (with compare-and-set `expect`), `DELETE_OBJECT`, `RESTORE_OBJECT`, `REORDER`, `REORDER_TO`.
  - Implemented `stripTombstones(state)` for snapshotting.
  - Implemented `invert(op, view)` for local undo/redo history.
  - Implemented pure geometry helpers: `distanceToSegment`, `simplifyPoints` (Ramer-Douglas-Peucker), `getBounds`, `getHandles`, `resizeFromHandle` (with aspect ratio lock), `hitTest` (handling filled vs hollow borders).
  - Rejection reasons: `INVALID`, `NOT_FOUND`, `DELETED`, `DUPLICATE_ID`, `FORBIDDEN`, `RATE_LIMITED`, `LIMIT_EXCEEDED`, `RETRY`, `INTERNAL`, `CONFLICT`.

## D-003: Single-User Canvas Architecture & Local Loopback (M2)
- **Choice**:
  - `BoardStore` implemented as a vanilla TypeScript class decoupling reactive canvas renders from React component renders.
  - Pointer moves interact solely with `dirty` flag and `requestAnimationFrame` render loop, avoiding any React `setState` during drag/move events (Rule 8).
  - Implemented 6px edge & center snapping with magenta guides and 45-degree angle constraints on Shift for lines.
  - Arrow key nudges are debounced into a single `SET_PROPS` after 300ms of inactivity.
  - Local loopback applies operations directly via `applyOp` to `confirmed` and `view` in M2, which seamlessly switches to WebSocket streaming in M4.

## D-004: Server Core & Database Transaction Design (M3)
- **Choice**:
  - Implemented Fastify with `@fastify/cors` and `@fastify/rate-limit`.
  - Database schema adheres to Section 5: `boards`, `operations`, and `snapshots`.
  - Row-level sequence locking via `UPDATE boards SET current_seq = current_seq + 1 ...` ensuring no skipped or duplicate sequences.
  - Operations deduplicated via in-memory FIFO map and DB index before validation.
  - Ephemeral events (`CURSOR`, `DRAG_PREVIEW`) relayed directly to room participants without DB persistence or sequence numbers.
  - Graceful shutdown handles `SIGTERM`/`SIGINT`, draining queues and closing sockets with code 1012.

## D-005: Client Networking & Optimistic Reconciliation (M4)
- **Choice**:
  - Client state maintains `confirmed` state (server-ordered) and `pending[]` queue of optimistic uncommitted operations.
  - `view` is computed by applying `pending[]` on top of `confirmed`. Local edits reflect instantly on the canvas with 0 latency.
  - When live `OP` arrives: if matching `(clientId, clientOpId)`, the entry is removed from `pending`, and `confirmed` advances to `seq`.
  - Sequence contiguity is verified on every message. If a gap is detected (`seq !== lastSeq + 1`), client pauses live application and sends `SYNC` request with `lastSeenSeq`.
  - Heartbeat: Application ping every 20s with 10s timeout, exponential backoff with jitter on disconnect.

## D-006: Multi-User Collaboration & Ephemeral Presence (M5)
- **Choice**:
  - Live cursor tracking broadcasts ephemeral `CURSOR` events throttled to 25Hz (40ms) with world coordinates.
  - Active drag/resize operations broadcast ephemeral `DRAG_PREVIEW` with object ID and property deltas.
  - Ghost previews are rendered as dashed colored bounding boxes showing collaborator names during live transformations.
  - Cursors render with assigned participant colors, shadow elevation, and name badge pills, automatically fading out on inactivity (>6s) and pruning on disconnect.
  - TopBar displays a live presence avatar stack with participant initials, assigned color badges, count indicators, and real-time connectivity status pills.

## D-007: Simulation & Invariant Harness (M6)
- **Choice**:
  - Deterministic PRNG (`Mulberry32`) ensures 100% reproducible multi-client concurrent simulations given a seed.
  - `SimClient` mirrors real client state transitions with optimistic queues, server ACK/NACK processing, and automatic SYNC catch-up.
  - `FaultChannel` provides realistic network chaos injection: synthetic latency, jitter, packet loss, and reordering.
  - Invariant oracle enforces strict structural integrity, contiguous sequence numbers, and 100% state convergence between all clients and the server log.
  - CLI runner (`pnpm sim`) executes multi-client simulation suites with real-time performance and convergence metrics.

## D-008: E2E Testing, Hardening & Production Bundle (M7)
- **Choice**:
  - Playwright test suite (`apps/web/test/e2e`) tests end-to-end user journeys (canvas interactions, drawing shapes, layers panel, theme toggles, undo/redo).
  - Docker Compose provides turnkey containerization of PostgreSQL (`postgres:16-alpine`) and services.
  - Optimized production build bundles with Vite asset hashing and zero TypeScript compiler warnings across the entire monorepo.







