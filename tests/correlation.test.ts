import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CollectorDatabase } from "../src/collector/db.js";
import { correlateEvent } from "../src/collector/correlation.js";
import type { CollectorEvent } from "../src/collector/types.js";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "./data/test-correlation.db";

function makeEvent(
  eventType: string,
  source: string,
  runId: string,
  attackId: string | null = null,
  message: string = "",
  data: Record<string, unknown> = {},
  timestampOffsetMs: number = 0,
): CollectorEvent {
  const ts = new Date(Date.now() + timestampOffsetMs).toISOString();
  return {
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    runId,
    source,
    eventType,
    severity: "INFO",
    attackId,
    message: message || `${source} ${eventType}`,
    data,
    receivedAt: ts,
  };
}

describe("Event Correlation & Strict Segregation", () => {
  let db: CollectorDatabase;

  beforeEach(() => {
    for (const ext of ["", "-shm", "-wal"]) {
      if (existsSync(TEST_DB + ext)) {
        try { unlinkSync(TEST_DB + ext); } catch {}
      }
    }
    db = new CollectorDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
    for (const ext of ["", "-shm", "-wal"]) {
      if (existsSync(TEST_DB + ext)) {
        try { unlinkSync(TEST_DB + ext); } catch {}
      }
    }
  });

  it("correlates full attack lifecycle: ATTACK_STARTED → ATTACK_SENT → PAYMENT_BLOCKED → NO_TRANSFER → ATTACK_COMPLETED", () => {
    const runId = "run_attack_a01_test";
    const attackId = "A01_OVERPAY";

    // 1. Red starts attack
    const evt1 = makeEvent("ATTACK_STARTED", "RED", runId, attackId, "Attack started", {}, 0);
    db.insertEvent(evt1);
    correlateEvent(db, evt1);

    // 2. Red sends attack
    const evt2 = makeEvent("ATTACK_SENT", "RED", runId, attackId, "Attack sent to Blue", {}, 10);
    db.insertEvent(evt2);
    correlateEvent(db, evt2);

    // 3. Blue firewall blocks payment
    const evt3 = makeEvent("PAYMENT_BLOCKED", "BLUE", runId, attackId, "Blocked: OVERPAYMENT", {
      attackType: "OVERPAYMENT",
      violatedCheck: "amount_guard",
      latencyMs: 5,
    }, 20);
    db.insertEvent(evt3);
    correlateEvent(db, evt3);

    // 4. Mock chain verifies no transfer
    const evt4 = makeEvent("NO_TRANSFER", "CHAIN", runId, null, "No funds moved", {}, 30);
    db.insertEvent(evt4);
    correlateEvent(db, evt4);

    // 5. Red completes attack
    const evt5 = makeEvent("ATTACK_COMPLETED", "RED", runId, attackId, "Attack completed", {
      classification: "ATTACK_BLOCKED",
    }, 40);
    db.insertEvent(evt5);
    correlateEvent(db, evt5);

    const run = db.getRunById(runId);
    expect(run).toBeDefined();
    expect(run?.runId).toBe(runId);
    expect(run?.attackId).toBe(attackId);
    expect(run?.blueDecision).toBe("BLOCK");
    expect(run?.chainTransfer).toBe(0);
    expect(run?.signerInvoked).toBeNull(); // Signer was NEVER invoked
    expect(run?.classification).toBe("ATTACK_BLOCKED");
    expect(typeof run?.latencyMs).toBe("number");
  });

  it("correlates legitimate payment lifecycle: PAYMENT_APPROVED → SIGNER_INVOKED → SIGNATURE_CREATED → SETTLEMENT_ATTEMPTED → FUNDS_TRANSFERRED", () => {
    const runId = "run_legit_control_test";
    const attackId = "A10_VALID";

    // 1. Attack started (control)
    const e1 = makeEvent("ATTACK_STARTED", "RED", runId, attackId, "Valid control started", {}, 0);
    db.insertEvent(e1);
    correlateEvent(db, e1);

    // 2. Blue firewall approves
    const e2 = makeEvent("PAYMENT_APPROVED", "BLUE", runId, attackId, "Payment approved", {}, 5);
    db.insertEvent(e2);
    correlateEvent(db, e2);

    // 3. Signer invoked
    const e3 = makeEvent("SIGNER_INVOKED", "BLUE", runId, attackId, "Signer called", {}, 10);
    db.insertEvent(e3);
    correlateEvent(db, e3);

    // 4. Signature created
    const e4 = makeEvent("SIGNATURE_CREATED", "BLUE", runId, attackId, "Signature created", {}, 15);
    db.insertEvent(e4);
    correlateEvent(db, e4);

    // 5. Settlement attempted
    const e5 = makeEvent("SETTLEMENT_ATTEMPTED", "BLUE", runId, attackId, "Settlement attempted", {}, 20);
    db.insertEvent(e5);
    correlateEvent(db, e5);

    // 6. Chain transfers funds
    const e6 = makeEvent("FUNDS_TRANSFERRED", "CHAIN", runId, null, "Transfer confirmed", { amountAtomic: "100000" }, 30);
    db.insertEvent(e6);
    correlateEvent(db, e6);

    // 7. Completed
    const e7 = makeEvent("ATTACK_COMPLETED", "RED", runId, attackId, "Legitimate completed", {
      classification: "VALID_SUCCESS",
    }, 35);
    db.insertEvent(e7);
    correlateEvent(db, e7);

    const run = db.getRunById(runId);
    expect(run).toBeDefined();
    expect(run?.blueDecision).toBe("ALLOW");
    expect(run?.signerInvoked).toBe(1);
    expect(run?.chainTransfer).toBe(1);
    expect(run?.classification).toBe("VALID_SUCCESS");
  });

  it("strictly separates approval from settlement: approval alone does not move funds", () => {
    const runId = "run_bypass_without_transfer";
    const attackId = "A04_WRONG_NETWORK";

    // Blue incorrectly approved (simulated bypass)
    const e1 = makeEvent("ATTACK_STARTED", "RED", runId, attackId, "Started", {}, 0);
    db.insertEvent(e1);
    correlateEvent(db, e1);

    const e2 = makeEvent("PAYMENT_APPROVED", "BLUE", runId, attackId, "Allowed", {}, 5);
    db.insertEvent(e2);
    correlateEvent(db, e2);

    // Mock chain failed settlement (no funds transferred)
    const e3 = makeEvent("NO_TRANSFER", "CHAIN", runId, null, "Transfer failed on chain", {}, 10);
    db.insertEvent(e3);
    correlateEvent(db, e3);

    const e4 = makeEvent("ATTACK_COMPLETED", "RED", runId, attackId, "Completed", {}, 15);
    db.insertEvent(e4);
    correlateEvent(db, e4);

    const run = db.getRunById(runId);
    expect(run?.blueDecision).toBe("ALLOW");
    expect(run?.chainTransfer).toBe(0); // Chain did NOT move funds
    expect(run?.classification).toBe("ATTACK_BYPASS"); // Bypass, but NOT FUNDS_LOST!
  });
});
