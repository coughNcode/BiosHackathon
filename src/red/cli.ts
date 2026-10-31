/**
 * Red Team CLI — command-line attack launcher and evaluation utility.
 *
 * Can be executed directly from terminal on Laptop B:
 *   npx tsx src/red/cli.ts list
 *   npx tsx src/red/cli.ts run A01
 *   npx tsx src/red/cli.ts run-all
 *   npx tsx src/red/cli.ts ucb1
 *   npx tsx src/red/cli.ts fuzz --count 10 --seed 42
 */
import { SCENARIO_CATALOG, SCENARIOS, normalizeScenarioId, getCatalogEntry } from "./scenarios.js";
import { runAttack } from "./runner.js";
import { createUCB1State, selectArm, updateArm } from "./ucb1.js";
import { runFuzzer } from "./fuzzer.js";
import { RED_CONFIG } from "./config.js";
import type { AttackResult } from "./types.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() ?? "help";

  switch (command) {
    case "list":
      printCatalog();
      break;

    case "run": {
      const attackId = args[1];
      if (!attackId) {
        console.error("❌ Error: Missing attack ID. Example: npx tsx src/red/cli.ts run A01");
        process.exit(1);
      }
      await executeSingle(attackId);
      break;
    }

    case "run-all":
      await executeAllScenarios();
      break;

    case "ucb1": {
      const iterations = Number(args[1] ?? 5);
      await executeUCB1Loop(iterations);
      break;
    }

    case "fuzz": {
      const count = Number(args.find((a, i) => args[i - 1] === "--count") ?? 10);
      const seed = Number(args.find((a, i) => args[i - 1] === "--seed") ?? Math.floor(Math.random() * 100000));
      await executeFuzzing(count, seed);
      break;
    }

    case "help":
    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
🔴 PayGuard AI — Red Team CLI
Target Blue URL: ${RED_CONFIG.blueUrl}

Commands:
  list                          List all 10 attack scenarios (A01–A10)
  run <attackId>                Run a single attack (e.g. A01, A08_TOCTOU, VALID)
  run-all                       Run all 10 scenarios and print scoreboard
  ucb1 [iterations]             Run adaptive UCB1 bandit selection loop
  fuzz [--count N] [--seed S]   Run mutation fuzzer against Blue

Examples:
  npx tsx src/red/cli.ts run A01
  npx tsx src/red/cli.ts run A08
  npx tsx src/red/cli.ts run-all
  npx tsx src/red/cli.ts fuzz --count 15
`);
}

function printCatalog() {
  console.log("\n==================== RED ATTACK CATALOG (A01–A10) ====================");
  for (const s of SCENARIO_CATALOG) {
    const isControl = s.expectedDecision === "ALLOW";
    const tag = isControl ? "[CONTROL]" : `[${s.threatLevel}]`;
    console.log(`  ${s.id.padEnd(20)} ${tag.padEnd(12)} Expected: ${s.expectedDecision.padEnd(6)} | ${s.name}`);
    console.log(`    └─ ${s.description}\n`);
  }
}

async function executeSingle(rawId: string) {
  const canonicalId = normalizeScenarioId(rawId);
  const catalog = getCatalogEntry(canonicalId);

  if (!catalog) {
    console.error(`❌ Unknown scenario: "${rawId}". Run 'list' to view valid IDs.`);
    process.exit(1);
  }

  console.log(`\n🚀 Launching attack: ${catalog.id} (${catalog.name})`);
  console.log(`   Target:   ${RED_CONFIG.blueUrl}/shield-check`);
  console.log(`   Expected: ${catalog.expectedDecision}\n`);

  const result = await runAttack(canonicalId);
  formatResult(result);
}

async function executeAllScenarios() {
  console.log("\n==================== EXECUTING ALL 10 ATTACKS ====================");
  console.log(`Target: ${RED_CONFIG.blueUrl}\n`);

  const results: AttackResult[] = [];
  const ids = Object.keys(SCENARIOS);

  for (const id of ids) {
    process.stdout.write(`  Running ${id.padEnd(20)} ... `);
    const result = await runAttack(id);
    results.push(result);
    console.log(`[${result.classification}] (${result.durationMs}ms)`);
  }

  // Summary scorecard
  console.log("\n==================== RED TEAM SCOREBOARD ====================");
  const blocked = results.filter((r) => r.classification === "ATTACK_BLOCKED").length;
  const bypass = results.filter((r) => r.classification === "ATTACK_BYPASS").length;
  const fundsLost = results.filter((r) => r.classification === "FUNDS_LOST").length;
  const validOk = results.filter((r) => r.classification === "VALID_SUCCESS").length;
  const falsePos = results.filter((r) => r.classification === "FALSE_POSITIVE").length;
  const errors = results.filter((r) => r.classification === "ATTACK_ERROR").length;

  console.log(`  Total Executed:       ${results.length}`);
  console.log(`  Attacks Blocked:      ${blocked}`);
  console.log(`  Attacks Bypassed:     ${bypass}`);
  console.log(`  Funds Lost:           ${fundsLost}`);
  console.log(`  Valid Flow Success:   ${validOk}`);
  console.log(`  False Positives:      ${falsePos}`);
  console.log(`  Infrastructure Errors:${errors}`);
  console.log("=============================================================\n");
}

async function executeUCB1Loop(iterations: number) {
  console.log(`\n🤖 Starting UCB1 Adaptive Attack Selector (${iterations} iterations)...`);
  let state = createUCB1State();

  for (let i = 0; i < iterations; i++) {
    const chosen = selectArm(state);
    process.stdout.write(`  [${i + 1}/${iterations}] Arm: ${chosen.padEnd(20)} ... `);
    const result = await runAttack(chosen);
    state = updateArm(state, chosen, result.classification);
    console.log(`[${result.classification}]`);
  }

  console.log("\n==================== UCB1 BANDIT STATE ====================");
  for (const arm of state.arms) {
    console.log(
      `  ${arm.attackId.padEnd(20)} Pulls: ${String(arm.pulls).padEnd(4)} AvgReward: ${(arm.avgReward * 100).toFixed(1)}%`,
    );
  }
  console.log("===========================================================\n");
}

async function executeFuzzing(count: number, seed: number) {
  console.log(`\n🧬 Running Mutation Fuzzer (count=${count}, seed=${seed})...`);
  const summary = await runFuzzer({ count, seed });

  console.log("\n==================== FUZZING SUMMARY ====================");
  console.log(`  Mutations Tested:     ${summary.totalMutations}`);
  console.log(`  Blocked:              ${summary.blockedCount}`);
  console.log(`  Bypass:               ${summary.bypassCount}`);
  console.log(`  Errors:               ${summary.errorCount}`);
  console.log("---------------------------------------------------------");

  for (const r of summary.results) {
    console.log(`  ${r.mutationId.padEnd(26)} [${r.classification.padEnd(14)}] ${r.description}`);
  }
  console.log("=========================================================\n");
}

function formatResult(r: AttackResult) {
  console.log("----------------------- RESULT -----------------------");
  console.log(`  Run ID:           ${r.runId}`);
  console.log(`  Attack ID:        ${r.attackId}`);
  console.log(`  Classification:   ${r.classification}`);
  console.log(`  Blue Allowed:     ${r.blueResponse?.allowed ?? "N/A"}`);
  console.log(`  Signer Invoked:   ${r.signerEvidence.invoked} (source: ${r.signerEvidence.source})`);
  console.log(`  Funds Moved:      ${r.chainResult.fundsTransferred} (source: ${r.chainResult.source})`);
  console.log(`  Duration:         ${r.durationMs}ms`);
  if (r.error) {
    console.log(`  Error:            ${r.error}`);
  }
  if (r.evidence) {
    console.log(`  Evidence:         ${JSON.stringify(r.evidence)}`);
  }
  console.log("------------------------------------------------------\n");
}

// Check if run directly
const isDirectRun = Boolean(process.argv[1] && /cli\.[jt]s$/i.test(process.argv[1]));
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal CLI error:", err);
    process.exit(1);
  });
}

