import type { ClientMsg, ServerMsg } from '@whiteboard/shared';
import type { ISimChannel } from './SimClient.js';
import type { PRNG } from './prng.js';

export interface ChaosConfig {
  minLatencyMs: number;
  maxLatencyMs: number;
  packetDropRate: number; // 0 to 1
  delayedAckRate: number; // 0 to 1
}

export const DEFAULT_CHAOS: ChaosConfig = {
  minLatencyMs: 1,
  maxLatencyMs: 6,
  packetDropRate: 0.01,
  delayedAckRate: 0.25,
};

export class FaultChannel implements ISimChannel {
  private config: ChaosConfig;
  private prng: PRNG;
  private onServerReceive: (msg: ClientMsg) => void;
  private onClientReceive: (msg: ServerMsg) => void;
  private onConnectionDrop?: () => void;

  private activeTimers = new Set<NodeJS.Timeout>();
  private isClosed = false;

  // Monotonic scheduling to preserve strict TCP FIFO order on the open socket
  private nextClientDeliveryTime = 0;
  private nextServerDeliveryTime = 0;

  constructor(
    config: ChaosConfig,
    prng: PRNG,
    onServerReceive: (msg: ClientMsg) => void,
    onClientReceive: (msg: ServerMsg) => void,
    onConnectionDrop?: () => void,
  ) {
    this.config = config;
    this.prng = prng;
    this.onServerReceive = onServerReceive;
    this.onClientReceive = onClientReceive;
    this.onConnectionDrop = onConnectionDrop;
  }

  send(msg: ClientMsg): void {
    if (this.isClosed) return;

    // Rule: ACK, NACK, or OP must never be dropped on an open connection.
    // Any message loss of OP must close that client's connection and trigger reconnect/resend.
    if (this.config.packetDropRate > 0 && this.prng.next() < this.config.packetDropRate) {
      if (msg.t === 'OP') {
        this.close();
        if (this.onConnectionDrop) {
          this.onConnectionDrop();
        }
        return;
      }
      // Ephemeral messages (CURSOR, DRAG_PREVIEW) may be dropped without socket closure
      if (msg.t === 'CURSOR' || msg.t === 'DRAG_PREVIEW') {
        return;
      }
    }

    const latency = this.prng.nextInt(this.config.minLatencyMs, this.config.maxLatencyMs);
    const now = Date.now();
    const scheduledTime = Math.max(now, this.nextServerDeliveryTime) + latency;
    this.nextServerDeliveryTime = scheduledTime;
    const delay = Math.max(0, scheduledTime - now);

    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      if (!this.isClosed) {
        this.onServerReceive(msg);
      }
    }, delay);

    this.activeTimers.add(timer);
  }

  deliverToClient(msg: ServerMsg): void {
    if (this.isClosed) return;

    // Rule: ACK, NACK, or OP must never be dropped on an open connection.
    // Any message loss must close that client's connection and trigger a reconnect and resend.
    if (this.config.packetDropRate > 0 && this.prng.next() < this.config.packetDropRate) {
      if (msg.t === 'ACK' || msg.t === 'NACK' || msg.t === 'OP' || msg.t === 'SNAPSHOT' || msg.t === 'OPS') {
        this.close();
        if (this.onConnectionDrop) {
          this.onConnectionDrop();
        }
        return;
      }
      // Ephemeral messages (CURSOR, DRAG_PREVIEW) may be dropped without socket closure
      if (msg.t === 'CURSOR' || msg.t === 'DRAG_PREVIEW') {
        return;
      }
    }

    let latency = this.prng.nextInt(this.config.minLatencyMs, this.config.maxLatencyMs);
    // Delayed ACKs fault
    if (msg.t === 'ACK' && this.config.delayedAckRate > 0 && this.prng.next() < this.config.delayedAckRate) {
      latency += this.prng.nextInt(20, 80);
    }

    const now = Date.now();
    const scheduledTime = Math.max(now, this.nextClientDeliveryTime) + latency;
    this.nextClientDeliveryTime = scheduledTime;
    const delay = Math.max(0, scheduledTime - now);

    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      if (!this.isClosed) {
        this.onClientReceive(msg);
      }
    }, delay);

    this.activeTimers.add(timer);
  }

  close(): void {
    this.isClosed = true;
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }

  pendingCount(): number {
    return this.activeTimers.size;
  }

  disableFaults(): void {
    this.config = {
      minLatencyMs: 0,
      maxLatencyMs: 1,
      packetDropRate: 0,
      delayedAckRate: 0,
    };
  }
}
