/**
 * Red Console — attack orchestration and history server.
 *
 * Port: RED_CONSOLE_PORT (default 4060).
 *
 * Provides a REST API for launching attacks, viewing results, managing run
 * history, and inspecting the UCB1 adaptive attack selector state. This is
 * the single entry point for the frontend dashboard and the evaluation
 * collector to trigger and observe Red Team operations.
 */
import "dotenv/config";
import express from "express";
import { RED_CONFIG } from "./config.js";
import { corsMiddleware } from "./cors.js";
import { SCENARIO_CATALOG, SCENARIOS, normalizeScenarioId } from "./scenarios.js";
import { runAttack, generateRunId } from "./runner.js";
import { createUCB1State, selectArm, updateArm } from "./ucb1.js";
import { MUTATION_CATALOG, runFuzzer } from "./fuzzer.js";
import type { AttackResult, UCB1State } from "./types.js";

export function createConsoleApp() {
  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);

  // ── In-memory state ─────────────────────────────────────────────────────────

  let runHistory: AttackResult[] = [];
  let ucb1State: UCB1State = createUCB1State();

  // Track running attacks to prevent reporting stale data
  const runningAttacks = new Map<string, { attackId: string; startedAt: string }>();
  const benchmarkRuns = new Map<string, { status: string; total: number; runs: AttackResult[] }>();

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "red-console",
      port: RED_CONFIG.consolePort,
      blueTarget: RED_CONFIG.blueUrl,
      totalRuns: runHistory.length,
      runningAttacks: runningAttacks.size,
    });
  });

  // ── Attack Catalog ──────────────────────────────────────────────────────────

  app.get("/attacks", (_req, res) => {
    res.json({
      attacks: SCENARIO_CATALOG,
      totalScenarios: SCENARIO_CATALOG.length,
      blueTarget: RED_CONFIG.blueUrl,
    });
  });

  // ── Run Attack(s) ───────────────────────────────────────────────────────────

  app.post("/redblue/run", async (req, res) => {
    const { attackId, runAll, useUCB1 } = req.body as {
      attackId?: string;
      runAll?: boolean;
      useUCB1?: boolean;
    };

    if (useUCB1) {
      // UCB1 adaptive selection — pick the most promising attack
      const selectedId = selectArm(ucb1State);
      const runId = generateRunId();
      runningAttacks.set(runId, { attackId: selectedId, startedAt: new Date().toISOString() });

      res.json({ runId, attackId: selectedId, status: "running", strategy: "ucb1" });

      executeAndRecord(selectedId, runId).then(() => {
        runningAttacks.delete(runId);
      });
      return;
    }

    if (runAll) {
      const runId = generateRunId();
      const attackIds = Object.keys(SCENARIOS);
      runningAttacks.set(runId, { attackId: "ALL", startedAt: new Date().toISOString() });

      res.json({
        runId,
        status: "running",
        attacks: attackIds,
        total: attackIds.length,
      });

      // Run all attacks sequentially to avoid overwhelming Blue
      executeAll(attackIds, runId);
      return;
    }

    if (!attackId) {
      res.status(400).json({
        error: "BAD_REQUEST",
        hint: 'POST { "attackId": "A01_OVERPAY" } or { "runAll": true } or { "useUCB1": true }',
      });
      return;
    }

    const canonicalId = normalizeScenarioId(attackId);
    if (!SCENARIOS[canonicalId]) {
      res.status(400).json({
        error: "UNKNOWN_ATTACK",
        hint: `Valid IDs: ${Object.keys(SCENARIOS).join(", ")} or aliases (e.g. VALID, OVERPAY, A01..A10)`,
      });
      return;
    }

    const runId = generateRunId();
    runningAttacks.set(runId, { attackId: canonicalId, startedAt: new Date().toISOString() });

    res.json({ runId, attackId: canonicalId, status: "running" });

    executeAndRecord(canonicalId, runId).then(() => {
      runningAttacks.delete(runId);
    });
  });

  // ── Run Result ──────────────────────────────────────────────────────────────

  app.get("/redblue/result/:runId", (req, res) => {
    const { runId } = req.params;
    const result = runHistory.find((r) => r.runId === runId);

    if (!result) {
      const benchmark = benchmarkRuns.get(runId);
      if (benchmark) {
        res.json({ runId, ...benchmark });
        return;
      }
      const running = runningAttacks.get(runId);
      if (running) {
        res.json({ runId, status: "running", attackId: running.attackId, startedAt: running.startedAt });
        return;
      }
      res.status(404).json({ error: "NOT_FOUND", hint: "Unknown runId" });
      return;
    }

    res.json({ ...result, status: "completed" });
  });

  // ── Run History ─────────────────────────────────────────────────────────────

  app.get("/redblue/history", (_req, res) => {
    // Summary statistics
    const stats = {
      total: runHistory.length,
      blocked: runHistory.filter((r) => r.classification === "ATTACK_BLOCKED").length,
      bypassed: runHistory.filter((r) => r.classification === "ATTACK_BYPASS").length,
      fundsLost: runHistory.filter((r) => r.classification === "FUNDS_LOST").length,
      falsePositives: runHistory.filter((r) => r.classification === "FALSE_POSITIVE").length,
      validSuccess: runHistory.filter((r) => r.classification === "VALID_SUCCESS").length,
      errors: runHistory.filter((r) => r.classification === "ATTACK_ERROR").length,
    };

    // Per-attack breakdown
    const perAttack: Record<string, Record<string, number>> = {};
    for (const r of runHistory) {
      if (!perAttack[r.attackId]) perAttack[r.attackId] = {};
      perAttack[r.attackId][r.classification] = (perAttack[r.attackId][r.classification] ?? 0) + 1;
    }

    res.json({
      stats,
      perAttack,
      runs: runHistory.slice().reverse(), // newest first
      running: Array.from(runningAttacks.entries()).map(([id, data]) => ({ runId: id, ...data })),
    });
  });

  // ── Reset History ───────────────────────────────────────────────────────────

  app.post("/redblue/reset", (_req, res) => {
    const previousCount = runHistory.length;
    runHistory = [];
    ucb1State = createUCB1State();

    res.json({
      message: "Run history and UCB1 state cleared",
      previousRunCount: previousCount,
    });
  });

  // ── Export Results ──────────────────────────────────────────────────────────

  app.get("/redblue/export", (_req, res) => {
    const latencies = runHistory.map((r) => r.durationMs).sort((a, b) => a - b);
    const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalRuns: runHistory.length,
      p95LatencyMs: p95Latency,
      summary: {
        blocked: runHistory.filter((r) => r.classification === "ATTACK_BLOCKED").length,
        bypassed: runHistory.filter((r) => r.classification === "ATTACK_BYPASS").length,
        fundsLost: runHistory.filter((r) => r.classification === "FUNDS_LOST").length,
        falsePositives: runHistory.filter((r) => r.classification === "FALSE_POSITIVE").length,
        validSuccess: runHistory.filter((r) => r.classification === "VALID_SUCCESS").length,
        errors: runHistory.filter((r) => r.classification === "ATTACK_ERROR").length,
      },
      perAttack: Object.fromEntries(
        SCENARIO_CATALOG.map((s) => {
          const runs = runHistory.filter((r) => r.attackId === s.id);
          return [
            s.id,
            {
              name: s.name,
              threatLevel: s.threatLevel,
              expectedDecision: s.expectedDecision,
              totalRuns: runs.length,
              blocked: runs.filter((r) => r.classification === "ATTACK_BLOCKED").length,
              bypassed: runs.filter((r) => r.classification === "ATTACK_BYPASS").length,
              fundsLost: runs.filter((r) => r.classification === "FUNDS_LOST").length,
            },
          ];
        }),
      ),
      ucb1: ucb1State,
      runs: runHistory,
    };

    res.json(exportData);
  });

  // ── UCB1 State ──────────────────────────────────────────────────────────────

  app.get("/ucb1/state", (_req, res) => {
    res.json({
      ucb1: ucb1State,
      nextRecommended: ucb1State.arms.some((a) => a.pulls === 0)
        ? ucb1State.arms.find((a) => a.pulls === 0)?.attackId
        : selectArm(ucb1State),
    });
  });

  // ── Mutation Fuzzer ─────────────────────────────────────────────────────────

  app.get("/fuzzer/catalog", (_req, res) => {
    res.json({
      totalMutations: MUTATION_CATALOG.length,
      mutations: MUTATION_CATALOG.map((m) => ({
        mutationId: m.mutationId,
        category: m.category,
        description: m.description,
        mutatedFields: m.mutatedFields,
      })),
    });
  });

  app.post("/fuzzer/run", async (req, res) => {
    const { count, seed } = req.body as { count?: number; seed?: number };
    try {
      const summary = await runFuzzer({ count, seed });
      res.json(summary);
    } catch (err) {
      res.status(500).json({
        error: "FUZZER_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Internal helpers ────────────────────────────────────────────────────────

  async function executeAndRecord(attackId: string, runId?: string): Promise<AttackResult> {
    const result = await runAttack(attackId, runId);
    runHistory.push(result);
    // Real UCB1 reinforcement from actual attack outcome
    ucb1State = updateArm(ucb1State, attackId, result.classification);
    return result;
  }

  async function executeAll(attackIds: string[], parentRunId?: string): Promise<void> {
    const runs: AttackResult[] = [];
    for (const id of attackIds) {
      const res = await executeAndRecord(id);
      runs.push(res);
      if (parentRunId) {
        benchmarkRuns.set(parentRunId, { status: "running", total: attackIds.length, runs });
      }
    }
    if (parentRunId) {
      benchmarkRuns.set(parentRunId, { status: "completed", total: attackIds.length, runs });
      runningAttacks.delete(parentRunId);
    }
  }

  return app;
}

// ── Start ───────────────────────────────────────────────────────────────────

const isDirectRun = Boolean(process.argv[1] && /console\.[jt]s$/i.test(process.argv[1]));

if (isDirectRun) {
  const app = createConsoleApp();
  app.listen(RED_CONFIG.consolePort, RED_CONFIG.host, () => {
    console.log(`\n🔴 Red Console on http://${RED_CONFIG.host}:${RED_CONFIG.consolePort}`);
    console.log(`   Blue target: ${RED_CONFIG.blueUrl}`);
    console.log(`   Attack scenarios: ${SCENARIO_CATALOG.length}`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     GET  /attacks`);
    console.log(`     POST /redblue/run { attackId | runAll | useUCB1 }`);
    console.log(`     GET  /redblue/result/:runId`);
    console.log(`     GET  /redblue/history`);
    console.log(`     POST /redblue/reset`);
    console.log(`     GET  /ucb1/state`);
    console.log(`     GET  /fuzzer/catalog`);
    console.log(`     POST /fuzzer/run\n`);
  });
}
