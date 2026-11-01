import type { CollectorDatabase } from "./db.js";
import type { MetricsResponse, ScorecardResponse, PerAttackScorecardItem, RunRecord } from "./types.js";

export const ATTACK_CATALOG: Record<string, { name: string; expected: "BLOCK" | "ALLOW" }> = {
  A01: { name: "Overpayment 10x Attack", expected: "BLOCK" },
  A02: { name: "Wrong Recipient / Payee Tampering", expected: "BLOCK" },
  A03: { name: "Wrong Token / Asset Contract", expected: "BLOCK" },
  A04: { name: "Wrong Network / Chain Mismatch", expected: "BLOCK" },
  A05: { name: "Long-Lived Window / Expiry Bypass", expected: "BLOCK" },
  A06: { name: "Replay Attack / Nonce Reuse", expected: "BLOCK" },
  A07: { name: "Parallel Burst / Daily Budget Race", expected: "BLOCK" },
  A08: { name: "Per-Merchant Cap Exhaustion", expected: "BLOCK" },
  A09: { name: "TOCTOU Intent Mutation", expected: "BLOCK" },
  A10: { name: "Legitimate Baseline Payment", expected: "ALLOW" },
  A11: { name: "Slow Drain Loop / Velocity Spike", expected: "BLOCK" },
  A12: { name: "Prompt Injection in Description", expected: "BLOCK" },
  A13: { name: "Resource Binding Hijack", expected: "BLOCK" },
  A14: { name: "Multi-Option Confusion", expected: "BLOCK" },
  A15: { name: "Protocol Version Confusion", expected: "BLOCK" },
  A16: { name: "Facilitator Settlement Lie", expected: "BLOCK" },
  A17: { name: "Settle-and-Fail Retry Double-Pay", expected: "BLOCK" },
  A18: { name: "ApprovalRef Token Bypass", expected: "BLOCK" },
};

/**
 * Calculates live metrics from persisted run facts.
 * Never hardcodes sample values. Returns zeros and nulls when no data.
 */
export function calculateMetrics(db: CollectorDatabase): MetricsResponse {
  const { runs } = db.getRuns({ limit: 10000 });
  const counts = db.getCounts();

  let totalAttacks = 0;
  let attacksBlocked = 0;
  let attacksBypass = 0;
  let fundsLost = 0;
  let validControls = 0;
  let validControlsAccepted = 0;
  let falsePositives = 0;
  let attackErrors = 0;
  let signerInvokedOnBlock = 0;

  const latencies: number[] = [];

  for (const r of runs) {
    const isControl =
      r.attackId === "A10" ||
      r.attackId?.toLowerCase().includes("control") ||
      r.attackId?.toLowerCase().includes("valid");

    if (isControl) {
      validControls++;
      if (r.classification === "VALID_SUCCESS") validControlsAccepted++;
      if (r.classification === "FALSE_POSITIVE") falsePositives++;
    } else {
      totalAttacks++;
      if (r.classification === "ATTACK_BLOCKED") {
        attacksBlocked++;
        if (r.signerInvoked === 1) signerInvokedOnBlock++;
      } else if (r.classification === "ATTACK_BYPASS") {
        attacksBypass++;
      } else if (r.classification === "FUNDS_LOST") {
        fundsLost++;
      }
    }

    if (r.classification === "ATTACK_ERROR") {
      attackErrors++;
    }

    if (typeof r.latencyMs === "number" && r.latencyMs >= 0) {
      latencies.push(r.latencyMs);
    }
  }

  // Calculate average and p95 latency
  let avgLatencyMs: number | null = null;
  let p95LatencyMs: number | null = null;

  if (latencies.length > 0) {
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    avgLatencyMs = Math.round((sum / latencies.length) * 10) / 10;

    latencies.sort((a, b) => a - b);
    const p95Idx = Math.min(
      latencies.length - 1,
      Math.floor(latencies.length * 0.95)
    );
    p95LatencyMs = latencies[p95Idx];
  }

  // Detection rate = attacksBlocked / (totalAttacks - attackErrors)
  const scorableAttacks = totalAttacks - attackErrors;
  const detectionRate =
    scorableAttacks > 0
      ? Math.round((attacksBlocked / scorableAttacks) * 1000) / 1000
      : null;

  // Last updated timestamp from events
  const { events: latestEvents } = db.getEvents({ limit: 1 });
  const lastUpdated = latestEvents[0]?.timestamp ?? new Date().toISOString();

  return {
    totalAttacks,
    attacksBlocked,
    attacksBypass,
    fundsLost,
    validControls,
    validControlsAccepted,
    falsePositives,
    attackErrors,
    signerInvokedOnBlock,
    avgLatencyMs,
    p95LatencyMs,
    detectionRate,
    lastUpdated,
  };
}

