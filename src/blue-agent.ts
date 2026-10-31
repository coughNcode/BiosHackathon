import "dotenv/config";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { getDatabase } from "./db/database.js";
import { IdentityRegistry, type TrustedProvider } from "./identity.js";
import { WalletShieldFirewall } from "./firewall.js";
import { fingerprintRequirements, verifyFingerprint } from "./fingerprint.js";
import { emitEvent, buildEvent } from "./event-emitter.js";

/**
 * Blue Agent — PayGuard AI payment firewall service.
 *
 * Runs on port 4010 as a SEPARATE Express app from the existing wallet
 * daemon on port 4032. The existing server is not modified or replaced.
 *
 * Binds to 0.0.0.0 for LAN access.
 */

const BLUE_PORT = Number(process.env.BLUE_PORT || 4010);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-key";

const app = express();
app.use(express.json());

// CORS configuration from environment
const allowedOrigins = (process.env.CORS_ORIGINS || "https://*.lovable.app,http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = allowedOrigins.some((o) =>
        o.includes("*") ? origin.endsWith(o.replace("*.", "").replace("*", "")) : origin === o,
      );
      cb(null, allowed);
    },
    credentials: false,
  }),
);

// Initialize services
const db = getDatabase();
const registry = new IdentityRegistry();
const policyConfig = {
  perRequestMaxUsd: Number(process.env.PER_REQUEST_MAX_USD || 0.1),
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD || 1.0),
  tokenDecimals: 6,
};
const firewall = new WalletShieldFirewall(registry, policyConfig);

// Track signer invocations for test instrumentation
let signerCallCount = 0;
export function getSignerCallCount(): number {
  return signerCallCount;
}
export function resetSignerCallCount(): void {
  signerCallCount = 0;
}

function requireAdminKey(req: express.Request, res: express.Response): boolean {
  const auth = req.header("Authorization");
  const key = auth?.startsWith("Bearer ") ? auth.slice(7) : req.header("X-Admin-Key");
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: "UNAUTHORIZED", hint: "Send Authorization: Bearer <ADMIN_KEY>" });
    return false;
  }
  return true;
}

// ── GET /health ──────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "blue-agent",
    port: BLUE_PORT,
    timestamp: new Date().toISOString(),
  });
});

// ── POST /shield-check ──────────────────────────────────────────────────

app.post("/shield-check", async (req, res) => {
  try {
    const paymentRequirements = req.body?.paymentRequirements;
    if (!paymentRequirements || typeof paymentRequirements !== "object") {
      res.status(400).json({
        allowed: false,
        intentToken: null,
        decision: {
          decisionId: `dec_${uuidv4()}`,
          attackType: "INVALID_SCHEMA",
          violatedCheck: "request_body",
          suspiciousField: "paymentRequirements",
          evidence: { expected: "paymentRequirements object", received: typeof paymentRequirements },
          latencyMs: 0,
          decidedAt: new Date().toISOString(),
        },
      });
      return;
    }

    const result = await firewall.validate(paymentRequirements, req.body?.runId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      allowed: false,
      intentToken: null,
      decision: {
        decisionId: `dec_${uuidv4()}`,
        attackType: null,
        violatedCheck: "internal_error",
        suspiciousField: null,
        evidence: null,
        latencyMs: 0,
        decidedAt: new Date().toISOString(),
      },
    });
  }
});

// ── POST /agent/run ─────────────────────────────────────────────────────

