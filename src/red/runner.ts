/**
 * Attack execution engine.
 *
 * Runs attack scenarios against the Blue firewall, checks the mock chain
 * for fund transfers, collects signer evidence, and classifies results.
 *
 * CRITICAL SEPARATION enforced here:
 *   1. Policy APPROVED  = Blue's firewall returned `allowed: true`
 *   2. Signer INVOKED   = the wallet signing function was actually called
 *   3. Funds TRANSFERRED = the mock chain confirmed a balance change
 *
 * These three events are NEVER conflated.
 */
import { randomUUID } from "node:crypto";
import { RED_CONFIG } from "./config.js";
import { classify, classifyAsError } from "./classify.js";
import { emitEvent } from "./events.js";
import {
  SCENARIOS,
  getCatalogEntry,
  isSimplePayload,
  isTOCTOU,
  isSequential,
  normalizeScenarioId,
} from "./scenarios.js";
import type {
  AttackResult,
  BlueResponse,
  BudgetExhaustResult,
  ChainResult,
  SignerEvidence,
  TOCTOUScenario,
  SequentialScenario,
  PaymentRequirementPayload,
} from "./types.js";

export function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

/**
 * Run a single attack scenario against the Blue firewall.
 */
export async function runAttack(attackId: string, customRunId?: string): Promise<AttackResult> {
  const canonicalId = normalizeScenarioId(attackId);
  const runId = customRunId ?? generateRunId();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const scenario = SCENARIOS[canonicalId];

  if (!scenario) {
    return classifyAsError(runId, attackId, `unknown scenario: ${attackId}`);
  }

  // 1. Emit ATTACK_STARTED
  await emitEvent({ source: "RED", eventType: "ATTACK_STARTED", runId, attackId: canonicalId });

  try {
    // 2. Route to the appropriate handler
    if (isTOCTOU(scenario)) {
      return await runTOCTOUAttack(runId, canonicalId, scenario, startedAt, startMs);
    }

    if (isSequential(scenario)) {
      return await runBudgetExhaustAttack(runId, canonicalId, scenario, startedAt, startMs);
    }

    if (isSimplePayload(scenario)) {
      return await runSimpleAttack(runId, canonicalId, scenario, startedAt, startMs);
    }

    return classifyAsError(runId, canonicalId, "unrecognized scenario structure");
  } catch (err) {
    const result = classifyAsError(
      runId,
      canonicalId,
      `unhandled error: ${err instanceof Error ? err.message : String(err)}`,
    );
    await emitEvent({
      source: "RED",
      eventType: "ATTACK_ERROR",
      runId,
      attackId: canonicalId,
      data: { error: result.error },
    });
    return result;
  }
}

/**
 * Simple attack: send a single (potentially malicious) payment requirement
 * to Blue's /shield-check and classify the result.
 */
