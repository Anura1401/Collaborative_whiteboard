import {
  applyOp,
  OpError,
  stripTombstones,
  type BoardState,
  type CommittedOp,
  type Op,
  type PresenceUser,
  type ServerMsg,
  type You,
} from '@whiteboard/shared';
import { config } from '../config.js';
import { getBoard } from '../db/boards.js';
import {
  commitOp,
  findOp,
  isUniqueViolation,
  loadOpsAfter,
  SeqMismatch,
} from '../db/operations.js';
import {
  loadLatestSnapshot,
  pruneSnapshots,
  saveSnapshot,
} from '../db/snapshots.js';
import { pickLeastUsedColor } from '../services/presence.js';
import type { Connection } from '../ws/gateway.js';
import { SerialQueue } from '../util/serialQueue.js';

export class Room {
  readonly id: string;
  state: BoardState = { objects: {}, order: [] };
  seq = 0;

  readonly queue = new SerialQueue();
  readonly connections = new Set<Connection>();
  readonly ring: CommittedOp[] = [];
  readonly recent = new Map<string, number>(); // clientId:clientOpId -> seq

  private isLoaded = false;
  private onEmptyCallback?: () => void;

  constructor(id: string, onEmpty?: () => void) {
    this.id = id;
    this.onEmptyCallback = onEmpty;
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    const board = await getBoard(this.id);
    if (!board) throw new Error(`Board ${this.id} does not exist`);

    const snapshot = await loadLatestSnapshot(this.id);
    let currentState: BoardState = snapshot ? snapshot.state : { objects: {}, order: [] };
    const startSeq = snapshot ? snapshot.seq : 0;

    const opsAfter = await loadOpsAfter(this.id, startSeq);
    for (const commOp of opsAfter) {
      try {
        currentState = applyOp(currentState, commOp.op);
      } catch (err) {
        console.error(`Data corruption in board ${this.id} replay at seq ${commOp.seq}:`, err);
        throw err;
      }
    }

    this.state = currentState;
    this.seq = Number(board.current_seq);

    // Populate ring buffer with recent ops
    this.ring.length = 0;
    const recentOps = opsAfter.slice(-config.RING_BUFFER_SIZE);
    this.ring.push(...recentOps);

    this.isLoaded = true;
  }

  async reload(): Promise<void> {
    this.isLoaded = false;
    await this.load();
  }

  getPresenceUsers(): PresenceUser[] {
    const seen = new Set<string>();
    const users: PresenceUser[] = [];
    for (const c of this.connections) {
      if (!seen.has(c.clientId)) {
        seen.add(c.clientId);
        users.push({
          clientId: c.clientId,
          name: c.displayName,
          color: c.color,
        });
      }
    }
    return users;
  }

  broadcast(msg: ServerMsg, exceptConn?: Connection): void {
    const raw = JSON.stringify(msg);
    for (const conn of this.connections) {
      if (conn === exceptConn) continue;
      conn.sendRaw(raw);
    }
  }

  async join(conn: Connection, lastSeenSeq?: number): Promise<void> {
    return this.queue.run(async () => {
      if (this.connections.size >= config.MAX_CLIENTS_PER_ROOM) {
        conn.close(4010, 'Room full');
        return;
      }

      // Assign least-used color
      const usedColors = Array.from(this.connections).map((c) => c.color);
      conn.color = pickLeastUsedColor(usedColors);

      const you: You = {
        clientId: conn.clientId,
        color: conn.color,
      };

      // Determine catch-up message
      if (lastSeenSeq !== undefined && lastSeenSeq <= this.seq) {
        const neededCount = this.seq - lastSeenSeq;
        if (neededCount >= 0 && this.ring.length >= neededCount) {
          const opsRange = this.ring.filter((op) => op.seq > lastSeenSeq);
          if (opsRange.length === neededCount) {
            conn.send({ t: 'OPS', ops: opsRange, you });
            this.connections.add(conn);
            this.broadcast({ t: 'PRESENCE', users: this.getPresenceUsers() });
            return;
          }
        }
      }

      // Fallback: Send full snapshot
      const stripped = stripTombstones(this.state);
      conn.send({
        t: 'SNAPSHOT',
        seq: this.seq,
        state: stripped,
        you,
      });

      this.connections.add(conn);
      this.broadcast({ t: 'PRESENCE', users: this.getPresenceUsers() });
    });
  }

