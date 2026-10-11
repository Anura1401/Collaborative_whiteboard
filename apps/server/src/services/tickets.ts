import crypto from 'crypto';
import { TICKET_TTL_SECONDS, type TicketPayload } from '@whiteboard/shared';
import { config } from '../config.js';

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
  return buf.toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf-8');
}

const usedJtis = new Map<string, number>(); // jti -> exp timestamp in ms

function cleanupExpiredJtis(): void {
  const now = Date.now();
  for (const [jti, expMs] of usedJtis.entries()) {
    if (expMs < now) {
      usedJtis.delete(jti);
    }
  }
}

// Periodically clean up used JTIs
setInterval(cleanupExpiredJtis, 60000).unref();

export function createTicket(
  boardId: string,
  clientId: string,
  displayName: string,
  secret = config.TICKET_SECRET,
): { ticket: string; expiresAt: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + TICKET_TTL_SECONDS;
  const jti = crypto.randomUUID();

  const payload: TicketPayload = {
    b: boardId,
    c: clientId,
    n: displayName,
    exp: expSec,
    jti,
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadStr);

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadB64);
  const sigB64 = base64UrlEncode(hmac.digest());

  return {
    ticket: `${payloadB64}.${sigB64}`,
    expiresAt: expSec * 1000,
  };
}

export function verifyAndConsumeTicket(
  ticketString: string,
  secret = config.TICKET_SECRET,
): TicketPayload | null {
  const parts = ticketString.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payloadB64, sigB64] = parts;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadB64);
  const expectedSigB64 = base64UrlEncode(hmac.digest());

  if (sigB64 !== expectedSigB64) return null;

  try {
    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson) as TicketPayload;

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) return null;

    // Single-use check
    if (usedJtis.has(payload.jti)) return null;

    // Consume ticket
    usedJtis.set(payload.jti, payload.exp * 1000);

    return payload;
  } catch {
    return null;
  }
}
