import { runSimulation } from './runner.js';
import { DEFAULT_CHAOS, type ChaosConfig } from './FaultChannel.js';

interface FailureRecord {
  seed: number;
  clientCount: number;
  error: string;
  stack?: string;
}

const NO_CHAOS: ChaosConfig = {
  minLatencyMs: 0,
  maxLatencyMs: 2,
  packetDropRate: 0,
  delayedAckRate: 0,
};

async function runMode(name: string, chaosConfig: ChaosConfig): Promise<{ passed: number; failed: number; failures: FailureRecord[] }> {
  console.log(`\n======================================================`);
  console.log(`RUNNING MODE: ${name} (200 Seeds, 3 to 20 clients each)`);
  console.log(`======================================================`);

  const failures: FailureRecord[] = [];
  const startMode = Date.now();

  for (let seed = 1; seed <= 200; seed++) {
    const clientCount = ((seed * 7) % 18) + 3; // 3 to 20 clients
    const totalOps = 300;

    try {
      const res = await runSimulation({
        seed,
        clientCount,
        totalOps,
        chaos: chaosConfig,
        verbose: false,
      });

      if (!res.success) {
        failures.push({
          seed,
          clientCount,
          error: res.error || 'Unknown failure',
          stack: res.stack,
        });
      }
    } catch (err: unknown) {
      const e = err as Error;
      failures.push({
        seed,
        clientCount,
        error: e.message || String(e),
        stack: e.stack,
      });
      console.error(`FAIL: Seed ${seed} (Clients: ${clientCount}): ${e.message}`);
    }

    if (seed % 50 === 0) {
      console.log(`[${name}] Completed ${seed}/200 runs... (Failures so far: ${failures.length})`);
    }
  }

  const durationSec = ((Date.now() - startMode) / 1000).toFixed(1);
  console.log(`\n--- Summary: ${name} ---`);
  console.log(`Completed in: ${durationSec}s`);
  console.log(`Passed: ${200 - failures.length}/200`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log(`\nFailures in ${name}:`);
    for (const f of failures) {
      console.log(`\n  Seed ${f.seed} (${f.clientCount} clients): ${f.error}`);
      if (f.stack) {
        console.log(`  Trace:\n${f.stack}`);
      }
    }
  } else {
    console.log(`\n100% OF 200 SEEDS PASSED ALL INVARIANTS in ${name}!`);
  }

  return { passed: 200 - failures.length, failed: failures.length, failures };
}

async function main() {
  const startTotal = Date.now();

  // Mode 1: Standard (No Packet Drop / Ordered Delivery)
  const mode1Result = await runMode('Mode 1: Standard / Deterministic', NO_CHAOS);

  // Mode 2: Chaos (Fault-Injected: Packet Drops, Reordering, Disconnects, Server Restarts, Delayed ACKs)
  const mode2Result = await runMode('Mode 2: Fault-Injected / Chaos', DEFAULT_CHAOS);

  const totalTime = ((Date.now() - startTotal) / 1000).toFixed(1);

  console.log('\n======================================================');
  console.log('       FINAL DUAL-MODE SIMULATION RESULTS             ');
  console.log('======================================================');
  console.log(`Total Execution Time: ${totalTime}s`);
  console.log(`Mode 1 (Standard):       ${mode1Result.passed}/200 passed (${mode1Result.failed} failed)`);
  console.log(`Mode 2 (Fault-Injected): ${mode2Result.passed}/200 passed (${mode2Result.failed} failed)`);
  console.log('======================================================\n');
}

main().catch(console.error);
