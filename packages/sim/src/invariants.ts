import { stripTombstones, type BoardState } from '@whiteboard/shared';
import type { SimClient } from './SimClient.js';

export class InvariantError extends Error {
  constructor(message: string) {
    super(`[Invariant Violation] ${message}`);
    this.name = 'InvariantError';
  }
}

/**
 * Validates that all objects in the board state satisfy structural integrity invariants.
 */
export function assertStructuralInvariants(state: BoardState): void {
  const seenOrderIds = new Set<string>();

  for (const id of state.order) {
    if (seenOrderIds.has(id)) {
      throw new InvariantError(`Duplicate object ID in state.order: ${id}`);
    }
    seenOrderIds.add(id);

    const obj = state.objects[id];
    if (!obj) {
      throw new InvariantError(`ID ${id} in state.order does not exist in state.objects`);
    }

    if (obj.deleted) {
      throw new InvariantError(`Deleted object (tombstone) ${id} found in live state.order`);
    }

    if (obj.id !== id) {
      throw new InvariantError(`Object id property ${obj.id} mismatches key ${id}`);
    }
  }

  // All live objects in state.objects must be present in state.order
  for (const [id, obj] of Object.entries(state.objects)) {
    if (!obj.deleted && !seenOrderIds.has(id)) {
      throw new InvariantError(`Live object ${id} in state.objects is missing from state.order`);
    }
  }
}

/**
 * Validates that a list of committed operations has strictly contiguous sequences starting from startSeq.
 */
export function assertContiguousSequences(ops: { seq: number }[], startSeq = 1): void {
  let expectedSeq = startSeq;
  for (const op of ops) {
    if (op.seq !== expectedSeq) {
      throw new InvariantError(`Sequence gap detected: expected ${expectedSeq}, received ${op.seq}`);
    }
    expectedSeq++;
  }
}

/**
 * Validates that all simulated clients have converged to 100% identical final states.
 */
export function assertStateConvergence(clients: SimClient[], serverState?: BoardState): void {
  if (clients.length === 0) return;

  const first = clients[0]!;
  const referenceSeq = first.lastSeq;
  const strippedReference = stripTombstones(first.view);
  const referenceOrderJson = JSON.stringify(strippedReference.order);
  const referenceObjectsJson = JSON.stringify(strippedReference.objects);

  assertStructuralInvariants(first.view);

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i]!;

    if (client.hasPending()) {
      throw new InvariantError(
        `Client ${client.name} (${client.clientId}) still has ${client.pending.length} pending ops!`,
      );
    }

    if (client.lastSeq !== referenceSeq) {
      throw new InvariantError(
        `Client ${client.name} seq mismatch: client seq=${client.lastSeq}, reference seq=${referenceSeq}`,
      );
    }

    const strippedClient = stripTombstones(client.view);
    const clientOrderJson = JSON.stringify(strippedClient.order);
    if (clientOrderJson !== referenceOrderJson) {
      throw new InvariantError(
        `Client ${client.name} order mismatch against reference client ${first.name}`,
      );
    }

    const clientObjectsJson = JSON.stringify(strippedClient.objects);
    if (clientObjectsJson !== referenceObjectsJson) {
      throw new InvariantError(
        `Client ${client.name} objects mismatch against reference client ${first.name}`,
      );
    }
  }

  // If serverState is provided, compare against it
  if (serverState) {
    const strippedServer = stripTombstones(serverState);
    assertStructuralInvariants(strippedServer);
    const serverOrderJson = JSON.stringify(strippedServer.order);
    if (serverOrderJson !== referenceOrderJson) {
      throw new InvariantError('Clients converged order mismatches server state order');
    }
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], (b as unknown[])[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Validates that state rebuilt from the database (latest snapshot plus ops log)
 * strictly equals every client's confirmed state.
 */
export function assertRebuiltStateEqualsConfirmed(
  rebuiltState: BoardState,
  clients: SimClient[],
): void {
  const strippedRebuilt = stripTombstones(rebuiltState);
  assertStructuralInvariants(strippedRebuilt);

  for (const client of clients) {
    const strippedClient = stripTombstones(client.confirmed);
    if (!deepEqual(strippedClient, strippedRebuilt)) {
      throw new InvariantError(
        `Rebuilt database state mismatches confirmed state for client ${client.name}`,
      );
    }
  }
}

/**
 * Validates that every operation acknowledged to any client exists in the committed log.
 */
export function assertAckedOpsInLog(
  clients: SimClient[],
  log: { clientOpId: string; clientId: string }[],
): void {
  const logOpSet = new Set(log.map((entry) => `${entry.clientId}:${entry.clientOpId}`));

  for (const client of clients) {
    for (const ackedId of client.ackedOpIds) {
      const key = `${client.clientId}:${ackedId}`;
      if (!logOpSet.has(key)) {
        throw new InvariantError(
          `Client ${client.name} acknowledged operation ${ackedId} is missing from the committed log!`,
        );
      }
    }
  }
}

/**
 * Validates that no client has pending operations remaining after the simulation settles.
 */
export function assertNoPendingOps(clients: SimClient[]): void {
  for (const client of clients) {
    if (client.hasPending()) {
      throw new InvariantError(
        `Client ${client.name} has ${client.pending.length} uncommitted pending operations after settling!`,
      );
    }
  }
}

/**
 * Validates that each (client_id, client_op_id) appears at most once in the log.
 */
export function assertUniqueClientOpIds(
  log: { clientId: string; clientOpId: string }[],
): void {
  const seen = new Set<string>();
  for (const entry of log) {
    const key = `${entry.clientId}:${entry.clientOpId}`;
    if (seen.has(key)) {
      throw new InvariantError(
        `Duplicate (client_id, client_op_id) entry detected in log: ${key}`,
      );
    }
    seen.add(key);
  }
}

