import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getDatabase } from "./db/database.js";
import { IdentityRegistry } from "./identity.js";
import { fingerprintRequirements, type PaymentRequirementsLike } from "./fingerprint.js";
import { emitEvent, buildEvent } from "./event-emitter.js";

/**
 * Six-layer security firewall for PayGuard AI.
 *
 * ALL six checks must pass before any signing is allowed.
 * Any unhandled exception in the pipeline → allowed: false (fail closed).
 *
 * Check order:
 *   1. Schema + Expiry validation
 *   2. Recipient Identity Binding
 *   3. Amount Guard (integer arithmetic only)
 *   4. Replay Protection (SQLite transaction)
 *   5. Budget Policy (atomic reservation)
 *   6. Intent Fingerprint Lock
 */

export type AttackType =
  | "OVERPAYMENT"
  | "WRONG_RECIPIENT"
  | "FAKE_TOKEN"
  | "WRONG_NETWORK"
  | "EXPIRED_PAYMENT"
  | "REPLAY_ATTACK"
  | "DOMAIN_SPOOF"
  | "TOCTOU_MODIFY"
  | "BUDGET_EXHAUST"
  | "INVALID_SCHEMA";

export interface SecurityDecision {
  decisionId: string;
  allowed: boolean;
  attackType: AttackType | null;
  violatedCheck: string | null;
  suspiciousField: string | null;
  evidence: { expected: unknown; received: unknown } | null;
  intentToken: string | null;
  latencyMs: number;
  decidedAt: string;
}

export interface ShieldCheckResult {
  allowed: boolean;
  intentToken: string | null;
  decision: SecurityDecision;
}

const PaymentRequirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string(),
  payTo: z.string().min(1),
  asset: z.string().min(1),
  resource: z.string().url(),
  maxTimeoutSeconds: z.number().int().min(0),
  nonce: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  outputSchema: z.unknown().optional(),
  extra: z.unknown().optional(),
});

export type PaymentRequirementsInput = z.infer<typeof PaymentRequirementsSchema>;

export interface FirewallConfig {
  perRequestMaxUsd: number;
  dailyBudgetUsd: number;
  tokenDecimals: number;
}

const DEFAULT_CONFIG: FirewallConfig = {
  perRequestMaxUsd: 0.1,
  dailyBudgetUsd: 1.0,
  tokenDecimals: 6,
};

export class WalletShieldFirewall {
  private readonly registry: IdentityRegistry;
  private readonly config: FirewallConfig;

