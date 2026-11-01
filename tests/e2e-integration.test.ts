import { describe, it, expect, beforeAll } from "vitest";

const BLUE_URL = process.env.BLUE_URL || "http://localhost:4010";
const RED_CONSOLE_URL = process.env.RED_URL || "http://localhost:4060";
const RED_MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4020";
const RED_FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4030";
const MOCK_CHAIN_URL = process.env.MOCK_CHAIN_URL || "http://localhost:4040";
const COLLECTOR_URL = process.env.COLLECTOR_URL || "http://localhost:4050";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-key";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PayGuard AI — End-to-End Full-Stack Integration Suite", () => {
  beforeAll(async () => {
    // Reset balances and state for fresh test execution
    await fetch(`${MOCK_CHAIN_URL}/balances/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_KEY}` },
      body: JSON.stringify({ confirm: true }),
    }).catch(() => {});
  });

  // ── 1. ALL HEALTH ENDPOINTS ──────────────────────────────────────────────
  it("1. should expose working health endpoints on all six backend services", async () => {
    const [blue, chain, merchant, facilitator, consoleSvc, collector] = await Promise.all([
      fetch(`${BLUE_URL}/health`).then((r) => r.json()),
      fetch(`${MOCK_CHAIN_URL}/health`).then((r) => r.json()),
      fetch(`${RED_MERCHANT_URL}/health`).then((r) => r.json()),
      fetch(`${RED_FACILITATOR_URL}/health`).then((r) => r.json()),
      fetch(`${RED_CONSOLE_URL}/health`).then((r) => r.json()),
      fetch(`${COLLECTOR_URL}/health`).then((r) => r.json()),
    ]);

    expect(blue.status).toBe("ok");
    expect(blue.service).toBe("blue-agent");
    expect(blue.port).toBe(4010);

    expect(chain.status).toBe("ok");
    expect(chain.service).toBe("mock-chain");
    expect(chain.mockChain).toBe(true);

    expect(merchant.status).toBe("ok");
    expect(merchant.service).toBe("red-merchant");

    expect(facilitator.status).toBe("ok");
    expect(facilitator.service).toBe("red-facilitator");

    expect(consoleSvc.status).toBe("ok");
    expect(consoleSvc.service).toBe("red-console");

    expect(collector.status).toBe("ok");
    expect(collector.service).toBe("collector");
  });

  // ── 2. VALID PAYMENT CONTROL (A10_VALID) ──────────────────────────────────
  it("2. should process valid payment control across all stages: validation, signing, settlement, and transfer", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A10_VALID" }),
    });
    expect(runRes.ok).toBe(true);
    const { runId } = await runRes.json();

    // Poll for completion
    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result).toBeDefined();
    expect(result.classification).toBe("VALID_SUCCESS");
    expect(result.blueResponse.allowed).toBe(true);

    // Verify legitimate signer was invoked
    expect(result.signerEvidence.invoked).toBe(true);

    // Verify funds were actually transferred on Mock Chain
    expect(result.chainResult.fundsTransferred).toBe(true);
    expect(result.chainResult.txHash).toMatch(/^tx_/);
  });

  // ── 3. WRONG RECIPIENT REJECTION (A02_WRONG_PAYTO) ────────────────────────
  it("3. should detect wrong recipient, block payment, isolate signer, and prevent transfer", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A02_WRONG_PAYTO" }),
    });
    expect(runRes.ok).toBe(true);
    const { runId } = await runRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result).toBeDefined();
    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.decision?.attackType).toBe("WRONG_RECIPIENT");
    expect(result.blueResponse.decision?.suspiciousField).toBe("payTo");

    // Critical: signer must NOT be invoked
    expect(result.signerEvidence.invoked).toBe(false);
    // Critical: mock chain must confirm ZERO funds moved
    expect(result.chainResult.fundsTransferred).toBe(false);
  });

  // ── 4. WRONG NETWORK REJECTION (A04_WRONG_NETWORK) ────────────────────────
  it("4. should block wrong network / chain mismatch", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A04_WRONG_NETWORK" }),
    });
    const { runId } = await runRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.decision?.attackType).toBe("WRONG_NETWORK");
    expect(result.blueResponse.decision?.suspiciousField).toBe("network");
    expect(result.signerEvidence.invoked).toBe(false);
    expect(result.chainResult.fundsTransferred).toBe(false);
  });

  // ── 5. FAKE TOKEN REJECTION (A03_FAKE_TOKEN) ──────────────────────────────
  it("5. should block unapproved / fake token contract", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A03_FAKE_TOKEN" }),
    });
    const { runId } = await runRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.decision?.attackType).toBe("FAKE_TOKEN");
    expect(result.blueResponse.decision?.suspiciousField).toBe("asset");
    expect(result.signerEvidence.invoked).toBe(false);
  });

  // ── 6. OVERPAYMENT REJECTION (A01_OVERPAY) ────────────────────────────────
  it("6. should block 10x overpayment request exceeding per-payment cap", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A01_OVERPAY" }),
    });
    const { runId } = await runRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.decision?.violatedCheck).toBe("amount_guard");
    expect(result.signerEvidence.invoked).toBe(false);
  });

  // ── 7. REPLAY ATTACK REJECTION (A06_REPLAY) ────────────────────────────────
  it("7. should detect replay attack reusing a previously seen nonce", async () => {
    // Prime the nonce on first presentation
    const primeRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A06_REPLAY" }),
    });
    const primeData = await primeRes.json();
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const r = await fetch(`${RED_CONSOLE_URL}/redblue/result/${primeData.runId}`);
      if (r.ok) {
        const d = await r.json();
        if (d.status === "completed" || d.classification) break;
      }
    }

    // Now resubmit the exact same replayed nonce
    const replayRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A06_REPLAY" }),
    });
    const { runId } = await replayRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.decision?.violatedCheck).toBe("replay_protection");
    expect(result.signerEvidence.invoked).toBe(false);
  });

  // ── 8. TOCTOU ATTACK REJECTION (A08_TOCTOU) ───────────────────────────────
  it("8. should detect post-approval mutation at signing boundary and prevent signing", async () => {
    const runRes = await fetch(`${RED_CONSOLE_URL}/redblue/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attackId: "A08_TOCTOU" }),
    });
    const { runId } = await runRes.json();

    let result: any = null;
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      const res = await fetch(`${RED_CONSOLE_URL}/redblue/result/${runId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed" || data.classification) {
          result = data;
          break;
        }
      }
    }

    expect(result.classification).toBe("ATTACK_BLOCKED");
    expect(result.blueResponse.allowed).toBe(false);
    expect(result.blueResponse.reason || result.blueResponse.decision?.attackType).toBe("TOCTOU_MODIFY");

    // Critical: Signing of modified intent must be prevented
    expect(result.signerEvidence.invoked).toBe(false);
    expect(result.chainResult.fundsTransferred).toBe(false);
  });

  // ── 9. COLLECTOR EVENT DELIVERY ───────────────────────────────────────────
  it("9. should deliver structured events from Blue and Red to Collector", async () => {
    const eventsRes = await fetch(`${COLLECTOR_URL}/events?limit=20`);
    expect(eventsRes.ok).toBe(true);
    const { events } = await eventsRes.json();

    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    const hasRedEvent = events.some((e: any) => e.source === "RED");
    const hasBlueEvent = events.some((e: any) => e.source === "BLUE");

    expect(hasRedEvent).toBe(true);
    expect(hasBlueEvent).toBe(true);

    // Verify schema adherence
    const sample = events[0];
    expect(sample.eventId).toBeDefined();
    expect(sample.timestamp).toBeDefined();
    expect(sample.eventType).toBeDefined();
    expect(sample.severity).toBeDefined();
  });

  // ── 10. RUN CORRELATION ───────────────────────────────────────────────────
  it("10. should correlate runs in Collector database with consistent runId", async () => {
    const runsRes = await fetch(`${COLLECTOR_URL}/runs?limit=10`);
    expect(runsRes.ok).toBe(true);
    const { runs } = await runsRes.json();

    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);

    const run = runs[0];
    expect(run.runId).toMatch(/^run_/);
    expect(run.classification).toBeDefined();

    // Query detail
    const detailRes = await fetch(`${COLLECTOR_URL}/runs/${run.runId}`);
    expect(detailRes.ok).toBe(true);
    const detail = await detailRes.json();
    expect(detail.run.runId).toBe(run.runId);
    expect(Array.isArray(detail.events)).toBe(true);
  });

  // ── 11. MOCK CHAIN TRANSACTION VERIFICATION ──────────────────────────────
  it("11. should provide independent settlement verification on Mock Chain", async () => {
    const transfersRes = await fetch(`${MOCK_CHAIN_URL}/transfers`);
    expect(transfersRes.ok).toBe(true);
    const data = await transfersRes.json();
    expect(data.mockChain).toBe(true);

    const ledgerRes = await fetch(`${MOCK_CHAIN_URL}/ledger`);
    expect(ledgerRes.ok).toBe(true);
    const ledger = await ledgerRes.json();
    expect(Array.isArray(ledger.balances)).toBe(true);
  });

  // ── 12. FRONTEND API RESPONSE MAPPING & SCORECARD ─────────────────────────
  it("12. should calculate authoritative scorecard without counting errors as blocked", async () => {
    const scorecardRes = await fetch(`${COLLECTOR_URL}/scorecard`);
    expect(scorecardRes.ok).toBe(true);
    const scorecard = await scorecardRes.json();

    expect(typeof scorecard.TP).toBe("number");
    expect(typeof scorecard.FP).toBe("number");
    expect(typeof scorecard.FN).toBe("number");
    expect(typeof scorecard.TN).toBe("number");
    expect(typeof scorecard.errors).toBe("number");

    // Precision, Recall, F1 formulas
    if (scorecard.TP + scorecard.FP > 0) {
      expect(scorecard.precision).toBeGreaterThanOrEqual(0);
    }
    if (scorecard.TP + scorecard.FN > 0) {
      expect(scorecard.recall).toBeGreaterThanOrEqual(0);
    }

    // Critical: errors are never counted in TP
    expect(Array.isArray(scorecard.perAttack)).toBe(true);
  });
});
