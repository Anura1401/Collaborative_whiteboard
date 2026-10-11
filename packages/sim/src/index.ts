import { runSimulation, type SimOptions } from './runner.js';

export * from './prng.js';
export * from './opGenerator.js';
export * from './SimClient.js';
export * from './FaultChannel.js';
export * from './SimRoom.js';
export * from './invariants.js';
export * from './runner.js';

export const SIM_PACKAGE = '@whiteboard/sim';

export async function runSim(options: SimOptions = {}): Promise<void> {
  const result = await runSimulation({
    seed: options.seed ?? 42,
    clientCount: options.clientCount ?? 8,
    totalOps: options.totalOps ?? 300,
    verbose: true,
    ...options,
  });

  console.log('\n========================================');
  console.log('       SIMULATION RUN SUMMARY           ');
  console.log('========================================');
  console.log(` Seed:           ${result.seed}`);
  console.log(` Clients:        ${result.clientCount}`);
  console.log(` Total Ops:      ${result.totalOps}`);
  console.log(` Final Seq:      ${result.finalSeq}`);
  console.log(` Live Objects:   ${result.finalObjectsCount}`);
  console.log(` Duration:       ${result.durationMs}ms`);
  console.log(` Convergence:    ${result.success ? 'PASSED (100% Identical)' : 'FAILED'}`);
  console.log('========================================\n');
}

// Auto-run if executed directly as entry script
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sim') || process.argv[1]?.endsWith('index.js')) {
  runSim().catch((err) => {
    console.error('Simulation run failed:', err);
    process.exit(1);
  });
}
