import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Duplex } from 'stream';
import { config } from '../config.js';
import { getBoard } from '../db/boards.js';
import { RateLimiterTracker } from '../services/rateLimiter.js';
import { sanitizeDisplayName } from '../services/presence.js';
import { verifyAndConsumeTicket } from '../services/tickets.js';
import { roomManager } from '../rooms/RoomManager.js';
import type { Room } from '../rooms/Room.js';
import { handleClientMessage } from './protocol.js';
import type { ServerMsg } from '@whiteboard/shared';

export class Connection {
  readonly socket: WebSocket;
  readonly clientId: string;
  readonly displayName: string;
  readonly boardId: string;
  readonly room: Room;
  readonly rateTracker: RateLimiterTracker;

  color = '#0d99ff';
  alive = true;
  hasJoined = false;
  private joinTimeout: NodeJS.Timeout | null = null;

  constructor(
    socket: WebSocket,
    clientId: string,
    displayName: string,
    boardId: string,
    room: Room,
  ) {
    this.socket = socket;
    this.clientId = clientId;
    this.displayName = sanitizeDisplayName(displayName);
    this.boardId = boardId;
    this.room = room;
    this.rateTracker = new RateLimiterTracker(
      config.OP_RATE_PER_SEC,
      config.EPHEMERAL_RATE_PER_SEC,
    );

    // First message must be JOIN within 5 seconds
    this.joinTimeout = setTimeout(() => {
      if (!this.hasJoined) {
        this.close(4003, 'JOIN timeout');
      }
    }, 5000);
  }

  public markJoined(): void {
    this.hasJoined = true;
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
  }

  public send(msg: ServerMsg): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  public sendRaw(rawJson: string): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(rawJson);
    }
  }

  public getBufferedAmount(): number {
    return this.socket.bufferedAmount;
  }

  public close(code = 1000, reason = ''): void {
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
    }
    this.socket.close(code, reason);
  }
}

export function createWebSocketGateway(): {
  wss: WebSocketServer;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  closeAllSockets: (code?: number, reason?: string) => void;
} {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.WS_MAX_PAYLOAD_BYTES,
  });

  const activeConnections = new Set<Connection>();

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim().toLowerCase());

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const origin = req.headers.origin;
    const isDevLocalhost =
      process.env.NODE_ENV !== 'production' &&
      origin &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    if (
      origin &&
      !allowedOrigins.includes('*') &&
      !allowedOrigins.includes(origin.toLowerCase()) &&
      !isDevLocalhost
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const ticketParam = url.searchParams.get('ticket');
    if (!ticketParam) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const payload = verifyAndConsumeTicket(ticketParam);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const board = await getBoard(payload.b);
    if (!board) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    let room: Room;
    try {
      room = await roomManager.getOrLoad(payload.b);
    } catch (err) {
      console.error('Failed to load room:', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new Connection(ws, payload.c, payload.n, payload.b, room);
      activeConnections.add(conn);

      ws.on('message', (data: Buffer | string) => {
        handleClientMessage(conn, data);
      });

      ws.on('close', () => {
        activeConnections.delete(conn);
        room.leave(conn);
      });

      ws.on('error', (err) => {
        console.warn('Socket error:', err);
      });
    });
  }


  function closeAllSockets(code = 1012, reason = 'Server restarting'): void {
    for (const conn of activeConnections) {
      conn.close(code, reason);
    }
    activeConnections.clear();
  }

  return {
    wss,
    handleUpgrade,
    closeAllSockets,
  };
}