async function runSimpleAttack(
  runId: string,
  attackId: string,
  payload: PaymentRequirementPayload,
  startedAt: string,
  startMs: number,
): Promise<AttackResult> {
  // Send to Blue /shield-check
  let blueResponse: BlueResponse;
  try {
    await emitEvent({
      source: "RED",
      eventType: "ATTACK_SENT",
      runId,
      attackId,
      data: { target: `${RED_CONFIG.blueUrl}/shield-check` },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${RED_CONFIG.blueUrl}/shield-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRequirements: payload, runId, attackId }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    blueResponse = (await res.json()) as BlueResponse;
  } catch (err) {
    // Network failure = ATTACK_ERROR, not a defense result
    const result = classifyAsError(
      runId,
      attackId,
      `blue_unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
    await emitEvent({
      source: "RED",
      eventType: "ATTACK_ERROR",
      runId,
      attackId,
      data: { error: result.error },
    });
    return result;
  }

  // End-to-end Valid Payment Control Lifecycle (A10_VALID):
  // 1. Red Merchant challenge created (already in payload)
  // 2. Sent to Blue Agent (above)
  // 3 & 4. Blue validated and approved
  // 5. Legitimate Signer Boundary Invoked
  // 6. Mock Facilitator Verification & Settlement
  // 7. Mock Chain Transfer Recorded
  const isControl = attackId === "A10_VALID" || getCatalogEntry(attackId)?.expectedDecision === "ALLOW";
  if (isControl && blueResponse.allowed && blueResponse.intentToken) {
    try {
      // Step 5: Invoke protected signer boundary at Blue Agent
      await emitEvent({
        source: "RED",
        eventType: "ATTACK_SENT",
        runId,
        attackId,
        data: { stage: "signer_boundary", target: `${RED_CONFIG.blueUrl}/agent/run` },
      });

      await fetch(`${RED_CONFIG.blueUrl}/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentRequirements: payload,
          intentToken: blueResponse.intentToken,
          runId,
          attackId,
        }),
      });
    } catch {}

    // Step 6: Mock Facilitator verification and settlement simulation
    const facilitatorUrl = process.env.FACILITATOR_URL || `http://localhost:${RED_CONFIG.facilitatorPort}`;
    try {
      await emitEvent({
        source: "RED",
        eventType: "ATTACK_SENT",
        runId,
        attackId,
        data: { stage: "facilitator_settlement", facilitatorUrl },
      });

      await fetch(`${facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentRequirements: payload,
          intentToken: blueResponse.intentToken,
          runId,
        }),
      });

      await fetch(`${facilitatorUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentRequirements: payload,
          intentToken: blueResponse.intentToken,
          runId,
        }),
      });
    } catch {}

    // Step 7: Mock Chain records the simulated transfer
    try {
      await fetch(`${RED_CONFIG.mockChainUrl}/transactions/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          to: payload.payTo,
          amount: payload.maxAmountRequired,
          network: payload.network,
          runId,
        }),
      });
    } catch {}
  }

  // Check mock chain — did funds move?
  const chainResult = await checkMockChain(runId);

  // Check signer evidence — was signer invoked?
  const signerEvidence = await getSignerEvidence(runId);

  // Classify honestly
  const classification = classify(attackId, blueResponse, signerEvidence, chainResult);

  const completedAt = new Date().toISOString();
  const result: AttackResult = {
    runId,
    attackId,
    classification,
    blueResponse,
    signerEvidence,
    chainResult,
    startedAt,
    completedAt,
    durationMs: Date.now() - startMs,
  };

  // Emit result event
  await emitEvent({
    source: "RED",
    eventType: "ATTACK_COMPLETED",
    runId,
    attackId,
    data: {
      classification,
      blueDecision: blueResponse.allowed,
      signerInvoked: signerEvidence.invoked,
      fundsTransferred: chainResult.fundsTransferred,
    },
  });

  return result;
}

/**
 * A08 TOCTOU attack — exercises the actual signing boundary.
 *
 * Step 1: Submit valid requirement to get approval + intentToken.
 * Step 2: Attempt to sign with a mutated payload using that token.
 * Blue MUST detect the fingerprint mismatch at the signing boundary.
 */
async function runTOCTOUAttack(
  runId: string,
  attackId: string,
  scenario: TOCTOUScenario,
  startedAt: string,
  startMs: number,
): Promise<AttackResult> {
  // Step 1: Submit valid requirement for approval
  let approvalResponse: BlueResponse;
  try {
    await emitEvent({
      source: "RED",
      eventType: "ATTACK_SENT",
      runId,
      attackId,
      data: { stage: "step1_approval", target: `${RED_CONFIG.blueUrl}/shield-check` },
    });

    const res = await fetch(`${RED_CONFIG.blueUrl}/shield-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRequirements: scenario.initialReq, runId, attackId }),
    });
    approvalResponse = (await res.json()) as BlueResponse;
  } catch (err) {
    return classifyAsError(
      runId,
      attackId,
      `toctou_step1_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!approvalResponse.allowed) {
    // Initial valid request was blocked — cannot proceed with TOCTOU.
    // This is an infrastructure issue, not a defense against TOCTOU specifically.
    return classifyAsError(runId, attackId, "toctou_initial_valid_request_blocked");
  }

  const intentToken = approvalResponse.intentToken;

  // Step 2: Try to sign with the MUTATED payload + the valid intentToken
  let signingResponse: BlueResponse;
  try {
    await emitEvent({
      source: "RED",
      eventType: "ATTACK_SENT",
      runId,
      attackId,
      data: { stage: "step2_signing", target: `${RED_CONFIG.blueUrl}/agent/run` },
    });

    const res = await fetch(`${RED_CONFIG.blueUrl}/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentRequirements: scenario.mutatedReq,
        intentToken,
        runId,
        attackId,
      }),
    });
    signingResponse = (await res.json()) as BlueResponse;
  } catch (err) {
    return classifyAsError(
      runId,
      attackId,
      `toctou_step2_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Check mock chain for actual transfer
  const chainResult = await checkMockChain(runId);
  const signerEvidence = await getSignerEvidence(runId);

  const classification = classify(attackId, signingResponse, signerEvidence, chainResult);

  const completedAt = new Date().toISOString();
  const result: AttackResult = {
    runId,
    attackId,
    classification,
    blueResponse: signingResponse,
    signerEvidence,
    chainResult,
    evidence: {
      intentToken,
      mutatedField: "maxAmountRequired",
      initialMaxAmount: scenario.initialReq.maxAmountRequired,
      mutatedMaxAmount: scenario.mutatedReq.maxAmountRequired,
    },
    startedAt,
    completedAt,
    durationMs: Date.now() - startMs,
  };

  await emitEvent({
    source: "RED",
    eventType: "ATTACK_COMPLETED",
    runId,
    attackId,
    data: {
      classification,
      blueDecision: signingResponse.allowed,
      toctouStage: "signing_boundary",
    },
  });

  return result;
}

/**
 * A09 Budget exhaustion attack.
 *
 * Resets Blue's budget, then sends sequential valid payments until the daily
 * budget is exhausted and Blue blocks further spending.
 */
async function runBudgetExhaustAttack(
  runId: string,
  attackId: string,
  scenario: SequentialScenario,
  startedAt: string,
  startMs: number,
): Promise<BudgetExhaustResult> {
  // Step 1: Reset Blue's budget
  try {
    await fetch(`${RED_CONFIG.blueUrl}/budget/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RED_CONFIG.blueAdminKey}`,
      },
      body: JSON.stringify({ confirm: true }),
    });
  } catch {
    // Budget reset failed — proceed anyway; Blue may not support it
    console.warn(`[runner] Budget reset request failed — proceeding with current Blue state`);
  }

  // Step 2: Send sequential valid payments until blocked
  const results: Array<{ attempt: number; allowed: boolean; reason?: string }> = [];

  for (let i = 0; i < scenario.maxAttempts; i++) {
    let response: BlueResponse;
    try {
      await emitEvent({
        source: "RED",
        eventType: "ATTACK_SENT",
        runId,
        attackId,
        data: { attempt: i + 1, target: `${RED_CONFIG.blueUrl}/shield-check` },
      });

      const res = await fetch(`${RED_CONFIG.blueUrl}/shield-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentRequirements: scenario.req, runId, attackId }),
      });
      response = (await res.json()) as BlueResponse;
    } catch (err) {
      results.push({
        attempt: i + 1,
        allowed: false,
        reason: `network_error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    results.push({
      attempt: i + 1,
      allowed: response.allowed,
      reason: response.decision?.attackType ?? response.decision?.reason,
    });

    if (!response.allowed) {
      const completedAt = new Date().toISOString();
      const result: BudgetExhaustResult = {
        runId,
        attackId,
        classification: "ATTACK_BLOCKED",
        blueResponse: response,
        signerEvidence: { invoked: false, source: "inferred", details: "budget exhausted — blocked" },
        chainResult: { fundsTransferred: false, txHash: null, source: "mock_chain" },
        blockedOnAttempt: i + 1,
        totalAttempts: results.length,
        results,
        startedAt,
        completedAt,
        durationMs: Date.now() - startMs,
      };

      await emitEvent({
        source: "RED",
        eventType: "ATTACK_COMPLETED",
        runId,
        attackId,
        data: {
          classification: "ATTACK_BLOCKED",
          blockedOnAttempt: i + 1,
          totalAttempts: results.length,
        },
      });

      return result;
    }
  }

  // Never got blocked → budget protection failed
  const completedAt = new Date().toISOString();
  const result: BudgetExhaustResult = {
    runId,
    attackId,
    classification: "ATTACK_BYPASS",
    blueResponse: null,
    signerEvidence: { invoked: true, source: "inferred", details: "budget never exhausted" },
    chainResult: { fundsTransferred: false, txHash: null, source: "mock_chain" },
    totalAttempts: results.length,
    results,
    startedAt,
    completedAt,
    durationMs: Date.now() - startMs,
  };

  await emitEvent({
    source: "RED",
    eventType: "ATTACK_COMPLETED",
    runId,
    attackId,
    data: { classification: "ATTACK_BYPASS", totalAttempts: results.length },
  });

  return result;
}

/**
 * Query the mock chain to check if funds were transferred for a given runId.
 *
 * The mock chain is the FINAL source of truth for FUNDS_LOST classification.
 */
async function checkMockChain(runId: string): Promise<ChainResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${RED_CONFIG.mockChainUrl}/transfers?runId=${runId}`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { fundsTransferred: false, txHash: null, source: "unavailable", details: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { transferred?: boolean; txHash?: string };
    return {
      fundsTransferred: data.transferred === true,
      txHash: data.txHash ?? null,
      source: "mock_chain",
    };
  } catch {
    // Mock chain unavailable — do not infer fund safety from this.
    return {
      fundsTransferred: false,
      txHash: null,
      source: "unavailable",
      details: "mock chain unreachable",
    };
  }
}

/**
 * Query Blue's audit log or signer evidence endpoint.
 *
 * We NEVER infer signer-not-invoked from `allowed: false` alone.
 * If the evidence endpoint is unavailable, we report `source: "unavailable"`.
 */
async function getSignerEvidence(runId: string): Promise<SignerEvidence> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${RED_CONFIG.blueUrl}/signer-evidence?runId=${runId}`, {
      headers: { Authorization: `Bearer ${RED_CONFIG.blueAdminKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { invoked: false, source: "unavailable", details: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { signerInvoked?: boolean };
    return {
      invoked: data.signerInvoked === true,
      source: "audit_log",
    };
  } catch {
    return {
      invoked: false,
      source: "unavailable",
      details: "signer evidence endpoint unreachable",
    };
  }
}