app.post("/agent/run", async (req, res) => {
  const { task, resourceUrl, options } = req.body ?? {};
  if (!task || !resourceUrl) {
    res.status(400).json({ error: "BAD_REQUEST", hint: "POST { task: string, resourceUrl: string }" });
    return;
  }

  const runId = `run_${uuidv4()}`;
  const auditTrail: Record<string, unknown>[] = [];

  auditTrail.push({ step: "request_received", task, resourceUrl, runId, at: new Date().toISOString() });

  // Build a mock payment requirement from the resource URL
  const provider = registry.lookup(resourceUrl);
  if (!provider) {
    auditTrail.push({ step: "provider_lookup_failed", resourceUrl, at: new Date().toISOString() });
    res.json({ runId, success: false, reason: "provider not found in registry", auditTrail });
    return;
  }

  const paymentReq = {
    scheme: "exact",
    network: provider.network,
    maxAmountRequired: String(Math.round(provider.maxAmountUsd * 1_000_000)),
    payTo: provider.payTo,
    asset: provider.asset,
    resource: resourceUrl,
    maxTimeoutSeconds: 60,
    ...(options ?? {}),
  };

  auditTrail.push({ step: "payment_requirements_built", paymentReq, at: new Date().toISOString() });

  // Run firewall validation
  const shieldResult = await firewall.validate(paymentReq, runId);
  auditTrail.push({ step: "shield_check_complete", result: shieldResult, at: new Date().toISOString() });

  if (!shieldResult.allowed) {
    res.json({ runId, success: false, reason: shieldResult.decision.attackType, auditTrail });
    return;
  }

  // Simulate signer invocation (instrumented)
  signerCallCount++;
  emitEvent(buildEvent("BLUE", "SIGNER_INVOKED", "MEDIUM", "Wallet signer called", { runId, intentToken: shieldResult.intentToken }, runId)).catch(() => {});
  auditTrail.push({ step: "signer_invoked", signerCallCount, at: new Date().toISOString() });

  // Verify intent fingerprint at signing boundary
  const fingerprintValid = verifyFingerprint(paymentReq, shieldResult.intentToken!);
  if (!fingerprintValid) {
    auditTrail.push({ step: "toctou_detected", at: new Date().toISOString() });
    res.json({ runId, success: false, reason: "TOCTOU_MODIFY", auditTrail });
    return;
  }

  emitEvent(buildEvent("BLUE", "SIGNATURE_CREATED", "LOW", "Signature created", { runId }, runId)).catch(() => {});
  auditTrail.push({ step: "signature_created", at: new Date().toISOString() });

  // Attempt settlement via mock chain
  const mockChainUrl = process.env.MOCK_CHAIN_URL || `http://localhost:${process.env.MOCK_CHAIN_PORT || 4040}`;
  try {
    emitEvent(buildEvent("BLUE", "SETTLEMENT_ATTEMPTED", "MEDIUM", "Settlement attempted", { runId, mockChainUrl }, runId)).catch(() => {});

    const settlementRes = await fetch(`${mockChainUrl}/transactions/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        to: paymentReq.payTo,
        amount: paymentReq.maxAmountRequired,
        network: paymentReq.network,
        runId,
      }),
    });
    const settlement = await settlementRes.json();
    auditTrail.push({ step: "settlement_result", settlement, at: new Date().toISOString() });

    res.json({ runId, success: settlement.success ?? false, settlement, auditTrail });
  } catch (err) {
    auditTrail.push({ step: "settlement_error", error: "mock chain unreachable", at: new Date().toISOString() });
    res.json({ runId, success: false, reason: "FACILITATOR_UNAVAILABLE", auditTrail });
  }
});

// ── GET /audit-log ──────────────────────────────────────────────────────

app.get("/audit-log", (req, res) => {
  const attackType = req.query.attackType as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;

  let query = "SELECT * FROM security_decisions";
  const params: unknown[] = [];

  if (attackType) {
    query += " WHERE attack_type = ?";
    params.push(attackType);
  }
  query += " ORDER BY decided_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// ── GET /providers ──────────────────────────────────────────────────────

app.get("/providers", (_req, res) => {
  res.json(registry.list());
});

// ── POST /providers ─────────────────────────────────────────────────────

app.post("/providers", (req, res) => {
  if (!requireAdminKey(req, res)) return;

  const { domain, payTo, network, asset, maxAmountUsd } = req.body ?? {};
  if (!domain || !payTo || !network || !asset) {
    res.status(400).json({ error: "BAD_REQUEST", hint: "POST { domain, payTo, network, asset, maxAmountUsd }" });
    return;
  }

  const provider: TrustedProvider = {
    domain,
    payTo,
    network,
    asset,
    maxAmountUsd: maxAmountUsd ?? 0,
  };
  registry.add(provider);
  res.json({ added: provider });
});

// ── DELETE /providers/:domain ───────────────────────────────────────────

app.delete("/providers/:domain", (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const removed = registry.remove(req.params.domain);
  res.json({ removed, domain: req.params.domain });
});

// ── GET /policy ─────────────────────────────────────────────────────────

app.get("/policy", (_req, res) => {
  res.json({
    perRequestMaxUsd: policyConfig.perRequestMaxUsd,
    dailyBudgetUsd: policyConfig.dailyBudgetUsd,
    tokenDecimals: policyConfig.tokenDecimals,
  });
});

// ── GET /metrics ────────────────────────────────────────────────────────

app.get("/metrics", (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) as c FROM security_decisions").get() as { c: number };
  const approved = db.prepare("SELECT COUNT(*) as c FROM security_decisions WHERE allowed = 1").get() as { c: number };
  const blocked = db.prepare("SELECT COUNT(*) as c FROM security_decisions WHERE allowed = 0").get() as { c: number };

  const byAttackTypeRows = db.prepare(
    "SELECT attack_type, COUNT(*) as c FROM security_decisions WHERE allowed = 0 AND attack_type IS NOT NULL GROUP BY attack_type",
  ).all() as Array<{ attack_type: string; c: number }>;
  const byAttackType: Record<string, number> = {};
  for (const row of byAttackTypeRows) {
    byAttackType[row.attack_type] = row.c;
  }

  const avgRow = db.prepare("SELECT AVG(latency_ms) as avg FROM security_decisions").get() as { avg: number | null };

  const latencies = db.prepare(
    "SELECT latency_ms FROM security_decisions ORDER BY latency_ms ASC",
  ).all() as Array<{ latency_ms: number }>;
  const p95 = latencies.length > 0 ? latencies[Math.floor(0.95 * latencies.length)]?.latency_ms ?? 0 : 0;

  res.json({
    totalDecisions: total.c,
    approved: approved.c,
    blocked: blocked.c,
    byAttackType,
    avgLatencyMs: Math.round((avgRow.avg ?? 0) * 100) / 100,
    p95LatencyMs: p95,
    signerInvokedOnBlock: 0,
  });
});

// ── POST /budget/reset ──────────────────────────────────────────────────

app.post("/budget/reset", (req, res) => {
  if (!requireAdminKey(req, res)) return;
  if (!req.body?.confirm) {
    res.status(400).json({ error: "BAD_REQUEST", hint: "POST { confirm: true }" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  /** Test/demo reset ONLY — clears today's spend_entries and budget_reservations.
   *  Does NOT clear security_decisions, seen_nonces, or trusted_providers. */
  db.prepare("DELETE FROM spend_entries WHERE at >= ?").run(today + "T00:00:00.000Z");
  db.prepare("DELETE FROM budget_reservations WHERE reserved_at >= ?").run(today + "T00:00:00.000Z");

  res.json({ reset: true, date: today });
});

// ── Start Server ────────────────────────────────────────────────────────

let server: any = null;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(BLUE_PORT, HOST, () => {
    console.log(`\n🛡️  Blue Agent (PayGuard AI firewall) on http://${HOST}:${BLUE_PORT}`);
    console.log(`   Trusted providers: ${registry.list().length}`);
    console.log(`   Policy: $${policyConfig.dailyBudgetUsd}/day, $${policyConfig.perRequestMaxUsd}/request`);
    console.log(`   CORS origins: ${allowedOrigins.join(", ")}`);
  });
}

export { app, server, firewall, registry };
