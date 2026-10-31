/**
 * Automated tests for Red Team components:
 *   - Attack scenarios (A01–A10) catalog and alias resolution
 *   - Classification engine (strict rules, signer separation, funds verification)
 *   - Programmatic assertion that signer was NOT invoked on blocked payments
 *   - UCB1 adaptive attack selector
 *   - Mutation fuzzer generators and categories
 *   - CORS origin parsing
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SCENARIOS,
  SCENARIO_CATALOG,
  VALID_BASE,
  getCatalogEntry,
  getScenario,
  normalizeScenarioId,
  isSimplePayload,
  isTOCTOU,
  isSequential,
} from "../src/red/scenarios.js";

import { classify, classifyAsError } from "../src/red/classify.js";
import { createUCB1State, selectArm, updateArm } from "../src/red/ucb1.js";
import { MUTATION_CATALOG, generateFuzzedMutations } from "../src/red/fuzzer.js";
import { parseCorsOrigins } from "../src/red/config.js";

describe("Red Team: Attack Scenarios Catalog (A01–A10)", () => {
  it("defines exactly 10 scenarios in SCENARIOS and catalog", () => {
    assert.equal(Object.keys(SCENARIOS).length, 10);
    assert.equal(SCENARIO_CATALOG.length, 10);
  });

  it("includes all 10 scenario IDs", () => {
    const expectedIds = [
      "A01_OVERPAY",
      "A02_WRONG_PAYTO",
      "A03_FAKE_TOKEN",
      "A04_WRONG_NETWORK",
      "A05_EXPIRED",
      "A06_REPLAY",
      "A07_DOMAIN_SPOOF",
      "A08_TOCTOU",
      "A09_BUDGET_EXHAUST",
      "A10_VALID",
    ];

    for (const id of expectedIds) {
      assert.ok(SCENARIOS[id], `Missing scenario: ${id}`);
      const entry = getCatalogEntry(id);
      assert.ok(entry, `Missing catalog entry: ${id}`);
      assert.equal(entry.id, id);
    }
  });

  it("marks A10_VALID as the control with expectedDecision ALLOW", () => {
    const a10 = getCatalogEntry("A10_VALID");
    assert.ok(a10);
    assert.equal(a10.expectedDecision, "ALLOW");
    assert.equal(a10.signerShouldBeCalled, true);
    assert.equal(a10.fundsShouldMove, true);
    assert.equal(a10.threatLevel, "NONE");
    assert.equal(a10.mutatedField, null);
  });

  it("marks all attack scenarios A01–A09 with expectedDecision BLOCK", () => {
    const attacks = SCENARIO_CATALOG.filter((s) => s.id !== "A10_VALID");
    assert.equal(attacks.length, 9);

    for (const attack of attacks) {
      assert.equal(attack.expectedDecision, "BLOCK", `${attack.id} expected decision`);
      assert.equal(attack.signerShouldBeCalled, false, `${attack.id} signer should not be called`);
      assert.equal(attack.fundsShouldMove, false, `${attack.id} funds should not move`);
      assert.notEqual(attack.threatLevel, "NONE", `${attack.id} threat level`);
    }
  });

  it("resolves user-friendly aliases to canonical scenario IDs", () => {
    assert.equal(normalizeScenarioId("VALID"), "A10_VALID");
    assert.equal(normalizeScenarioId("a10"), "A10_VALID");
    assert.equal(normalizeScenarioId("OVERPAY"), "A01_OVERPAY");
    assert.equal(normalizeScenarioId("a01"), "A01_OVERPAY");
    assert.equal(normalizeScenarioId("WRONG_PAYTO"), "A02_WRONG_PAYTO");
    assert.equal(normalizeScenarioId("toctou"), "A08_TOCTOU");
    assert.equal(normalizeScenarioId("budget_exhaust"), "A09_BUDGET_EXHAUST");

    assert.ok(getScenario("VALID"));
    assert.ok(getScenario("OVERPAY"));
    assert.ok(getCatalogEntry("VALID"));
  });

  it("identifies compound attack structures correctly", () => {
    const toctou = getScenario("A08_TOCTOU");
    assert.ok(toctou && isTOCTOU(toctou));
    assert.equal(toctou.mutatedReq.maxAmountRequired, "9999999");

    const seq = getScenario("A09_BUDGET_EXHAUST");
    assert.ok(seq && isSequential(seq));
    assert.equal(seq.repeatUntilBlocked, true);

    const simple = getScenario("A01_OVERPAY");
    assert.ok(simple && isSimplePayload(simple));
  });
});

describe("Red Team: Strict Classification & Separation of Events", () => {
  it("classifies legitimate payment correctly (VALID_SUCCESS)", () => {
    const result = classify(
      "A10_VALID",
      { allowed: true },
      { invoked: true, source: "audit_log" },
      { fundsTransferred: true, txHash: "0xMOCK_TX", source: "mock_chain" },
    );
    assert.equal(result, "VALID_SUCCESS");
  });

  it("classifies over-blocked legitimate payment as FALSE_POSITIVE", () => {
    const result = classify(
      "A10_VALID",
      { allowed: false },
      { invoked: false, source: "audit_log" },
      { fundsTransferred: false, txHash: null, source: "mock_chain" },
    );
    assert.equal(result, "FALSE_POSITIVE");
  });

  it("classifies properly blocked attack as ATTACK_BLOCKED when signer was NOT invoked", () => {
    const result = classify(
      "A01_OVERPAY",
      { allowed: false },
      { invoked: false, source: "audit_log" },
      { fundsTransferred: false, txHash: null, source: "mock_chain" },
    );
    assert.equal(result, "ATTACK_BLOCKED");
  });

  it("GLOBAL RULE 15: refuses ATTACK_BLOCKED if signer was actually invoked", () => {
    // If Blue said allowed: false, BUT the signer was invoked, this is a security failure
    const result = classify(
      "A01_OVERPAY",
      { allowed: false },
      { invoked: true, source: "audit_log" },
      { fundsTransferred: false, txHash: null, source: "mock_chain" },
    );
    assert.notEqual(result, "ATTACK_BLOCKED");
    assert.equal(result, "ATTACK_BYPASS");
  });

  it("flags ATTACK_BYPASS when Blue allows a malicious scenario", () => {
    const result = classify(
      "A02_WRONG_PAYTO",
      { allowed: true },
      { invoked: true, source: "audit_log" },
      { fundsTransferred: false, txHash: null, source: "mock_chain" },
    );
    assert.equal(result, "ATTACK_BYPASS");
  });

  it("CRITICAL: flags FUNDS_LOST when mock chain confirms balance change on attack", () => {
    const result = classify(
      "A03_FAKE_TOKEN",
      { allowed: false },
      { invoked: false, source: "audit_log" },
      { fundsTransferred: true, txHash: "0xMOCK_ILLEGAL_TX", source: "mock_chain" },
    );
    assert.equal(result, "FUNDS_LOST");
  });

  it("classifies network errors as ATTACK_ERROR, not as a successful defense", () => {
    const result = classify(
      "A01_OVERPAY",
      null,
      { invoked: false, source: "unavailable" },
      { fundsTransferred: false, txHash: null, source: "unavailable" },
    );
    assert.equal(result, "ATTACK_ERROR");
  });

  it("builds structured error results with classifyAsError", () => {
    const err = classifyAsError("run-123", "A01_OVERPAY", "timeout");
    assert.equal(err.classification, "ATTACK_ERROR");
    assert.equal(err.runId, "run-123");
    assert.equal(err.error, "timeout");
  });
});

describe("Red Team: UCB1 Adaptive Attack Selector", () => {
  it("initializes an arm for every malicious scenario with infinite score", () => {
    const state = createUCB1State();
    assert.equal(state.arms.length, 9); // 9 malicious scenarios
    assert.equal(state.totalPulls, 0);

    for (const arm of state.arms) {
      assert.equal(arm.pulls, 0);
      assert.equal(arm.ucbScore, Infinity);
    }
  });

  it("pulls all unpulled arms in round-robin exploration first", () => {
    let state = createUCB1State();
    const pulledArms: string[] = [];

    for (let i = 0; i < state.arms.length; i++) {
      const selected = selectArm(state);
      pulledArms.push(selected);
      state = updateArm(state, selected, "ATTACK_BLOCKED");
    }

    assert.equal(new Set(pulledArms).size, 9);
    assert.equal(state.totalPulls, 9);
  });

  it("favors arms with successful bypasses after initial exploration", () => {
    let state = createUCB1State();

    // Pull each arm once: A01 gets a BYPASS, others get BLOCKED
    for (const arm of state.arms) {
      const outcome = arm.attackId === "A01_OVERPAY" ? "ATTACK_BYPASS" : "ATTACK_BLOCKED";
      state = updateArm(state, arm.attackId, outcome);
    }

    // Next arm chosen should exploit A01_OVERPAY because it had reward 1.0 vs 0.0
    const nextArm = selectArm(state);
    assert.equal(nextArm, "A01_OVERPAY");
  });
});

describe("Red Team: Mutation Fuzzer", () => {
  it("catalog defines mutations across multiple vulnerability categories", () => {
    const categories = new Set(MUTATION_CATALOG.map((m) => m.category));
    assert.ok(categories.has("amount"));
    assert.ok(categories.has("payTo"));
    assert.ok(categories.has("asset"));
    assert.ok(categories.has("network"));
    assert.ok(categories.has("timeout"));
    assert.ok(categories.has("resource"));
    assert.ok(categories.has("scheme"));
    assert.ok(categories.has("multi"));
    assert.ok(MUTATION_CATALOG.length >= 20);
  });

  it("generates fuzzed payloads preserving base properties while mutating target fields", () => {
    const mutations = generateFuzzedMutations();
    assert.equal(mutations.length, MUTATION_CATALOG.length);

    for (const mut of mutations) {
      assert.ok(mut.mutationId);
      assert.ok(mut.payload);
      assert.ok(mut.payload.scheme);
      assert.ok(mut.payload.network);
    }
  });
});

describe("Red Team: CORS Configuration", () => {
  it("parses wildcard and exact origin patterns correctly", () => {
    const origins = parseCorsOrigins("https://*.lovable.app,http://localhost:5173,http://localhost:3000");
    assert.equal(origins.length, 3);

    // Wildcard RegExp pattern
    const lovableRegex = origins[0] as RegExp;
    assert.ok(lovableRegex instanceof RegExp);
    assert.ok(lovableRegex.test("https://preview.lovable.app"));
    assert.ok(lovableRegex.test("https://app.lovable.app"));
    assert.ok(!lovableRegex.test("http://evil.com"));

    // Exact string origins
    assert.equal(origins[1], "http://localhost:5173");
    assert.equal(origins[2], "http://localhost:3000");
  });
});