  constructor(registry: IdentityRegistry, config?: Partial<FirewallConfig>) {
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  validateSync(
    req: Record<string, unknown>,
    runId?: string,
  ): ShieldCheckResult {
    const startMs = performance.now();
    const decisionId = `dec_${uuidv4()}`;
    const currentRunId = runId ?? `run_${uuidv4()}`;

    try {
      // CHECK 1: Schema + Expiry
      const check1 = this.checkSchemaAndExpiry(req);
      if (!check1.allowed) {
        return this.finalize(check1, decisionId, startMs, req, currentRunId);
      }
      const parsed = check1.parsed!;

      // CHECK 2: Recipient Identity Binding
      const check2 = this.checkRecipientIdentity(parsed);
      if (!check2.allowed) {
        return this.finalize(check2, decisionId, startMs, req, currentRunId);
      }

      // CHECK 3: Amount Guard (integer arithmetic)
      const check3 = this.checkAmountGuard(parsed);
      if (!check3.allowed) {
        return this.finalize(check3, decisionId, startMs, req, currentRunId);
      }

      // CHECK 4: Replay Protection
      const check4 = this.checkReplayProtection(parsed);
      if (!check4.allowed) {
        return this.finalize(check4, decisionId, startMs, req, currentRunId);
      }

      // CHECK 5: Budget Policy
      const check5 = this.checkBudgetPolicy(parsed);
      if (!check5.allowed) {
        return this.finalize(check5, decisionId, startMs, req, currentRunId);
      }

      // CHECK 6: Intent Fingerprint Lock
      const intentToken = fingerprintRequirements(parsed as PaymentRequirementsLike);

      const result: CheckResult = {
        allowed: true,
        attackType: null,
        violatedCheck: null,
        suspiciousField: null,
        evidence: null,
        intentToken,
      };

      return this.finalize(result, decisionId, startMs, req, currentRunId);
    } catch (err) {
      const result: CheckResult = {
        allowed: false,
        attackType: "INVALID_SCHEMA",
        violatedCheck: "unhandled_exception",
        suspiciousField: null,
        evidence: { expected: "no error", received: String(err) },
        intentToken: null,
      };
      return this.finalize(result, decisionId, startMs, req, currentRunId);
    }
  }

  async validate(
    req: Record<string, unknown>,
    runId?: string,
  ): Promise<ShieldCheckResult> {
    return this.validateSync(req, runId);
  }

  /**
   * Verify an intent token at the signing boundary.
   * Returns true if the payload matches the stored approval.
   */
  verifyIntentForSigning(
    payload: PaymentRequirementsLike,
    intentToken: string,
  ): boolean {
    const recomputed = fingerprintRequirements(payload);
    return recomputed === intentToken;
  }

  // ── CHECK 1: Schema + Expiry ──────────────────────────────────────────

  private checkSchemaAndExpiry(req: Record<string, unknown>): CheckResult & { parsed?: PaymentRequirementsInput } {
    const parseResult = PaymentRequirementsSchema.safeParse(req);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      return {
        allowed: false,
        attackType: "INVALID_SCHEMA",
        violatedCheck: "schema",
        suspiciousField: firstIssue?.path?.join(".") ?? null,
        evidence: {
          expected: "valid PaymentRequirements schema",
          received: firstIssue?.message ?? "unknown validation error",
        },
        intentToken: null,
      };
    }

    const parsed = parseResult.data;

    // Expiry check: maxTimeoutSeconds is relative to request receipt.
    // If maxTimeoutSeconds === 0, the payment is already expired at receipt.
    if (parsed.maxTimeoutSeconds <= 0) {
      return {
        allowed: false,
        attackType: "EXPIRED_PAYMENT",
        violatedCheck: "expiry",
        suspiciousField: "maxTimeoutSeconds",
        evidence: {
          expected: "maxTimeoutSeconds > 0",
          received: parsed.maxTimeoutSeconds,
        },
        intentToken: null,
      };
    }

    return {
      allowed: true,
      attackType: null,
      violatedCheck: null,
      suspiciousField: null,
      evidence: null,
      intentToken: null,
      parsed,
    };
  }

  // ── CHECK 2: Recipient Identity Binding ────────────────────────────────

  private checkRecipientIdentity(req: PaymentRequirementsInput): CheckResult {
    let domain: string;
    try {
      domain = new URL(req.resource).hostname.toLowerCase();
    } catch {
      return {
        allowed: false,
        attackType: "DOMAIN_SPOOF",
        violatedCheck: "recipient_identity",
        suspiciousField: "resource",
        evidence: { expected: "valid resource URL", received: req.resource },
        intentToken: null,
      };
    }

    const provider = this.registry.lookup(req.resource);
    if (!provider) {
      return {
        allowed: false,
        attackType: "DOMAIN_SPOOF",
        violatedCheck: "recipient_identity",
        suspiciousField: "resource",
        evidence: { expected: "known domain", received: domain },
        intentToken: null,
      };
    }

    const normalizedPayTo = this.registry.normalizeAddress(req.payTo, req.network);
    const normalizedExpected = this.registry.normalizeAddress(provider.payTo, provider.network);
    if (normalizedPayTo !== normalizedExpected) {
      return {
        allowed: false,
        attackType: "WRONG_RECIPIENT",
        violatedCheck: "recipient_identity",
        suspiciousField: "payTo",
        evidence: { expected: provider.payTo, received: req.payTo },
        intentToken: null,
      };
    }

    if (this.registry.normalizeAddress(req.asset, req.network) !==
        this.registry.normalizeAddress(provider.asset, provider.network)) {
      return {
        allowed: false,
        attackType: "FAKE_TOKEN",
        violatedCheck: "recipient_identity",
        suspiciousField: "asset",
        evidence: { expected: provider.asset, received: req.asset },
        intentToken: null,
      };
    }

    if (req.network !== provider.network) {
      return {
        allowed: false,
        attackType: "WRONG_NETWORK",
        violatedCheck: "recipient_identity",
        suspiciousField: "network",
        evidence: { expected: provider.network, received: req.network },
        intentToken: null,
      };
    }

    return {
      allowed: true,
      attackType: null,
      violatedCheck: null,
      suspiciousField: null,
      evidence: null,
      intentToken: null,
    };
  }

