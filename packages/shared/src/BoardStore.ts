import { applyOp, invert } from './applyOp.js';
import type {
  BoardState,
  ClientMsg,
  Envelope,
  HistoryEntry,
  NackReason,
  Obj,
  Op,
  PresenceUser,
  ServerMsg,
} from './types.js';

export type ToolType = 'select' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'hand';

export interface StyleState {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
}

export type ConnectionStatus = 'CONNECTING' | 'SYNCING' | 'LIVE' | 'DISCONNECTED';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

export interface IConnection {
  send(msg: ClientMsg): void;
}

export class BoardStore {
  confirmed: BoardState = { objects: {}, order: [] };
  lastSeq = 0;
  pending: Envelope[] = [];
  view: BoardState = { objects: {}, order: [] };

  status: ConnectionStatus = 'CONNECTING';
  myClientId: string;
  myColor = '#0d99ff';
  presenceUsers: PresenceUser[] = [];
  remoteCursors: Record<string, { x: number; y: number; lastSeen: number }> = {};
  remoteDragPreviews: Record<string, { clientId: string; changes: Record<string, unknown>; lastSeen: number }> = {};

  selectedId: string | null = null;
  hoveredId: string | null = null;
  activeTool: ToolType = 'select';
  isToolLocked = false;

  style: StyleState = {
    fill: 'none',
    stroke: '#1e1e1e',
    strokeWidth: 2,
    fontSize: 16,
  };