/**
 * Calculates security scorecard from persisted run facts.
 */
export function calculateScorecard(db: CollectorDatabase): ScorecardResponse {
  const { runs } = db.getRuns({ limit: 10000 });

  let TP = 0;
  let FP = 0;
  let FN = 0;
  let TN = 0;
  let errors = 0;

  const perAttackMap = new Map<string, RunRecord>();

  for (const r of runs) {
    if (r.classification === "ATTACK_BLOCKED") {
      TP++;
    } else if (r.classification === "FALSE_POSITIVE") {
      FP++;
    } else if (r.classification === "ATTACK_BYPASS" || r.classification === "FUNDS_LOST") {
      FN++;
    } else if (r.classification === "VALID_SUCCESS") {
      TN++;
    } else if (r.classification === "ATTACK_ERROR") {
      errors++;
    }

    if (r.attackId) {
      if (!perAttackMap.has(r.attackId)) {
        perAttackMap.set(r.attackId, r);
      }
      const prefix = r.attackId.split("_")[0];
      if (prefix && !perAttackMap.has(prefix)) {
        perAttackMap.set(prefix, r);
      }
    }
  }

  const precision =
    TP + FP > 0 ? Math.round((TP / (TP + FP)) * 1000) / 1000 : null;
  const recall =
    TP + FN > 0 ? Math.round((TP / (TP + FN)) * 1000) / 1000 : null;
  const specificity =
    TN + FP > 0 ? Math.round((TN / (TN + FP)) * 1000) / 1000 : null;

  let f1: number | null = null;
  if (precision !== null && recall !== null && precision + recall > 0) {
    f1 = Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000;
  }

  // Build perAttack list
  const perAttack: PerAttackScorecardItem[] = [];
  const allKnownIds = Array.from(
    new Set([...Object.keys(ATTACK_CATALOG), ...perAttackMap.keys()])
  ).sort();

  for (const id of allKnownIds) {
    const catalog = ATTACK_CATALOG[id] || {
      name: `Attack ${id}`,
      expected: id.startsWith("A10") ? "ALLOW" : "BLOCK",
    };
    const prefix = id.split("_")[0];
    const run = perAttackMap.get(id) || (prefix ? perAttackMap.get(prefix) : undefined);

    perAttack.push({
      attackId: id,
      attackName: catalog.name,
      expectedDecision: catalog.expected,
      classification: run?.classification ?? "UNTESTED",
      blueDecision: run?.blueDecision ?? null,
      signerInvoked: run?.signerInvoked !== null && run?.signerInvoked !== undefined
        ? run.signerInvoked === 1
        : null,
      chainTransfer: run?.chainTransfer !== null && run?.chainTransfer !== undefined
        ? run.chainTransfer === 1
        : null,
      latencyMs: run?.latencyMs ?? null,
      runId: run?.runId ?? null,
      runAt: run?.finishedAt ?? run?.startedAt ?? null,
    });
  }

  return {
    TP,
    FP,
    FN,
    TN,
    errors,
    precision,
    recall,
    specificity,
    f1,
    perAttack,
    calculatedAt: new Date().toISOString(),
  };
}

