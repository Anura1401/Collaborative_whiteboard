#  Collaborative Whiteboard

A high-performance, real-time collaborative whiteboard built with a **server-authoritative, ordered-log architecture**. Multiple users can seamlessly draw, transform objects, and collaborate concurrently with sub-millisecond local latency, live cursors, ghost drag previews, and 100% eventual state convergence.

---

##  Highlights

- **Server-Authoritative Ordered Log**: No complex CRDTs or clock drift. The server linearizes operations into a strict sequence log.
- **Optimistic Reconciliation (0ms Latency)**: Local edits apply immediately to a pending queue; the UI automatically reconciles against server ACKs and rolls back on NACKs.
- **Real-Time Collaboration**: Live collaborator cursors, active transform ghost outlines, presence indicators, and anonymous shareable links.
- **High-Performance Canvas**: 60fps vanilla HTML5 Canvas engine with camera zoom/pan, spatial hit testing, transform handles, and alignment snapping.
- **Durability & Catch-Up**: PostgreSQL operation log and snapshot pruning with automatic client catch-up via sequence numbers.
- **Fault-Tolerant Simulation Suite**: Deterministic test simulator with synthetic network delay, packet drops, and chaos injection verifying state convergence.

---

##  Architecture

```
Browser (React + Canvas 2D + Zustand)
   │  ▲
   │  │  WebSocket (Ops, Cursors, Previews) + HTTP (Tickets, Boards)
   ▼  │
Node.js Fastify Server (Room Manager & Serial Queues)
   │
   ▼
PostgreSQL (Ordered Operations Log & Snapshots)
```

### Monorepo Structure

```
├── apps/
│   ├── web/          # React 19 frontend, Canvas 2D engine, tools & UI
│   └── server/       # Fastify HTTP + WebSocket server, rooms & PG storage
├── packages/
│   ├── shared/       # Domain types, Zod schemas, pure applyOp() & geometry
│   └── sim/          # Multi-client simulation harness & chaos testing
└── docs/             # Technical specifications and design decision records
```

---

##  Tech Stack

- **Frontend**: React 19, Vite, TypeScript, HTML5 Canvas 2D, Lucide Icons
- **Backend**: Node.js, Fastify, `ws` (WebSockets), `node-pg-migrate`
- **Database**: PostgreSQL 16 (with optional in-memory `pg-mem` fallback)
- **Validation**: Zod (shared schemas for runtime contract enforcement)
- **Monorepo & Build**: pnpm workspaces, Vitest, Playwright, ESLint, Prettier

---

##  Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Docker Desktop](https://www.docker.com/) (for PostgreSQL)

### 2. Start PostgreSQL
```powershell
docker compose up -d
```
*(Alternatively, set `ALLOW_IN_MEMORY_DB=true` in `.env` to run without Docker for local testing).*

### 3. Install Dependencies & Build
```powershell
pnpm install
pnpm build
```

### 4. Run Development Servers
```powershell
pnpm dev
```
Starts both servers concurrently:
- **Web App**: [http://localhost:5173](http://localhost:5173)
- **Backend API & WebSockets**: [http://localhost:8080](http://localhost:8080)

---

##  Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | Backend HTTP & WebSocket server port |
| `DATABASE_URL` | `postgres://postgres:postgrespassword@localhost:5432/whiteboard` | PostgreSQL connection string |
| `TICKET_SECRET` | `secret-ticket-signing-key...` | HMAC secret for one-time WebSocket connection tickets |
| `ALLOWED_ORIGINS` | `http://localhost:5173,...` | Allowed CORS origins for the API and WebSocket upgrades |
| `ALLOW_IN_MEMORY_DB` | `false` | Fallback to in-memory `pg-mem` if PostgreSQL is unreachable |
| `LOG_LEVEL` | `info` | Fastify logger level (`fatal`, `error`, `warn`, `info`, `debug`) |

---

##  Canvas Shortcuts

| Action | Shortcut |
| :--- | :--- |
| **Select / Transform** | `V` or `1` |
| **Rectangle / Ellipse** | `R` / `O` |
| **Line / Pen / Text** | `L` / `P` / `T` |
| **Hand (Pan)** | `H` or `Space + Drag` |
| **Zoom In / Out** | `+` / `-` or `Ctrl + Wheel` |
| **Undo / Redo** | `Ctrl + Z` / `Ctrl + Shift + Z` |
| **Duplicate / Delete** | `Ctrl + D` / `Delete` or `Backspace` |
| **Layer Ordering** | `[` / `]` (*Send Back* / *Bring Forward*) |

---

##  Testing & Verification

```powershell
# Run all unit and integration tests across monorepo
pnpm test

# Run strict multi-client simulation & state convergence tests
pnpm sim

# Type-check all packages
pnpm typecheck
```

---

##  License

MIT © [Anura](https://github.com/Anura1401)