  // ── CHECK 3: Amount Guard (BigInt only) ────────────────────────────────

  private checkAmountGuard(req: PaymentRequirementsInput): CheckResult {
    let requestedAtomic: bigint;
    try {
      requestedAtomic = BigInt(req.maxAmountRequired);
    } catch {
      return {
        allowed: false,
        attackType: "OVERPAYMENT",
        violatedCheck: "amount_guard",
        suspiciousField: "maxAmountRequired",
        evidence: { expected: "valid integer string", received: req.maxAmountRequired },
        intentToken: null,
      };
    }

    if (requestedAtomic < 0n) {
      return {
        allowed: false,
        attackType: "OVERPAYMENT",
        violatedCheck: "amount_guard",
        suspiciousField: "maxAmountRequired",
        evidence: { expected: "non-negative amount", received: req.maxAmountRequired },
        intentToken: null,
      };
    }

    const policyMaxAtomic = BigInt(Math.round(this.config.perRequestMaxUsd * (10 ** this.config.tokenDecimals)));

    if (requestedAtomic > policyMaxAtomic) {
      return {
        allowed: false,
        attackType: "OVERPAYMENT",
        violatedCheck: "amount_guard",
        suspiciousField: "maxAmountRequired",
        evidence: {
          expected: policyMaxAtomic.toString(),
          received: req.maxAmountRequired,
        },
        intentToken: null,
      };
    }

    return {
      allowed: true,
      attackType: null,
      violatedCheck: null,
      suspiciousField: null,
      evidence: null,
      intentToken: null,
    };
  }

  // ── CHECK 4: Replay Protection ─────────────────────────────────────────

  private checkReplayProtection(req: PaymentRequirementsInput): CheckResult {
    const nonceId = req.nonce ?? `auto_${uuidv4()}`;

    const db = getDatabase();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + req.maxTimeoutSeconds * 1000).toISOString();

    const checkAndInsert = db.transaction(() => {
      const existing = db.prepare(
        "SELECT id FROM seen_nonces WHERE id = ? AND network = ? AND expires_at > ?",
      ).get(nonceId, req.network, now) as { id: string } | undefined;

      if (existing) {
        return false;
      }

      db.prepare(
        "INSERT INTO seen_nonces (id, network, settled_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(nonceId, req.network, now, expiresAt);

      return true;
    });

    const success = checkAndInsert();
    if (!success) {
      return {
        allowed: false,
        attackType: "REPLAY_ATTACK",
        violatedCheck: "replay_protection",
        suspiciousField: "nonce",
        evidence: { expected: "unseen nonce", received: nonceId },
        intentToken: null,
      };
    }

    return {
      allowed: true,
      attackType: null,
      violatedCheck: null,
      suspiciousField: null,
      evidence: null,
      intentToken: null,
    };
  }

  // ── CHECK 5: Budget Policy (atomic reservation) ────────────────────────

