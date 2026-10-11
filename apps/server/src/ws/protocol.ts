import { ClientMsgSchema, type ClientMsg } from '@whiteboard/shared';
import type { Connection } from './gateway.js';

export function handleClientMessage(conn: Connection, rawData: Buffer | string): void {
  const messageStr = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(messageStr);
  } catch {
    conn.close(4003, 'Malformed JSON');
    return;
  }

  const parseResult = ClientMsgSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    conn.close(4003, 'Schema validation failure');
    return;
  }

  const msg: ClientMsg = parseResult.data;

  // First message must be JOIN or PING before JOIN
  if (!conn.hasJoined && msg.t !== 'JOIN' && msg.t !== 'PING') {
    conn.close(4003, 'First message must be JOIN');
    return;
  }

  switch (msg.t) {
    case 'JOIN': {
      conn.markJoined();
      conn.room.join(conn, msg.lastSeenSeq).catch((err) => {
        console.error('Join error:', err);
        conn.close(1011, 'Internal join error');
      });
      break;
    }

    case 'SYNC': {
      conn.room.handleSync(conn, msg.lastSeenSeq).catch((err) => {
        console.error('Sync error:', err);
      });
      break;
    }

    case 'OP': {
      if (!conn.rateTracker.opBucket.tryConsume()) {
        const isAbuse = conn.rateTracker.recordViolation();
        if (isAbuse) {
          conn.close(4008, 'Sustained rate limit abuse');
          return;
        }
        conn.send({ t: 'NACK', clientOpId: msg.clientOpId, reason: 'RATE_LIMITED' });
        return;
      }

      conn.room.handleOp(conn, msg.clientOpId, msg.op).catch((err) => {
        console.error('Op handling error:', err);
      });
      break;
    }

    case 'CURSOR': {
      if (!conn.rateTracker.ephemeralBucket.tryConsume()) {
        return; // Drop silently
      }
      conn.room.relayEphemeral(conn, {
        t: 'CURSOR',
        clientId: conn.clientId,
        x: msg.x,
        y: msg.y,
      });
      break;
    }

    case 'DRAG_PREVIEW': {
      if (!conn.rateTracker.ephemeralBucket.tryConsume()) {
        return; // Drop silently
      }
      conn.room.relayEphemeral(conn, {
        t: 'DRAG_PREVIEW',
        clientId: conn.clientId,
        objectId: msg.objectId,
        changes: msg.changes,
      });
      break;
    }

    case 'PING': {
      conn.send({ t: 'PONG' });
      break;
    }

    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
}