  handleSync(conn: Connection, lastSeenSeq: number): Promise<void> {
    return this.queue.run(async () => {
      const you: You = {
        clientId: conn.clientId,
        color: conn.color,
      };

      if (lastSeenSeq <= this.seq) {
        const neededCount = this.seq - lastSeenSeq;
        if (neededCount >= 0 && this.ring.length >= neededCount) {
          const opsRange = this.ring.filter((op) => op.seq > lastSeenSeq);
          if (opsRange.length === neededCount) {
            conn.send({ t: 'OPS', ops: opsRange, you });
            return;
          }
        }
      }

      // Fallback snapshot
      conn.send({
        t: 'SNAPSHOT',
        seq: this.seq,
        state: stripTombstones(this.state),
        you,
      });
    });
  }

  leave(conn: Connection): void {
    this.connections.delete(conn);
    this.broadcast({ t: 'PRESENCE', users: this.getPresenceUsers() });

    if (this.connections.size === 0 && this.onEmptyCallback) {
      this.onEmptyCallback();
    }
  }

  async handleOp(conn: Connection, clientOpId: string, op: Op): Promise<void> {
    return this.queue.run(async () => {
      // 1. Dedupe check
      const key = `${conn.clientId}:${clientOpId}`;
      const memorySeen = this.recent.get(key);
      const seenSeq = memorySeen ?? (await findOp(this.id, conn.clientId, clientOpId));

      if (seenSeq !== undefined) {
        conn.send({ t: 'ACK', clientOpId, seq: seenSeq });
        return;
      }

      // 2. Validate against current memory state
      let nextState: BoardState;
      try {
        nextState = applyOp(this.state, op);
      } catch (err) {
        if (err instanceof OpError) {
          conn.send({ t: 'NACK', clientOpId, reason: err.reason });
          return;
        }
        conn.send({ t: 'NACK', clientOpId, reason: 'INVALID' });
        return;
      }

      // 3. Atomic Database Transaction
      let committedSeq: number;
      try {
        committedSeq = await commitOp(
          this.id,
          this.seq + 1,
          conn.clientId,
          clientOpId,
          op,
        );
      } catch (err) {
        if (err instanceof SeqMismatch) {
          await this.reload();
          conn.send({ t: 'NACK', clientOpId, reason: 'RETRY' });
          return;
        }
        if (isUniqueViolation(err)) {
          const s = await findOp(this.id, conn.clientId, clientOpId);
          if (s !== undefined) {
            conn.send({ t: 'ACK', clientOpId, seq: s });
            return;
          }
        }
        console.error(`Internal DB commit error on board ${this.id}:`, err);
        conn.send({ t: 'NACK', clientOpId, reason: 'INTERNAL' });
        return;
      }

      // 4. Update memory state after commit succeeds
      this.state = nextState;
      this.seq = committedSeq;

      const committedOp: CommittedOp = {
        seq: committedSeq,
        clientId: conn.clientId,
        clientOpId,
        op,
      };

      this.ring.push(committedOp);
      if (this.ring.length > config.RING_BUFFER_SIZE) {
        this.ring.shift();
      }

      this.recent.set(key, committedSeq);
      if (this.recent.size > 5000) {
        const firstKey = this.recent.keys().next().value;
        if (firstKey) this.recent.delete(firstKey);
      }

      // 5. ACK sender and broadcast OP
      conn.send({ t: 'ACK', clientOpId, seq: committedSeq });
      this.broadcast({
        t: 'OP',
        seq: committedSeq,
        clientId: conn.clientId,
        clientOpId,
        op,
      });

      // 6. Snapshot if due
      if (committedSeq % config.SNAPSHOT_EVERY === 0) {
        this.takeSnapshot();
      }
    });
  }

  takeSnapshot(): void {
    // Copy inside queue
    const snapshotSeq = this.seq;
    const stripped = stripTombstones(this.state);
    this.state = stripped;

    // Persist asynchronously outside queue
    saveSnapshot(this.id, snapshotSeq, stripped)
      .then(() => pruneSnapshots(this.id))
      .catch((err) => {
        console.warn(`Snapshot save failed for board ${this.id} at seq ${snapshotSeq}:`, err);
      });
  }

  relayEphemeral(senderConn: Connection, msg: ServerMsg): void {
    const raw = JSON.stringify(msg);
    for (const conn of this.connections) {
      if (conn === senderConn) continue;
      // Skip if connection is lagging (backpressure)
      if (conn.getBufferedAmount() > 256 * 1024) continue;
      conn.sendRaw(raw);
    }
  }
}
