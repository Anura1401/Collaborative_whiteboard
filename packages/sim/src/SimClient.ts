import {
  BoardStore,
  type BoardState,
  type ClientMsg,
  type Envelope,
  type HistoryEntry,
  type Op,
  type ServerMsg,
} from '@whiteboard/shared';

export interface ISimChannel {
  send(msg: ClientMsg): void;
  close?(): void;
}

export class SimClient {
  readonly clientId: string;
  readonly name: string;
  readonly store: BoardStore;

  isLive = false;
  channel: ISimChannel | null = null;
  receivedOpsCount = 0;
  nackCount = 0;
  syncRequestsCount = 0;
  ackedOpIds = new Set<string>();

  constructor(clientId: string, name = 'SimUser') {
    this.clientId = clientId;
    this.name = name;
    this.store = new BoardStore(clientId);
    this.store.setConnection({
      send: (msg: ClientMsg) => {
        if (this.channel && this.isLive) {
          this.channel.send(msg);
        }
      },
    });
  }

  get confirmed(): BoardState {
    return this.store.confirmed;
  }

  get lastSeq(): number {
    return this.store.lastSeq;
  }

  get pending(): Envelope[] {
    return this.store.pending;
  }

  get view(): BoardState {
    return this.store.view;
  }

  get undoStack(): HistoryEntry[] {
    return this.store.undoStack;
  }

  get redoStack(): HistoryEntry[] {
    return this.store.redoStack;
  }

  setChannel(channel: ISimChannel): void {
    this.channel = channel;
  }

  disconnect(): void {
    this.isLive = false;
    this.store.setStatus('DISCONNECTED');
    if (this.channel && this.channel.close) {
      this.channel.close();
    }
    this.channel = null;
  }

  join(): void {
    this.store.setStatus('SYNCING');
    if (this.channel) {
      this.channel.send({
        t: 'JOIN',
        lastSeenSeq: this.store.lastSeq > 0 ? this.store.lastSeq : undefined,
      });
    }
  }

  submit(op: Op, recordHistory = true): string {
    return this.store.submit(op, recordHistory);
  }

  duplicateSend(clientOpId?: string): void {
    if (!this.channel || !this.isLive) return;
    const target = clientOpId
      ? this.store.pending.find((p) => p.clientOpId === clientOpId)
      : this.store.pending[this.store.pending.length - 1];
    if (target) {
      this.channel.send({
        t: 'OP',
        clientOpId: target.clientOpId,
        op: target.op,
      });
    }
  }

  canUndo(): boolean {
    return this.store.canUndo();
  }

  canRedo(): boolean {
    return this.store.canRedo();
  }

  undo(): string | null {
    return this.store.undo();
  }

  redo(): string | null {
    return this.store.redo();
  }

  handleMessage(msg: ServerMsg): void {
    if (msg.t === 'OP') {
      this.receivedOpsCount++;
      if (msg.seq !== this.store.lastSeq + 1 && msg.seq > this.store.lastSeq) {
        this.syncRequestsCount++;
      }
      if (msg.clientId === this.clientId) {
        this.ackedOpIds.add(msg.clientOpId);
      }
    } else if (msg.t === 'ACK') {
      this.ackedOpIds.add(msg.clientOpId);
    } else if (msg.t === 'NACK') {
      this.nackCount++;
    }

    // Delegate message handling entirely to the real BoardStore
    this.store.handleServerMessage(msg);

    // If snapshot or ops arrived, transition to LIVE and trigger onLiveReady to resend pending
    if (msg.t === 'SNAPSHOT' || msg.t === 'OPS') {
      this.isLive = true;
      this.store.setStatus('LIVE');
      this.store.onLiveReady();
    }
  }

  hasPending(): boolean {
    return this.store.pending.length > 0;
  }

  flushPending(): void {
    this.store.onLiveReady();
  }
}