  draftObj: Obj | null = null;
  overrides: Record<string, Record<string, unknown>> = {};
  guides: SnapGuide[] = [];
  isResizing = false;

  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];

  toasts: ToastMessage[] = [];
  clipboard: Obj | null = null;

  private connection: IConnection | null = null;
  private activeSocketId: string | null = null;

  // Nudge debounce batching
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNudgeDelta = { dx: 0, dy: 0 };
  private nudgeInitialProps: Record<string, unknown> | null = null;

  dirty = true;
  private listeners = new Set<() => void>();

  constructor(clientId?: string) {
    this.myClientId = clientId ?? (typeof crypto !== 'undefined' ? crypto.randomUUID() : `client-${Math.random()}`);
    this.recomputeView();
  }

  setConnection(connection: IConnection | null): void {
    this.connection = connection;
  }

  setActiveSocketId(socketId: string | null): void {
    this.activeSocketId = socketId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    this.dirty = true;
    for (const listener of this.listeners) {
      listener();
    }
  }

  recomputeView(): void {
    let v = this.confirmed;
    for (const p of this.pending) {
      try {
        v = applyOp(v, p.op);
      } catch {
        // Skip pending operation that no longer applies cleanly without dropping it
      }
    }
    this.view = v;
    this.dirty = true;
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.notify();
  }

  onLiveReady(): void {
    // Resend all pending operations in order with same IDs
    if (this.connection && this.status === 'LIVE') {
      for (const env of this.pending) {
        this.connection.send({
          t: 'OP',
          clientOpId: env.clientOpId,
          op: env.op,
        });
      }
    }
  }

  submit(op: Op, recordHistory = true): string {
    const clientOpId = crypto.randomUUID();

    if (recordHistory) {
      const inv = invert(op, this.view);
      if (inv) {
        this.undoStack.push({ op: inv, sourceOpId: clientOpId });
        if (this.undoStack.length > 100) {
          this.undoStack.shift();
        }
        this.redoStack = [];
      }
    }

    const envelope: Envelope = {
      clientId: this.myClientId,
      clientOpId,
      op,
    };

    this.pending.push(envelope);
    this.recomputeView();
    this.notify();

    if (this.status === 'LIVE' && this.connection) {
      this.connection.send({
        t: 'OP',
        clientOpId,
        op,
      });
    }

    return clientOpId;
  }

  sendCursor(x: number, y: number): void {
    if (this.status === 'LIVE' && this.connection) {
      this.connection.send({
        t: 'CURSOR',
        x,
        y,
      });
    }
  }

  sendDragPreview(objectId: string, changes: Record<string, unknown> | null): void {
    if (this.status === 'LIVE' && this.connection) {
      this.connection.send({
        t: 'DRAG_PREVIEW',
        objectId,
        changes,
      });
    }
  }

  handleServerMessage(msg: ServerMsg, socketId?: string): void {
    // Guard: ignore messages from a socket that has been replaced by a newer one
    if (socketId !== undefined && this.activeSocketId !== null && socketId !== this.activeSocketId) {
      return;
    }

    switch (msg.t) {
      case 'SNAPSHOT': {
        // Guard: ignore SNAPSHOT with seq lower than lastSeq
        if (msg.seq < this.lastSeq) {
          return;
        }
        this.confirmed = msg.state;
        this.lastSeq = msg.seq;
        this.myColor = msg.you.color;
        this.recomputeView();
        this.notify();
        break;
      }

      case 'OPS': {
        // Guard: ignore OPS batch if all ops have seq lower than or equal to lastSeq
        this.myColor = msg.you.color;
        let appliedAny = false;
        for (const commOp of msg.ops) {
          if (commOp.seq <= this.lastSeq) continue;
          try {
            this.confirmed = applyOp(this.confirmed, commOp.op);
            this.lastSeq = commOp.seq;
            appliedAny = true;
          } catch {
            this.lastSeq = Math.max(this.lastSeq, commOp.seq);
          }
          if (commOp.clientId === this.myClientId) {
            this.pending = this.pending.filter((p) => p.clientOpId !== commOp.clientOpId);
          }
        }
        if (appliedAny) {
          this.recomputeView();
          this.notify();
        }
        break;
      }

      case 'OP': {
        if (msg.seq <= this.lastSeq) return; // Duplicate

        if (msg.seq !== this.lastSeq + 1) {
          // Gap detected: request SYNC
          if (this.connection) {
            this.connection.send({ t: 'SYNC', lastSeenSeq: this.lastSeq });
          }
          return;
        }

        try {
          this.confirmed = applyOp(this.confirmed, msg.op);
          this.lastSeq = msg.seq;
        } catch (err) {
          console.error('Error applying live op:', err);
          this.lastSeq = Math.max(this.lastSeq, msg.seq);
        }

        // If sent by this tab, remove from pending
        if (msg.clientId === this.myClientId) {
          this.pending = this.pending.filter((p) => p.clientOpId !== msg.clientOpId);
        }

        // Clear any remote drag preview for this object
        if ('objectId' in msg.op) {
          delete this.remoteDragPreviews[(msg.op as { objectId: string }).objectId];
        }

        this.recomputeView();
        this.notify();
        break;
      }

      case 'ACK': {
        // Prune pending only if confirmed at or below lastSeq
        if (msg.seq <= this.lastSeq) {
          this.pending = this.pending.filter((p) => p.clientOpId !== msg.clientOpId);
          this.recomputeView();
          this.notify();
        }
        break;
      }

      case 'NACK': {
        const rejectedEnv = this.pending.find((p) => p.clientOpId === msg.clientOpId);
        this.pending = this.pending.filter((p) => p.clientOpId !== msg.clientOpId);

        // Remove from history stacks
        this.undoStack = this.undoStack.filter((e) => e.sourceOpId !== msg.clientOpId);
        this.redoStack = this.redoStack.filter((e) => e.sourceOpId !== msg.clientOpId);

        this.recomputeView();

        // Show plain-language toast
        this.showNackToast(msg.reason);

        // For RETRY or INTERNAL, resend once automatically
        if ((msg.reason === 'RETRY' || msg.reason === 'INTERNAL') && rejectedEnv && this.connection) {
          this.connection.send({
            t: 'OP',
            clientOpId: rejectedEnv.clientOpId,
            op: rejectedEnv.op,
          });
        }

        this.notify();
        break;
      }

      case 'PRESENCE': {
        this.presenceUsers = msg.users;
        const currentClientIds = new Set(msg.users.map((u) => u.clientId));
        // Prune cursors and previews from departed clients
        for (const cId of Object.keys(this.remoteCursors)) {
          if (!currentClientIds.has(cId)) {
            delete this.remoteCursors[cId];
          }
        }
        for (const cId of Object.keys(this.remoteDragPreviews)) {
          if (!currentClientIds.has(cId)) {
            delete this.remoteDragPreviews[cId];
          }
        }
        this.notify();
        break;
      }

      case 'CURSOR': {
        this.remoteCursors[msg.clientId] = {
          x: msg.x,
          y: msg.y,
          lastSeen: Date.now(),
        };
        this.notify();
        break;
      }

      case 'DRAG_PREVIEW': {
        if (msg.changes === null) {
          delete this.remoteDragPreviews[msg.objectId];
        } else {
          this.remoteDragPreviews[msg.objectId] = {
            clientId: msg.clientId,
            changes: msg.changes,
            lastSeen: Date.now(),
          };
        }
        this.notify();
        break;
      }

      case 'ERROR': {
        this.addToast(`Server error [${msg.code}]: ${msg.message}`, 'error');
        break;
      }

      case 'PONG':
        break;
    }
  }

  private showNackToast(reason: NackReason): void {
    switch (reason) {
      case 'DUPLICATE_ID':
        this.addToast('An element with this ID already exists.', 'error');
        break;
      case 'RATE_LIMITED':
        this.addToast('Too many changes at once. Slowing down.', 'error');
        break;
      case 'LIMIT_EXCEEDED':
        this.addToast('Board object limit reached.', 'error');
        break;
      case 'CONFLICT':
        this.addToast('Change conflicted with another edit.', 'error');
        break;
      case 'NOT_FOUND':
        this.addToast('Object was deleted by another user.', 'error');
        break;
      case 'DELETED':
        this.addToast('Cannot modify a deleted object.', 'error');
        break;
      case 'INVALID':
        this.addToast('Invalid operation sent.', 'error');
        break;
      case 'RETRY':
      case 'INTERNAL':
        this.addToast('Server busy, retrying automatically...', 'info');
        break;
      case 'FORBIDDEN':
        this.addToast('Permission denied.', 'error');
        break;
    }
  }

  undo(): string | null {
    if (!this.canUndo()) return null;

    const entry = this.undoStack.pop();
    if (!entry) return null;

    const back = invert(entry.op, this.view);
    const clientOpId = this.submit(entry.op, false);

    if (back) {
      this.redoStack.push({ op: back, sourceOpId: entry.sourceOpId });
      if (this.redoStack.length > 100) {
        this.redoStack.shift();
      }
    }

    if ('objectId' in entry.op) {
      const id = (entry.op as { objectId: string }).objectId;
      this.selectedId = this.view.objects[id]?.deleted ? null : id;
    } else if (entry.op.type === 'RESTORE_OBJECT') {
      this.selectedId = entry.op.object.id;
    }
    this.notify();
    return clientOpId;
  }

  redo(): string | null {
    if (!this.canRedo()) return null;

    const entry = this.redoStack.pop();
    if (!entry) return null;

    const back = invert(entry.op, this.view);
    const clientOpId = this.submit(entry.op, false);

    if (back) {
      this.undoStack.push({ op: back, sourceOpId: entry.sourceOpId });
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
    }

    if ('objectId' in entry.op) {
      const id = (entry.op as { objectId: string }).objectId;
      this.selectedId = this.view.objects[id]?.deleted ? null : id;
    } else if (entry.op.type === 'RESTORE_OBJECT') {
      this.selectedId = entry.op.object.id;
    }
    this.notify();
    return clientOpId;
  }

  canUndo(): boolean {
    return (
      this.status === 'LIVE' &&
      !this.isResizing &&
      Object.keys(this.overrides).length === 0 &&
      this.undoStack.length > 0
    );
  }

  canRedo(): boolean {
    return (
      this.status === 'LIVE' &&
      !this.isResizing &&
      Object.keys(this.overrides).length === 0 &&
      this.redoStack.length > 0
    );
  }

  setActiveTool(tool: ToolType, lock = false): void {
    this.activeTool = tool;
    this.isToolLocked = lock;
    this.notify();
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.notify();
  }

  setHovered(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.notify();
  }

  setStyle(partial: Partial<StyleState>): void {
    this.style = { ...this.style, ...partial };
    if (this.selectedId) {
      const obj = this.view.objects[this.selectedId];
      if (obj && !obj.deleted) {
        const changes: Record<string, unknown> = {};
        if (partial.fill !== undefined && 'fill' in obj.props) changes['fill'] = partial.fill;
        if (partial.stroke !== undefined && 'stroke' in obj.props) changes['stroke'] = partial.stroke;
        if (partial.strokeWidth !== undefined && 'strokeWidth' in obj.props) changes['strokeWidth'] = partial.strokeWidth;
        if (partial.fontSize !== undefined && 'fontSize' in obj.props) changes['fontSize'] = partial.fontSize;
        if (partial.stroke !== undefined && obj.type === 'stroke') changes['color'] = partial.stroke;
        if (partial.stroke !== undefined && obj.type === 'text') changes['color'] = partial.stroke;

        if (Object.keys(changes).length > 0) {
          this.submit({
            type: 'SET_PROPS',
            objectId: this.selectedId,
            changes,
          });
        }
      }
    }
    this.notify();
  }

  setDraft(obj: Obj | null): void {
    this.draftObj = obj;
    this.dirty = true;
  }

  setOverrides(overrides: Record<string, Record<string, unknown>>): void {
    this.overrides = overrides;
    this.dirty = true;
  }

  setGuides(guides: SnapGuide[]): void {
    this.guides = guides;
    this.dirty = true;
  }

  setIsResizing(isResizing: boolean): void {
    this.isResizing = isResizing;
    this.dirty = true;
  }

  deleteSelection(): void {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.selectedId = null;
    this.submit({ type: 'DELETE_OBJECT', objectId: id });
  }

  duplicateSelection(): void {
    if (!this.selectedId) return;
    const obj = this.view.objects[this.selectedId];
    if (!obj || obj.deleted) return;

    const newId = crypto.randomUUID();
    const props = { ...obj.props };
    if ('x' in props && typeof props.x === 'number') props.x += 16;
    if ('y' in props && typeof props.y === 'number') props.y += 16;
    if ('x1' in props && typeof props.x1 === 'number') {
      props.x1 += 16;
      props.y1 = (props.y1 as number) + 16;
      props.x2 = (props.x2 as number) + 16;
      props.y2 = (props.y2 as number) + 16;
    }

    const newObj: Obj = {
      id: newId,
      type: obj.type,
      deleted: false,
      props,
    };

    this.submit({ type: 'CREATE_OBJECT', object: newObj });
    this.selectedId = newId;
    this.notify();
  }

  copySelection(): void {
    if (!this.selectedId) return;
    const obj = this.view.objects[this.selectedId];
    if (obj && !obj.deleted) {
      this.clipboard = JSON.parse(JSON.stringify(obj));
    }
  }

  paste(): void {
    if (!this.clipboard) return;
    const newId = crypto.randomUUID();
    const props = { ...this.clipboard.props };
    if ('x' in props && typeof props.x === 'number') props.x += 16;
    if ('y' in props && typeof props.y === 'number') props.y += 16;
    if ('x1' in props && typeof props.x1 === 'number') {
      props.x1 += 16;
      props.y1 = (props.y1 as number) + 16;
      props.x2 = (props.x2 as number) + 16;
      props.y2 = (props.y2 as number) + 16;
    }

    const newObj: Obj = {
      id: newId,
      type: this.clipboard.type,
      deleted: false,
      props,
    };

    this.submit({ type: 'CREATE_OBJECT', object: newObj });
    this.selectedId = newId;
    this.clipboard = newObj;
    this.notify();
  }

  nudge(dx: number, dy: number): void {
    if (!this.selectedId) return;
    const obj = this.view.objects[this.selectedId];
    if (!obj || obj.deleted) return;

    if (!this.nudgeInitialProps) {
      this.nudgeInitialProps = { ...obj.props };
    }

    this.pendingNudgeDelta.dx += dx;
    this.pendingNudgeDelta.dy += dy;

    const currentOverride: Record<string, unknown> = {};
    if ('x' in obj.props) {
      currentOverride.x = (Number(this.nudgeInitialProps.x) || 0) + this.pendingNudgeDelta.dx;
      currentOverride.y = (Number(this.nudgeInitialProps.y) || 0) + this.pendingNudgeDelta.dy;
    } else if ('x1' in obj.props) {
      currentOverride.x1 = (Number(this.nudgeInitialProps.x1) || 0) + this.pendingNudgeDelta.dx;
      currentOverride.y1 = (Number(this.nudgeInitialProps.y1) || 0) + this.pendingNudgeDelta.dy;
      currentOverride.x2 = (Number(this.nudgeInitialProps.x2) || 0) + this.pendingNudgeDelta.dx;
      currentOverride.y2 = (Number(this.nudgeInitialProps.y2) || 0) + this.pendingNudgeDelta.dy;
    }

    this.setOverrides({ [this.selectedId]: currentOverride });

    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.flushNudge();
    }, 300);
  }

  private flushNudge(): void {
    if (!this.selectedId || !this.nudgeInitialProps) return;
    const id = this.selectedId;
    const changes: Record<string, unknown> = {};

    if ('x' in this.nudgeInitialProps) {
      changes.x = (Number(this.nudgeInitialProps.x) || 0) + this.pendingNudgeDelta.dx;
      changes.y = (Number(this.nudgeInitialProps.y) || 0) + this.pendingNudgeDelta.dy;
    } else if ('x1' in this.nudgeInitialProps) {
      changes.x1 = (Number(this.nudgeInitialProps.x1) || 0) + this.pendingNudgeDelta.dx;
      changes.y1 = (Number(this.nudgeInitialProps.y1) || 0) + this.pendingNudgeDelta.dy;
      changes.x2 = (Number(this.nudgeInitialProps.x2) || 0) + this.pendingNudgeDelta.dx;
      changes.y2 = (Number(this.nudgeInitialProps.y2) || 0) + this.pendingNudgeDelta.dy;
    }

    this.setOverrides({});
    this.pendingNudgeDelta = { dx: 0, dy: 0 };
    this.nudgeInitialProps = null;

    if (Object.keys(changes).length > 0) {
      this.submit({
        type: 'SET_PROPS',
        objectId: id,
        changes,
      });
    }
  }

  reorderSelection(action: 'front' | 'back' | 'forward' | 'backward'): void {
    if (!this.selectedId) return;
    this.submit({
      type: 'REORDER',
      objectId: this.selectedId,
      action,
    });
  }

  addToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    const toast: ToastMessage = {
      id: crypto.randomUUID(),
      message,
      type,
    };
    this.toasts.push(toast);
    this.notify();

    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== toast.id);
      this.notify();
    }, 4000);
  }
}
