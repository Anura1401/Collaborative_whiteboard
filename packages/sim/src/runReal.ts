import { WebSocket } from 'ws';
import {
  applyOp,
  stripTombstones,
  BoardStore,
  type BoardState,
  type ClientMsg,
  type ServerMsg,
  type Op,
} from '@whiteboard/shared';
import {
  buildApp,
  getPool,
  createTicket,
  roomManager,
} from '@whiteboard/server';
import { PRNG } from './prng.js';
import { generateRandomOp } from './opGenerator.js';

function deepEqual(a: unknown, b: unknown): boolean {
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

interface RealSimClient {
  clientId: string;
  name: string;
  store: BoardStore;
  ws: WebSocket | null;
  ackedOpIds: Set<string>;
  activeSocketId: string | null;
  connect(port: number, boardId: string): Promise<void>;
  disconnect(): void;
}

export interface RealSimOptions {
  seed: number;
  clientCount?: number;
  totalOps?: number;
  verbose?: boolean;
}

export interface RealSimReport {
  seed: number;
  clientCount: number;
  totalOps: number;
  finalSeq: number;
  durationMs: number;
  success: boolean;
  error?: string;
  stack?: string;
}

function createRealClient(clientId: string, name: string): RealSimClient {
  const store = new BoardStore(clientId);
  const ackedOpIds = new Set<string>();

  const client: RealSimClient = {
    clientId,
    name,
    store,
    ws: null,
    ackedOpIds,
    activeSocketId: null,

    async connect(port: number, boardId: string): Promise<void> {
      client.disconnect();

      const socketId = crypto.randomUUID();
      client.activeSocketId = socketId;
      store.setActiveSocketId(socketId);
      store.setStatus('CONNECTING');

      const { ticket } = createTicket(boardId, clientId, name);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
      client.ws = ws;

      store.setConnection({
        send: (msg: ClientMsg) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        },
      });

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`WebSocket connection timeout for ${name}`));
        }, 8000);

        ws.on('open', () => {
          store.setStatus('SYNCING');
          ws.send(JSON.stringify({ t: 'JOIN', lastSeenSeq: store.lastSeq > 0 ? store.lastSeq : undefined }));
        });

        ws.on('message', (raw: Buffer | string) => {
          try {
            const msg = JSON.parse(raw.toString('utf-8')) as ServerMsg;

            if (msg.t === 'OP' && msg.clientId === clientId) {
              ackedOpIds.add(msg.clientOpId);
            } else if (msg.t === 'ACK') {
              ackedOpIds.add(msg.clientOpId);
            }

            store.handleServerMessage(msg, socketId);

            if (msg.t === 'SNAPSHOT' || msg.t === 'OPS') {
              clearTimeout(timeout);
              store.setStatus('LIVE');
              store.onLiveReady();
              resolve();
            }
          } catch (err) {
            console.error(`Error processing message in ${name}:`, err);
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on('close', () => {
          store.setStatus('DISCONNECTED');
        });
      });
    },

    disconnect(): void {
      if (client.ws) {
        try {
          client.ws.terminate();
        } catch {
          // Ignore
        }
        client.ws = null;
      }
      store.setStatus('DISCONNECTED');
    },
  };

  return client;
}

