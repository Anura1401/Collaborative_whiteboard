import type { ClientMsg, ServerMsg } from '@whiteboard/shared';
import { getClientId, getDisplayName } from './identity.js';

export interface ConnectionHandler {
  onStatusChange: (status: 'CONNECTING' | 'SYNCING' | 'LIVE' | 'DISCONNECTED') => void;
  onMessage: (msg: ServerMsg) => void;
  getLastSeq: () => number;
  onLiveReady: () => void;
}

export class Connection {
  private boardId: string;
  private handler: ConnectionHandler;
  private socket: WebSocket | null = null;
  private isDestroyed = false;

  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private retryAttempt = 0;
  private isSyncing = false;

  constructor(boardId: string, handler: ConnectionHandler) {
    this.boardId = boardId;
    this.handler = handler;
  }

  public connect(): void {
    if (this.isDestroyed) return;
    this.cleanupSocket();

    this.handler.onStatusChange('CONNECTING');

    this.fetchTicketAndConnect().catch((err) => {
      console.warn('Connection attempt failed:', err);
      this.handler.onStatusChange('DISCONNECTED');
      this.scheduleReconnect();
    });
  }

  private async fetchTicketAndConnect(): Promise<void> {
    const clientId = getClientId();
    const displayName = getDisplayName();

    const apiUrl = import.meta.env.VITE_API_URL || '';
    const res = await fetch(`${apiUrl}/api/boards/${this.boardId}/ws-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, displayName }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        this.handler.onStatusChange('DISCONNECTED');
        throw new Error('Board not found');
      }
      throw new Error(`Failed to fetch ticket: HTTP ${res.status}`);
    }

    const { ticket } = (await res.json()) as { ticket: string };

    let wsBaseUrl = import.meta.env.VITE_WS_URL;
    if (!wsBaseUrl) {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' ? `${loc.hostname}:8080` : loc.host;
      wsBaseUrl = `${protocol}//${host}`;
    }

    const wsUrl = `${wsBaseUrl}/ws?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(wsUrl);
    this.socket = ws;

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retryAttempt = 0;
      this.isSyncing = true;
      this.handler.onStatusChange('SYNCING');

      // Send JOIN as first message
      const lastSeq = this.handler.getLastSeq();
      const joinMsg: ClientMsg = {
        t: 'JOIN',
        lastSeenSeq: lastSeq > 0 ? lastSeq : undefined,
      };
      this.send(joinMsg);

      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      try {
        const msg = JSON.parse(event.data) as ServerMsg;

        if (msg.t === 'PONG') {
          if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
          }
          return;
        }

        if (this.isSyncing && (msg.t === 'SNAPSHOT' || msg.t === 'OPS')) {
          this.isSyncing = false;
          this.handler.onStatusChange('LIVE');
          this.handler.onMessage(msg);
          this.handler.onLiveReady();
          return;
        }

        this.handler.onMessage(msg);
      } catch (err) {
        console.error('Error handling server message:', err);
      }
    };

    ws.onclose = (event) => {
      if (this.socket !== ws) return;
      this.cleanupSocket();
      this.handler.onStatusChange('DISCONNECTED');

      // Handle close codes per spec (Section 22)
      if (event.code === 4003 || event.code === 4008 || event.code === 4009) {
        console.error(`Fatal connection error (code ${event.code}): ${event.reason}`);
        return; // Do not auto-reconnect
      }

      if (event.code === 4010) {
        // Room full: Retry slowly
        this.scheduleReconnect(10000);
        return;
      }

      if (event.code === 1012) {
        // Server restart: Reconnect immediately with jitter
        this.scheduleReconnect(100 + Math.random() * 400);
        return;
      }

      // Normal reconnect with backoff & jitter
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // ws.onclose will fire after onerror
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ t: 'PING' });
        this.pongTimeout = setTimeout(() => {
          console.warn('Heartbeat PONG timed out, reconnecting...');
          if (this.socket) {
            this.socket.close();
          }
        }, 10000);
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    let delay = delayMs;
    if (delay === undefined) {
      // Exponential backoff: 0.5s up to 15s with jitter
      const baseDelay = Math.min(15000, 500 * Math.pow(1.5, this.retryAttempt));
      const jitter = Math.random() * 500;
      delay = baseDelay + jitter;
      this.retryAttempt++;
    }

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public send(msg: ClientMsg): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.cleanupSocket();
  }
}
