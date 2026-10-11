import { FaultChannel, type ChaosConfig, DEFAULT_CHAOS } from './FaultChannel.js';
import { PRNG } from './prng.js';
import { SimClient } from './SimClient.js';
import { SimRoom } from './SimRoom.js';
import { generateRandomOp } from './opGenerator.js';
import {
  assertContiguousSequences,
  assertStateConvergence,
  assertStructuralInvariants,
  assertRebuiltStateEqualsConfirmed,
  assertAckedOpsInLog,
  assertNoPendingOps,
  assertUniqueClientOpIds,
} from './invariants.js';

export interface SimOptions {
  seed?: number;
  clientCount?: number;
  totalOps?: number;
  chaos?: ChaosConfig;
  verbose?: boolean;
}

export interface SimReport {
  seed: number;
  clientCount: number;
  totalOps: number;
  finalSeq: number;
  durationMs: number;
  finalObjectsCount: number;
  success: boolean;
  error?: string;
  stack?: string;
}

export async function runSimulation(options: SimOptions = {}): Promise<SimReport> {
  const seed = options.seed ?? 1337;
  const clientCount = options.clientCount ?? 5;
  const totalOps = options.totalOps ?? 100;
  const chaos = options.chaos ?? DEFAULT_CHAOS;
  const verbose = options.verbose ?? false;

  const startTime = Date.now();
  const prng = new PRNG(seed);
  const room = new SimRoom();

  const clients: SimClient[] = [];
  const channels: FaultChannel[] = [];

  function attachClientChannel(client: SimClient): FaultChannel {
    const channel = new FaultChannel(
      chaos,
      prng,
      (clientMsg) => {
        if (clientMsg.t === 'JOIN') {
          room.handleJoin(client.clientId, clientMsg.lastSeenSeq).catch(console.error);
        } else if (clientMsg.t === 'SYNC') {
          room.handleSync(client.clientId, clientMsg.lastSeenSeq).catch(console.error);
        } else if (clientMsg.t === 'OP') {
          room.handleOp(client.clientId, clientMsg.clientOpId, clientMsg.op).catch(console.error);
        }
      },
      (serverMsg) => {
        client.handleMessage(serverMsg);
      },
      () => {
        // Connection lost due to dropped message: reconnect and resend
        client.disconnect();
        room.removeClient(client.clientId);
        attachClientChannel(client);
        client.join();
      },
    );

    room.addClient(client, channel);
    channels.push(channel);
    return channel;
  }

  if (verbose) {
    console.log(`Starting Whiteboard Simulation [Seed: ${seed}, Clients: ${clientCount}, Ops: ${totalOps}]`);
  }

  // 1. Initialize and connect clients
  for (let i = 0; i < clientCount; i++) {
    const clientId = prng.uuid();
    const client = new SimClient(clientId, `User-${i + 1}`);
    attachClientChannel(client);
    clients.push(client);
    client.join();
  }

  // Allow initial joins to settle
  await new Promise((resolve) => setTimeout(resolve, 15));

  const restartMidPoint = Math.floor(totalOps / 2);
  let hasRestarted = false;

  // 2. Concurrently generate and submit operations
  for (let step = 0; step < totalOps; step++) {
    // 2a. Server restart mid-run simulation
    if (!hasRestarted && step === restartMidPoint) {
      hasRestarted = true;
      await room.drain();
      await room.restart();

      // Reconnect all clients after restart
      for (const client of clients) {
        attachClientChannel(client);
        client.join();
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const client = prng.pick(clients);

    // 2b. Disconnect and reconnect with pending operations
    if (client.channel && prng.next() < 0.08) {
      // Disconnect client
      client.disconnect();
      room.removeClient(client.clientId);

      // Generate 1-2 operations while offline/disconnected
      const offlineOpsCount = prng.nextInt(1, 2);
      for (let o = 0; o < offlineOpsCount; o++) {
        const op = generateRandomOp(client.view, prng);
        client.submit(op);
      }

      // Reconnect client
      attachClientChannel(client);
      client.join();
    } else {
      // Normal operation generation or undo/redo
      const actionRoll = prng.next();

      if (actionRoll < 0.12 && client.canUndo()) {
        // 2c. Undo action
        const undoOpId = client.undo();
        // Duplicate send check on undo
        if (undoOpId && prng.next() < 0.15) {
          client.duplicateSend(undoOpId);
        }
      } else if (actionRoll < 0.20 && client.canRedo()) {
        // 2d. Redo action
        const redoOpId = client.redo();
        if (redoOpId && prng.next() < 0.15) {
          client.duplicateSend(redoOpId);
        }
      } else {
        // 2e. Standard random operation
        const op = generateRandomOp(client.view, prng);
        const opId = client.submit(op);

        // 2f. Duplicate send of the same operation
        if (prng.next() < 0.15) {
          client.duplicateSend(opId);
        }
      }
    }

    // Yield control for asynchronous processing
    if (step % 6 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  // 3. Quiescence phase: allow network channels and server queue to settle
  for (const ch of channels) {
    ch.disableFaults();
  }

  let attempts = 0;
  while (attempts < 100) {
    await room.drain();
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Ensure all disconnected clients are reconnected
    for (const client of clients) {
      if (!client.channel) {
        attachClientChannel(client);
        client.join();
      }
    }

    // Check if any client has pending messages in flight
    const hasInFlight = channels.some((c) => c.pendingCount() > 0);
    const allCaughtUp = clients.every((c) => c.lastSeq === room.seq && !c.hasPending());

    if (!hasInFlight && allCaughtUp) {
      break;
    }

    // If packet drops or reconnects occurred, request SYNC and flush pending ops
    for (const client of clients) {
      if (client.channel) {
        if (client.lastSeq < room.seq) {
          client.channel.send({ t: 'SYNC', lastSeenSeq: client.lastSeq });
        }
        if (client.hasPending()) {
          client.flushPending();
        }
      }
    }

    attempts++;
  }

  // 4. Assert All Invariants
  assertContiguousSequences(room.log);
  assertStructuralInvariants(room.state);
  assertStateConvergence(clients, room.state);
  assertRebuiltStateEqualsConfirmed(room.rebuildFromDb(), clients);
  assertAckedOpsInLog(clients, room.log);
  assertNoPendingOps(clients);
  assertUniqueClientOpIds(room.log);

  const durationMs = Date.now() - startTime;
  const liveCount = room.state.order.length;

  if (verbose) {
    console.log(`Simulation finished in ${durationMs}ms`);
    console.log(`Final Seq: ${room.seq}, Live Objects: ${liveCount}`);
    console.log('Invariant verification: 100% CONVERGENCE PASSED');
  }

  // Clean up channel timers
  for (const ch of channels) {
    ch.close();
  }

  return {
    seed,
    clientCount,
    totalOps,
    finalSeq: room.seq,
    durationMs,
    finalObjectsCount: liveCount,
    success: true,
  };
}
