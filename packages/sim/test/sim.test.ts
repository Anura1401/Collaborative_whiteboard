import { describe, it, expect } from 'vitest';
import {
  PRNG,
  SimClient,
  runSimulation,
  assertStructuralInvariants,
  assertContiguousSequences,
  InvariantError,
} from '../src/index.js';
import type { Obj } from '@whiteboard/shared';

describe('Milestone 6: Simulation & Invariant Harness (@whiteboard/sim)', () => {
  it('PRNG generates identical sequences given identical seeds', () => {
    const prngA = new PRNG(9999);
    const prngB = new PRNG(9999);

    const seqA = Array.from({ length: 20 }, () => prngA.next());
    const seqB = Array.from({ length: 20 }, () => prngB.next());

    expect(seqA).toEqual(seqB);
  });

  it('Structural invariants catch illegal states', () => {
    const validState = {
      objects: {
        'obj-1': {
          id: 'obj-1',
          type: 'rect' as const,
          deleted: false,
          props: { x: 0, y: 0, width: 50, height: 50 },
        },
      },
      order: ['obj-1'],
    };

    expect(() => assertStructuralInvariants(validState)).not.toThrow();

    // 1. Tombstone in live order should fail
    const tombstoneInOrder = {
      objects: {
        'obj-1': { ...validState.objects['obj-1']!, deleted: true },
      },
      order: ['obj-1'],
    };
    expect(() => assertStructuralInvariants(tombstoneInOrder)).toThrow(InvariantError);

    // 2. Missing object from objects map
    const missingObj = {
      objects: {},
      order: ['non-existent'],
    };
    expect(() => assertStructuralInvariants(missingObj)).toThrow(InvariantError);

    // 3. Duplicate ID in order
    const duplicateInOrder = {
      objects: validState.objects,
      order: ['obj-1', 'obj-1'],
    };
    expect(() => assertStructuralInvariants(duplicateInOrder)).toThrow(InvariantError);
  });

  it('Contiguous sequences check detects gaps', () => {
    expect(() => assertContiguousSequences([{ seq: 1 }, { seq: 2 }, { seq: 3 }])).not.toThrow();
    expect(() => assertContiguousSequences([{ seq: 1 }, { seq: 3 }])).toThrow(InvariantError);
  });

  it('SimClient maintains optimistic pending queue until server OP confirms', () => {
    const client = new SimClient('client-1', 'Alice');
    expect(client.lastSeq).toBe(0);
    expect(client.view.order).toHaveLength(0);

    const rectObj: Obj = {
      id: 'rect-1',
      type: 'rect',
      deleted: false,
      props: {
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        fill: 'none',
        stroke: '#000000',
        strokeWidth: 2,
      },
    };

    // Client creates optimistic draft
    const opId = client.submit({ type: 'CREATE_OBJECT', object: rectObj });
    expect(client.pending).toHaveLength(1);
    expect(client.view.order).toEqual(['rect-1']);
    expect(client.confirmed.order).toHaveLength(0);

    // Server commits and broadcasts OP
    client.handleMessage({
      t: 'OP',
      seq: 1,
      clientId: 'client-1',
      clientOpId: opId,
      op: { type: 'CREATE_OBJECT', object: rectObj },
    });

    // Pending should now be drained and confirmed updated
    expect(client.pending).toHaveLength(0);
    expect(client.lastSeq).toBe(1);
    expect(client.confirmed.order).toEqual(['rect-1']);
    expect(client.view.order).toEqual(['rect-1']);
  });

  it('Simulates multi-client concurrent editing with 100% state convergence', async () => {
    const report = await runSimulation({
      seed: 12345,
      clientCount: 4,
      totalOps: 60,
      chaos: {
        minLatencyMs: 1,
        maxLatencyMs: 5,
        packetDropRate: 0.0,
        reorderProbability: 0.02,
      },
    });

    expect(report.success).toBe(true);
    expect(report.finalSeq).toBeGreaterThan(0);
  });

  it('Simulates chaotic network with packet drops, reorders, and SYNC catch-up convergence', async () => {
    const report = await runSimulation({
      seed: 54321,
      clientCount: 4,
      totalOps: 50,
      chaos: {
        minLatencyMs: 1,
        maxLatencyMs: 6,
        packetDropRate: 0.02, // 2% packet drops
        reorderProbability: 0.04, // 4% reordering
      },
    });

    expect(report.success).toBe(true);
    expect(report.finalSeq).toBeGreaterThan(0);
  });
});
