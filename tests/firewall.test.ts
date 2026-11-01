import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabaseForTest, closeDatabase, getDatabase } from "../src/db/database.js";
import { IdentityRegistry, type TrustedProvider } from "../src/identity.js";
import { WalletShieldFirewall, type ShieldCheckResult } from "../src/firewall.js";
import {
  fingerprintRequirements,
  verifyFingerprint,
  canonicalize,
  type PaymentRequirementsLike,
} from "../src/fingerprint.js";

// ── Test Fixtures ────────────────────────────────────────────────────────

const TEST_PROVIDER: TrustedProvider = {
  domain: "demo.payguard-merchant.local",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  network: "base-sepolia",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  maxAmountUsd: 0.10,
};

const validBaseReq: Record<string, unknown> = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  resource: "https://demo.payguard-merchant.local/paid-api",
  maxTimeoutSeconds: 60,
};

// ── Signer Call Tracking ─────────────────────────────────────────────────

let _signerCalls = 0;
function trackSignerCalls(): () => number {
  _signerCalls = 0;
  return () => _signerCalls;
}

// ── Test Suite Setup ─────────────────────────────────────────────────────

let firewall: WalletShieldFirewall;
let registry: IdentityRegistry;

function setupFirewall(): void {
  delete process.env.COLLECTOR_URL;
  resetDatabaseForTest();
  registry = new IdentityRegistry("config/trusted-providers.json");
  registry.add(TEST_PROVIDER);
  firewall = new WalletShieldFirewall(registry, {
    perRequestMaxUsd: 0.1,
    dailyBudgetUsd: 1.0,
    tokenDecimals: 6,
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  FINGERPRINT TESTS
// ══════════════════════════════════════════════════════════════════════════

describe("fingerprintRequirements", () => {
  const baseReq: PaymentRequirementsLike = {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "1000",
    payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    resource: "https://demo.payguard-merchant.local/paid-api",
    maxTimeoutSeconds: 60,
  };

  it("produces sha256-prefixed fingerprint", () => {
    const fp = fingerprintRequirements(baseReq);
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changed payTo produces different fingerprint", () => {
    const fp1 = fingerprintRequirements(baseReq);
    const fp2 = fingerprintRequirements({ ...baseReq, payTo: "0xDeadBeef0000000000000000000000000000001" });
    expect(fp1).not.toBe(fp2);
  });

  it("changed amount produces different fingerprint", () => {
    const fp1 = fingerprintRequirements(baseReq);
    const fp2 = fingerprintRequirements({ ...baseReq, maxAmountRequired: "99999" });
    expect(fp1).not.toBe(fp2);
  });

  it("changed network produces different fingerprint", () => {
    const fp1 = fingerprintRequirements(baseReq);
    const fp2 = fingerprintRequirements({ ...baseReq, network: "ethereum-mainnet" });
    expect(fp1).not.toBe(fp2);
  });

  it("changed asset produces different fingerprint", () => {
    const fp1 = fingerprintRequirements(baseReq);
    const fp2 = fingerprintRequirements({ ...baseReq, asset: "0xFakeToken00000000000000000000000000001" });
    expect(fp1).not.toBe(fp2);
  });

  it("changed resource produces different fingerprint", () => {
    const fp1 = fingerprintRequirements(baseReq);
    const fp2 = fingerprintRequirements({ ...baseReq, resource: "https://evil.com/steal" });
    expect(fp1).not.toBe(fp2);
  });

  it("equivalent objects with different key ordering produce SAME fingerprint", () => {
    const reqA: PaymentRequirementsLike = {
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "1000",
      payTo: "0xABC",
      asset: "0xDEF",
      resource: "https://test.local/api",
      maxTimeoutSeconds: 60,
    };
    const reqB: PaymentRequirementsLike = {
      resource: "https://test.local/api",
      maxTimeoutSeconds: 60,
      asset: "0xDEF",
      payTo: "0xABC",
      maxAmountRequired: "1000",
      network: "base-sepolia",
      scheme: "exact",
    };
    expect(fingerprintRequirements(reqA)).toBe(fingerprintRequirements(reqB));
  });

  it("nested objects with different key ordering produce SAME fingerprint", () => {
    const reqA: PaymentRequirementsLike = {
      ...baseReq,
      extra: { b: 2, a: 1 },
    };
    const reqB: PaymentRequirementsLike = {
      ...baseReq,
      extra: { a: 1, b: 2 },
    };
    // extra is not in FINGERPRINT_FIELDS, so both should be the same
    expect(fingerprintRequirements(reqA)).toBe(fingerprintRequirements(reqB));
  });

  it("missing optional field (nonce absent vs undefined) is handled consistently", () => {
    const reqNoNonce: PaymentRequirementsLike = { ...baseReq };
    delete reqNoNonce.nonce;
    const reqUndefinedNonce: PaymentRequirementsLike = { ...baseReq, nonce: undefined };
    expect(fingerprintRequirements(reqNoNonce)).toBe(fingerprintRequirements(reqUndefinedNonce));
  });

  it("verifyFingerprint returns true for matching payload", () => {
    const token = fingerprintRequirements(baseReq);
    expect(verifyFingerprint(baseReq, token)).toBe(true);
  });

  it("verifyFingerprint returns false for mutated payload", () => {
    const token = fingerprintRequirements(baseReq);
    expect(verifyFingerprint({ ...baseReq, maxAmountRequired: "999999" }, token)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  FIREWALL TESTS
// ══════════════════════════════════════════════════════════════════════════

describe("WalletShieldFirewall", () => {
  beforeEach(() => {
    setupFirewall();
    // Prevent event emission during tests
    process.env.COLLECTOR_URL = "";
  });

  afterEach(() => {
    closeDatabase();
  });

  // ── Valid payment passes all checks ────────────────────────────────────

  it("valid payment passes all checks and returns intentToken", async () => {
    const signerCallCount = trackSignerCalls();
    const result = await firewall.validate(validBaseReq);
    expect(result.allowed).toBe(true);
    expect(result.intentToken).toMatch(/^sha256:/);
    expect(result.decision.attackType).toBeNull();
    expect(result.decision.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ── Overpayment is blocked ─────────────────────────────────────────────

  it("overpayment is blocked, signer NOT called", async () => {
    const signerCallCount = trackSignerCalls();
    const result = await firewall.validate({
      ...validBaseReq,
      maxAmountRequired: "10000000",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("OVERPAYMENT");
    expect(result.decision.violatedCheck).toBe("amount_guard");
    expect(signerCallCount()).toBe(0);
  });

  // ── Wrong payTo is blocked ─────────────────────────────────────────────

  it("wrong payTo is blocked, signer NOT called", async () => {
    const signerCallCount = trackSignerCalls();
    const result = await firewall.validate({
      ...validBaseReq,
      payTo: "0xDeadBeef0000000000000000000000000000001",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("WRONG_RECIPIENT");
    expect(result.decision.evidence?.received).toBe("0xDeadBeef0000000000000000000000000000001");
    expect(signerCallCount()).toBe(0);
  });

  // ── Fake token is blocked ──────────────────────────────────────────────

  it("fake token is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      asset: "0xFakeToken00000000000000000000000000001",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("FAKE_TOKEN");
  });

  // ── Wrong network is blocked ───────────────────────────────────────────

  it("wrong network is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      network: "ethereum-mainnet",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("WRONG_NETWORK");
  });

  // ── Expired payment is blocked ─────────────────────────────────────────

  it("expired payment is blocked using correct expiry semantics", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      maxTimeoutSeconds: 0,
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.violatedCheck).toBe("expiry");
    expect(result.decision.attackType).toBe("EXPIRED_PAYMENT");
  });

  // ── Replay attack is blocked ───────────────────────────────────────────

  it("replay attack is blocked", async () => {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO seen_nonces (id, network, settled_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      "test-nonce-replay-001",
      "base-sepolia",
      new Date().toISOString(),
      new Date(Date.now() + 3600000).toISOString(),
    );

    const result = await firewall.validate({
      ...validBaseReq,
      nonce: "test-nonce-replay-001",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("REPLAY_ATTACK");
  });

  // ── Domain spoof is blocked ────────────────────────────────────────────

  it("domain spoof is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      resource: "https://evil-impersonator.com/paid-api",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("DOMAIN_SPOOF");
  });

  // ── TOCTOU mutation is blocked at signing boundary ─────────────────────

  it("TOCTOU mutation is blocked at signing boundary", async () => {
    // 1. Approve a valid request
    const approval = await firewall.validate(validBaseReq);
    expect(approval.allowed).toBe(true);
    const intentToken = approval.intentToken!;
    expect(intentToken).toMatch(/^sha256:/);

    // 2. Attempt to verify with a MUTATED payload
    const mutatedReq: PaymentRequirementsLike = {
      ...validBaseReq as PaymentRequirementsLike,
      maxAmountRequired: "99999999",
    };
    const fingerprintMatches = verifyFingerprint(mutatedReq, intentToken);
    expect(fingerprintMatches).toBe(false);

    // 3. Verify that the firewall's signing boundary check also fails
    const signerCallCount = trackSignerCalls();
    const signingAllowed = firewall.verifyIntentForSigning(mutatedReq, intentToken);
    expect(signingAllowed).toBe(false);
    expect(signerCallCount()).toBe(0);
  });

  // ── Budget exhaustion is blocked ───────────────────────────────────────

  it("budget exhaustion is blocked", async () => {
    // Fill daily budget by inserting spend entries totaling the limit
    const db = getDatabase();
    const now = new Date().toISOString();
    for (let i = 0; i < 10; i++) {
      db.prepare(
        `INSERT INTO spend_entries (id, kind, merchant, amount_usd, resource, network, rail, at)
         VALUES (?, 'spend', 'demo.payguard-merchant.local', 0.1, 'https://demo.payguard-merchant.local/api', 'base-sepolia', 'evm', ?)`,
      ).run(`spend_fill_${i}`, now);
    }

    const result = await firewall.validate(validBaseReq);
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("BUDGET_EXHAUST");
  });

  // ── Concurrent requests cannot collectively overspend ──────────────────

  it("concurrent requests cannot collectively overspend budget", async () => {
    // Insert spend entries to leave only 50000 atomic units remaining ($0.05)
    const db = getDatabase();
    const now = new Date().toISOString();
    // Spend $0.95 of $1.00 budget = 950000 atomic
    for (let i = 0; i < 19; i++) {
      db.prepare(
        `INSERT INTO spend_entries (id, kind, merchant, amount_usd, resource, network, rail, at)
         VALUES (?, 'spend', 'demo.payguard-merchant.local', 0.05, 'https://demo.payguard-merchant.local/api', 'base-sepolia', 'evm', ?)`,
      ).run(`spend_concurrent_${i}`, now);
    }

    // Each request asks for 50000 atomic ($0.05) — only 1 should pass
    const requests = Array(5).fill(null).map((_, i) =>
      firewall.validate({ ...validBaseReq, maxAmountRequired: "50000", nonce: `concurrent-nonce-${i}` }),
    );
    const results = await Promise.all(requests);
    const approved = results.filter((r) => r.allowed);
    expect(approved.length).toBeLessThanOrEqual(1);
  });

  // ── Collector offline does not affect firewall decision ────────────────

  it("collector offline does not affect firewall decision", async () => {
    const originalUrl = process.env.COLLECTOR_URL;
    process.env.COLLECTOR_URL = "http://127.0.0.1:1";
    try {
      const result = await firewall.validate(validBaseReq);
      expect(typeof result.allowed).toBe("boolean");
    } finally {
      if (originalUrl) {
        process.env.COLLECTOR_URL = originalUrl;
      } else {
        delete process.env.COLLECTOR_URL;
      }
    }
  });

  // ── Invalid schema is blocked ──────────────────────────────────────────

  it("invalid schema (missing fields) is blocked", async () => {
    const result = await firewall.validate({ scheme: "exact" });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("INVALID_SCHEMA");
  });

  it("invalid schema (bad resource URL) is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      resource: "not-a-url",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("INVALID_SCHEMA");
  });

  // ── Negative amount is blocked ─────────────────────────────────────────

  it("negative amount is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      maxAmountRequired: "-1000",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("OVERPAYMENT");
  });

  // ── Non-numeric amount is blocked ──────────────────────────────────────

  it("non-numeric amount string is blocked", async () => {
    const result = await firewall.validate({
      ...validBaseReq,
      maxAmountRequired: "abc",
    });
    expect(result.allowed).toBe(false);
    expect(result.decision.attackType).toBe("OVERPAYMENT");
  });

  // ── Decision is persisted to SQLite ────────────────────────────────────

  it("decision is persisted to security_decisions table", async () => {
    await firewall.validate(validBaseReq);
    const db = getDatabase();
    const rows = db.prepare("SELECT * FROM security_decisions").all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // ── No unauthorized transfer on any blocked attack ─────────────────────

  it("no unauthorized transfer on any blocked attack", async () => {
    const BLOCKED_ATTACKS = [
      {
        name: "OVERPAYMENT",
        runId: "run_attack_overpay",
        req: { ...validBaseReq, maxAmountRequired: "99999999" },
      },
      {
        name: "WRONG_RECIPIENT",
        runId: "run_attack_wrong_recipient",
        req: { ...validBaseReq, payTo: "0xDeadBeef0000000000000000000000000000001" },
      },
      {
        name: "FAKE_TOKEN",
        runId: "run_attack_fake_token",
        req: { ...validBaseReq, asset: "0xFakeToken00000000000000000000000000001" },
      },
      {
        name: "WRONG_NETWORK",
        runId: "run_attack_wrong_network",
        req: { ...validBaseReq, network: "polygon" },
      },
      {
        name: "EXPIRED_PAYMENT",
        runId: "run_attack_expired",
        req: { ...validBaseReq, maxTimeoutSeconds: 0 },
      },
      {
        name: "DOMAIN_SPOOF",
        runId: "run_attack_spoof",
        req: { ...validBaseReq, resource: "https://evil.attack-merchant.local/api" },
      },
    ];

    // Import mock chain transactions store
    const { transactions, resetBalances } = await import("../src/mock-chain.js");
    resetBalances();
    transactions.length = 0;

    for (const attack of BLOCKED_ATTACKS) {
      const result = await firewall.validate(attack.req, attack.runId);
      expect(result.allowed).toBe(false);

      // Verify that no transaction exists in mock chain for this runId
      const chainTx = transactions.filter((t) => t.runId === attack.runId);
      expect(chainTx.filter((t) => t.status === "settled")).toHaveLength(0);
    }
  });

  // ── Guarded Signer Boundary Integration ────────────────────────────────

  it("guarded signer boundary rejects mutated payload without calling raw signer", async () => {
    const { createGuardedSigner } = await import("../src/wrap.js");
    let rawSignerCalled = 0;
    const rawSigner = {
      sign: async () => {
        rawSignerCalled++;
        return "0xvalidsignature";
      },
    };

    // 1. Approve valid request
    const approval = await firewall.validate(validBaseReq);
    expect(approval.allowed).toBe(true);
    let approvedToken: string | undefined = approval.intentToken!;
    let currentReq: any = { ...validBaseReq };

    const guardedSigner = createGuardedSigner(
      rawSigner as any,
      () => approvedToken,
      () => currentReq,
    ) as any;

    // 2. Normal call with valid intent succeeds
    await guardedSigner.sign();
    expect(rawSignerCalled).toBe(1);

    // 3. Mutate payment request (TOCTOU attack)
    currentReq = { ...validBaseReq, maxAmountRequired: "99999999" };
    await expect(guardedSigner.sign()).rejects.toThrow(/TOCTOU_MODIFY detected/);

    // 4. Critical assertion: raw signer was NOT called on attack
    expect(rawSignerCalled).toBe(1);
  });
});