  private checkBudgetPolicy(req: PaymentRequirementsInput): CheckResult {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const requestedAtomic = BigInt(req.maxAmountRequired);
    const dailyLimitAtomic = BigInt(Math.round(this.config.dailyBudgetUsd * (10 ** this.config.tokenDecimals)));

    const reserveResult = db.transaction(() => {
      const spentRows = db.prepare(
        `SELECT COALESCE(SUM(CAST(amount_usd * ? AS INTEGER)), 0) as total
         FROM spend_entries
         WHERE kind = 'spend' AND at >= ?`,
      ).get(10 ** this.config.tokenDecimals, today + "T00:00:00.000Z") as { total: number };

      const pendingRows = db.prepare(
        `SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) as total
         FROM budget_reservations
         WHERE status = 'pending' AND reserved_at >= ?`,
      ).get(today + "T00:00:00.000Z") as { total: number };

      const existingSpent = BigInt(spentRows.total);
      const pendingReserved = BigInt(pendingRows.total);
      const totalCommitted = existingSpent + pendingReserved + requestedAtomic;

      if (totalCommitted > dailyLimitAtomic) {
        return { success: false as const, reservationId: "" };
      }

      const reservationId = `res_${uuidv4()}`;
      db.prepare(
        `INSERT INTO budget_reservations (reservation_id, amount_atomic, network, reserved_at, status)
         VALUES (?, ?, ?, ?, 'pending')`,
      ).run(reservationId, requestedAtomic.toString(), req.network, new Date().toISOString());

      return { success: true as const, reservationId };
    })();

    if (!reserveResult.success) {
      return {
        allowed: false,
        attackType: "BUDGET_EXHAUST",
        violatedCheck: "budget_policy",
        suspiciousField: "maxAmountRequired",
        evidence: {
          expected: `daily limit ${dailyLimitAtomic.toString()} atomic`,
          received: `requested ${requestedAtomic.toString()} would exceed`,
        },
        intentToken: null,
      };
    }

    return {
      allowed: true,
      attackType: null,
      violatedCheck: null,
      suspiciousField: null,
      evidence: null,
      intentToken: null,
    };
  }

  // ── Result Finalization ────────────────────────────────────────────────

  private finalize(
    result: CheckResult,
    decisionId: string,
    startMs: number,
    req: Record<string, unknown>,
    runId: string,
  ): ShieldCheckResult {
    const latencyMs = Math.round(performance.now() - startMs);
    const decidedAt = new Date().toISOString();

    const decision: SecurityDecision = {
      decisionId,
      allowed: result.allowed,
      attackType: result.attackType,
      violatedCheck: result.violatedCheck,
      suspiciousField: result.suspiciousField,
      evidence: result.evidence,
      intentToken: result.intentToken,
      latencyMs,
      decidedAt,
    };

    try {
      const db = getDatabase();
      db.prepare(
        `INSERT INTO security_decisions
         (decision_id, allowed, attack_type, violated_check, suspicious_field,
          evidence_json, intent_token, latency_ms, decided_at, payment_req_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        decisionId,
        result.allowed ? 1 : 0,
        result.attackType,
        result.violatedCheck,
        result.suspiciousField,
        JSON.stringify(result.evidence ?? {}),
        result.intentToken,
        latencyMs,
        decidedAt,
        JSON.stringify(req),
      );
    } catch (err) {
      console.warn("[firewall] failed to persist decision:", err);
    }

    const eventType = result.allowed ? "PAYMENT_APPROVED" : "PAYMENT_BLOCKED";
    const severity = result.allowed ? "LOW" : (result.attackType ? "HIGH" : "MEDIUM");
    emitEvent(
      buildEvent(
        "BLUE",
        eventType,
        severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        result.allowed
          ? "Payment approved by firewall"
          : `Payment blocked: ${result.attackType ?? "unknown"} — ${result.violatedCheck ?? ""}`,
        {
          decisionId,
          attackType: result.attackType,
          violatedCheck: result.violatedCheck,
          suspiciousField: result.suspiciousField,
          evidence: result.evidence,
          latencyMs,
        },
        runId,
        result.attackType ? decisionId : null,
      ),
    ).catch(() => { /* collector failure is non-fatal */ });

    return {
      allowed: result.allowed,
      intentToken: result.intentToken,
      decision,
    };
  }
}

interface CheckResult {
  allowed: boolean;
  attackType: AttackType | null;
  violatedCheck: string | null;
  suspiciousField: string | null;
  evidence: { expected: unknown; received: unknown } | null;
  intentToken: string | null;
  parsed?: PaymentRequirementsInput;
}