export async function runRealSimulation(options: RealSimOptions): Promise<RealSimReport> {
  const seed = options.seed;
  const clientCount = options.clientCount ?? (((seed * 7) % 18) + 3);
  const totalOps = options.totalOps ?? 300;
  const verbose = options.verbose ?? false;

  const startTime = Date.now();
  const prng = new PRNG(seed);
  const pool = getPool();

  // 1. Create a unique test board in Postgres
  const boardId = crypto.randomUUID();
  const boardName = `Real Sim Board ${boardId.slice(0, 8)}`;
  await pool.query(`INSERT INTO boards (id, name, current_seq) VALUES ($1, $2, 0)`, [boardId, boardName]);

  // 2. Start Fastify & WebSocket server on ephemeral port
  let appBundle = await buildApp();
  let address = await appBundle.fastify.listen({ port: 0, host: '127.0.0.1' });
  let serverPort = Number(new URL(address).port);

  const clients: RealSimClient[] = [];

  try {
    if (verbose) {
      console.log(`[sim:real] Starting Seed ${seed} (Clients: ${clientCount}, Ops: ${totalOps}, Port: ${serverPort})`);
    }

    // 3. Connect real WebSocket clients
    for (let i = 0; i < clientCount; i++) {
      const clientId = prng.uuid();
      const client = createRealClient(clientId, `User-${i + 1}`);
      clients.push(client);
      await client.connect(serverPort, boardId);
    }

    const restartMidPoint = Math.floor(totalOps / 2);
    let hasRestarted = false;

    // 4. Workload loop
    for (let step = 0; step < totalOps; step++) {
      // 4a. Server restart mid-run
      if (!hasRestarted && step === restartMidPoint) {
        hasRestarted = true;
        if (verbose) console.log(`[sim:real] Simulating mid-run server restart at step ${step}...`);

        appBundle.wsGateway.closeAllSockets(1012, 'Server restarting');
        await roomManager.closeAll();
        await appBundle.fastify.close();

        // Recreate server
        appBundle = await buildApp();
        address = await appBundle.fastify.listen({ port: 0, host: '127.0.0.1' });
        serverPort = Number(new URL(address).port);

        // Reconnect all clients to new server
        for (const client of clients) {
          await client.connect(serverPort, boardId);
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      const client = prng.pick(clients);

      // 4b. Fault: Disconnect and reconnect with pending operations
      if (prng.next() < 0.08) {
        // Submit an operation right before disconnect so it is pending
        const op = generateRandomOp(client.store.view, prng);
        client.store.submit(op);

        // Terminate socket abruptly
        client.disconnect();

        // Generate another operation while disconnected/reconnecting
        const offlineOp = generateRandomOp(client.store.view, prng);
        client.store.submit(offlineOp);

        // Reconnect with pending operations
        await client.connect(serverPort, boardId);
      } else {
        const actionRoll = prng.next();

        if (actionRoll < 0.12 && client.store.canUndo()) {
          // Undo action
          const undoOpId = client.store.undo();
          // Fault: duplicate send
          if (undoOpId && prng.next() < 0.15 && client.ws && client.ws.readyState === WebSocket.OPEN) {
            const pendingEnv = client.store.pending.find((p) => p.clientOpId === undoOpId);
            if (pendingEnv) {
              client.ws.send(JSON.stringify({ t: 'OP', clientOpId: undoOpId, op: pendingEnv.op }));
            }
          }
        } else if (actionRoll < 0.20 && client.store.canRedo()) {
          // Redo action
          const redoOpId = client.store.redo();
          // Fault: duplicate send
          if (redoOpId && prng.next() < 0.15 && client.ws && client.ws.readyState === WebSocket.OPEN) {
            const pendingEnv = client.store.pending.find((p) => p.clientOpId === redoOpId);
            if (pendingEnv) {
              client.ws.send(JSON.stringify({ t: 'OP', clientOpId: redoOpId, op: pendingEnv.op }));
            }
          }
        } else {
          // Create / SET_PROPS / DELETE_OBJECT random operation
          const op = generateRandomOp(client.store.view, prng);

          // Fault: delayed message
          if (prng.next() < 0.15) {
            setTimeout(() => {
              client.store.submit(op);
            }, prng.nextInt(10, 40));
          } else {
            const opId = client.store.submit(op);

            // Fault: duplicate send
            if (prng.next() < 0.15 && client.ws && client.ws.readyState === WebSocket.OPEN) {
              const pendingEnv = client.store.pending.find((p) => p.clientOpId === opId);
              if (pendingEnv) {
                client.ws.send(JSON.stringify({ t: 'OP', clientOpId: opId, op: pendingEnv.op }));
              }
            }
          }
        }
      }

      // Yield control for asynchronous processing
      if (step % 5 === 0) {
        await new Promise((r) => setTimeout(r, 4));
      }
    }

    // 5. Quiescence phase: wait for all messages and queues to settle
    let attempts = 0;
    while (attempts < 80) {
      // Reconnect any disconnected clients
      for (const client of clients) {
        if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
          await client.connect(serverPort, boardId);
        }
      }

      await new Promise((r) => setTimeout(r, 40));

      // Check if all clients have 0 pending and matched lastSeq
      const allEmptyPending = clients.every((c) => c.store.pending.length === 0);
      const firstSeq = clients[0]?.store.lastSeq ?? 0;
      const allSeqsMatch = clients.every((c) => c.store.lastSeq === firstSeq);

      if (allEmptyPending && allSeqsMatch && firstSeq > 0) {
        break;
      }

      // Resend any stranded pending operations
      for (const client of clients) {
        if (client.store.pending.length > 0) {
          client.store.onLiveReady();
        }
      }

      attempts++;
    }

    // 6. Assert Invariants Against PostgreSQL
    // 6a. Rebuild state from Postgres: latest snapshot + log
    const snapRes = await pool.query(
      `SELECT seq, state FROM snapshots WHERE board_id = $1 ORDER BY seq DESC LIMIT 1`,
      [boardId],
    );

    let rebuiltState: BoardState = { objects: {}, order: [] };
    let startSeq = 0;
    if (snapRes.rows.length > 0) {
      startSeq = Number(snapRes.rows[0].seq);
      rebuiltState = snapRes.rows[0].state as BoardState;
    }

    const opsRes = await pool.query(
      `SELECT seq, client_id, client_op_id, op FROM operations WHERE board_id = $1 AND seq > $2 ORDER BY seq ASC`,
      [boardId, startSeq],
    );

    for (const row of opsRes.rows) {
      rebuiltState = applyOp(rebuiltState, row.op as Op);
    }

    const strippedRebuilt = stripTombstones(rebuiltState);

    // 6b. Verify every client's confirmed state matches Postgres rebuilt state (ignoring tombstones)
    for (const client of clients) {
      const strippedClient = stripTombstones(client.store.confirmed);
      if (!deepEqual(strippedClient, strippedRebuilt)) {
        throw new Error(
          `Client ${client.name} confirmed state diverged from Postgres rebuilt state! ` +
            `Client objects: ${Object.keys(strippedClient.objects).length}, DB objects: ${Object.keys(strippedRebuilt.objects).length}`,
        );
      }
    }

    // 6c. Verify contiguous sequences 1..N with no gaps in operations table
    const allOpsRes = await pool.query(
      `SELECT seq, client_id, client_op_id FROM operations WHERE board_id = $1 ORDER BY seq ASC`,
      [boardId],
    );
    const opRows = allOpsRes.rows;
    for (let idx = 0; idx < opRows.length; idx++) {
      const expectedSeq = idx + 1;
      const actualSeq = Number(opRows[idx].seq);
      if (actualSeq !== expectedSeq) {
        throw new Error(`Sequence gap in Postgres operations table: expected ${expectedSeq}, got ${actualSeq}`);
      }
    }

    // 6d. Verify each (client_id, client_op_id) appears at most once in operations table
    const seenKeys = new Set<string>();
    for (const row of opRows) {
      const key = `${row.client_id}:${row.client_op_id}`;
      if (seenKeys.has(key)) {
        throw new Error(`Duplicate (client_id, client_op_id) committed in Postgres: ${key}`);
      }
      seenKeys.add(key);
    }

    // 6e. Verify no client has pending operations after settling
    for (const client of clients) {
      if (client.store.pending.length > 0) {
        throw new Error(`Client ${client.name} has ${client.store.pending.length} pending operations after quiescence!`);
      }
    }

    // 6f. Verify every acknowledged operation is in the Postgres operations table
    const dbOpIds = new Set(opRows.map((r) => r.client_op_id));
    for (const client of clients) {
      for (const opId of client.ackedOpIds) {
        if (!dbOpIds.has(opId)) {
          throw new Error(`Client ${client.name} acked operation ${opId} not found in Postgres log!`);
        }
      }
    }

    return {
      seed,
      clientCount,
      totalOps,
      finalSeq: opRows.length,
      durationMs: Date.now() - startTime,
      success: true,
    };
  } finally {
    // Cleanup clients, server, and test board
    for (const client of clients) {
      client.disconnect();
    }
    try {
      appBundle.wsGateway.closeAllSockets();
      await roomManager.closeAll();
      await appBundle.fastify.close();
    } catch {
      // Ignore
    }
    try {
      await pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
    } catch {
      // Ignore
    }
  }
}

// CLI entry point for pnpm sim:real
if (process.argv[1] && process.argv[1].endsWith('runReal.js')) {
  (async () => {
    console.log('================================================================');
    console.log('STARTING REAL POSTGRES + REAL WEBSOCKET + REAL BOARDSTORE SIM');
    console.log('Workload: >=300 ops, Faults: Reconnect, Dups, Delays, Restart');
    console.log('================================================================');

    const totalRuns = 200;
    let passedCount = 0;
    const failures: { seed: number; error: string; stack?: string }[] = [];
    const suiteStartTime = Date.now();

    for (let s = 1; s <= totalRuns; s++) {
      const runStart = Date.now();
      try {
        const report = await runRealSimulation({ seed: s, totalOps: 300 });
        passedCount++;
        const elapsedMs = Date.now() - runStart;
        if (s % 10 === 0 || s === 1 || s === totalRuns) {
          console.log(`[Seed ${s.toString().padStart(3, ' ')}/200] PASSED (${elapsedMs}ms, seq: ${report.finalSeq}, clients: ${report.clientCount})`);
        }
      } catch (err) {
        const elapsedMs = Date.now() - runStart;
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        failures.push({ seed: s, error: msg, stack });
        console.error(`[Seed ${s.toString().padStart(3, ' ')}/200] FAILED (${elapsedMs}ms): ${msg}`);
      }
    }

    const totalDurationSec = ((Date.now() - suiteStartTime) / 1000).toFixed(2);
    console.log('\n================================================================');
    console.log(`REAL SIMULATION COMPLETED in ${totalDurationSec}s`);
    console.log(`Results: ${passedCount}/${totalRuns} passed, ${failures.length} failed`);
    console.log('================================================================');

    if (failures.length > 0) {
      console.log('\nFAILING SEEDS AND TRACES:');
      for (const f of failures) {
        console.log(`\n--- Seed ${f.seed} ---`);
        console.log(f.error);
        if (f.stack) console.log(f.stack);
      }
      process.exit(1);
    } else {
      console.log('ALL 200 REAL POSTGRES SEEDS PASSED WITH ZERO FAILURES!');
      process.exit(0);
    }
  })();
}
