import {
  applyOp,
  stripTombstones,
  type BoardState,
  type CommittedOp,
  type Op,
  type ServerMsg,
} from '@whiteboard/shared';
import type { FaultChannel } from './FaultChannel.js';
import type { SimClient } from './SimClient.js';

export interface SimConnection {
  client: SimClient;
  channel: FaultChannel;
  color: string;
}

export class SimRoom {
  readonly id: string;
  state: BoardState = { objects: {}, order: [] };
  seq = 0;
  log: CommittedOp[] = [];
  recent = new Map<string, number>();
  connections = new Map<string, SimConnection>();
  snapshots: { seq: number; state: BoardState }[] = [];

  private queuePromise = Promise.resolve();

  constructor(id = crypto.randomUUID()) {
    this.id = id;
  }

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queuePromise.then(fn);
    this.queuePromise = next.then(() => {}, () => {});
    return next;
  }

  addClient(client: SimClient, channel: FaultChannel, color = '#0d99ff'): void {
    const conn: SimConnection = { client, channel, color };
    this.connections.set(client.clientId, conn);
    client.setChannel(channel);
  }

  removeClient(clientId: string): void {
    this.connections.delete(clientId);
  }

  broadcast(msg: ServerMsg, exceptClientId?: string): void {
    for (const [cId, conn] of this.connections) {
      if (cId === exceptClientId) continue;
      conn.channel.deliverToClient(msg);
    }
  }

  handleJoin(clientId: string, lastSeenSeq?: number): Promise<void> {
    return this.enqueue(async () => {
      const conn = this.connections.get(clientId);
      if (!conn) return;

      const you = { clientId, color: conn.color };

      // Catch-up via ops log if possible
      if (lastSeenSeq !== undefined && lastSeenSeq <= this.seq) {
        const ops = this.log.filter((o) => o.seq > lastSeenSeq);
        if (ops.length === this.seq - lastSeenSeq) {
          conn.channel.deliverToClient({ t: 'OPS', ops, you });
          return;
        }
      }

      // Snapshot fallback
      conn.channel.deliverToClient({
        t: 'SNAPSHOT',
        seq: this.seq,
        state: stripTombstones(this.state),
        you,
      });
    });
  }

  handleSync(clientId: string, lastSeenSeq: number): Promise<void> {
    return this.enqueue(async () => {
      const conn = this.connections.get(clientId);
      if (!conn) return;

      const you = { clientId, color: conn.color };
      const ops = this.log.filter((o) => o.seq > lastSeenSeq);

      if (ops.length === this.seq - lastSeenSeq) {
        conn.channel.deliverToClient({ t: 'OPS', ops, you });
      } else {
        conn.channel.deliverToClient({
          t: 'SNAPSHOT',
          seq: this.seq,
          state: stripTombstones(this.state),
          you,
        });
      }
    });
  }

  handleOp(clientId: string, clientOpId: string, op: Op): Promise<void> {
    return this.enqueue(async () => {
      const conn = this.connections.get(clientId);
      if (!conn) return;

      const key = `${clientId}:${clientOpId}`;
      const seenSeq = this.recent.get(key);
      if (seenSeq !== undefined) {
        conn.channel.deliverToClient({ t: 'ACK', clientOpId, seq: seenSeq });
        return;
      }

      let nextState: BoardState;
      try {
        nextState = applyOp(this.state, op);
      } catch {
        conn.channel.deliverToClient({ t: 'NACK', clientOpId, reason: 'INVALID' });
        return;
      }

      this.seq += 1;
      this.state = nextState;
      this.recent.set(key, this.seq);

      const committedOp: CommittedOp = {
        seq: this.seq,
        clientId,
        clientOpId,
        op,
      };
      this.log.push(committedOp);

      // ACK to sender
      conn.channel.deliverToClient({ t: 'ACK', clientOpId, seq: this.seq });

      // Broadcast OP to all clients in room
      this.broadcast({
        t: 'OP',
        seq: this.seq,
        clientId,
        clientOpId,
        op,
      });

      // Periodic snapshotting (every 25 ops)
      if (this.seq % 25 === 0) {
        this.takeSnapshot();
      }
    });
  }

  takeSnapshot(): void {
    const stripped = stripTombstones(this.state);
    this.snapshots.push({
      seq: this.seq,
      state: JSON.parse(JSON.stringify(stripped)),
    });
  }

  rebuildFromDb(): BoardState {
    const latestSnapshot =
      this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
    let rebuiltState: BoardState = latestSnapshot
      ? JSON.parse(JSON.stringify(latestSnapshot.state))
      : { objects: {}, order: [] };
    const startSeq = latestSnapshot ? latestSnapshot.seq : 0;
    const opsAfter = this.log.filter((o) => o.seq > startSeq);
    for (const commOp of opsAfter) {
      rebuiltState = applyOp(rebuiltState, commOp.op);
    }
    return rebuiltState;
  }

  restart(): Promise<void> {
    return this.enqueue(async () => {
      // 1. Rebuild server memory state from latest snapshot + log
      this.state = this.rebuildFromDb();
      // Re-populate recent deduplication map from committed log
      this.recent.clear();
      for (const commOp of this.log) {
        this.recent.set(`${commOp.clientId}:${commOp.clientOpId}`, commOp.seq);
      }
      // 2. Disconnect existing channels
      for (const conn of this.connections.values()) {
        conn.channel.close();
      }
      this.connections.clear();
    });
  }

  async drain(): Promise<void> {
    await this.queuePromise;
  }
}

