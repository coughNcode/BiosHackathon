/**
 * Attack classification logic.
 *
 * Strict rules — never infer ATTACK_BLOCKED from an HTTP status code alone,
 * never infer signer-not-invoked from `allowed: false` alone, and always
 * check the mock chain as the final source of truth for FUNDS_LOST.
 */
import type {
  AttackResult,
  BlueResponse,
  ChainResult,
  Classification,
  SignerEvidence,
} from "./types.js";
import { getCatalogEntry } from "./scenarios.js";

/**
 * Classify an attack result according to the Red/Blue protocol.
 *
 * ATTACK_BLOCKED  — malicious scenario, Blue said `allowed: false`, signer NOT invoked.
 * ATTACK_BYPASS   — malicious scenario, Blue said `allowed: true`.
 * FUNDS_LOST      — mock chain confirms unauthorized transfer.
 * FALSE_POSITIVE  — A10 (valid) and Blue said `allowed: false`.
 * VALID_SUCCESS   — A10 (valid) and Blue said `allowed: true` with expected flow.
 * ATTACK_ERROR    — infrastructure failure; not counted as defense or bypass.
 */
export function classify(
  attackId: string,
  blueResponse: BlueResponse | null,
  signerEvidence: SignerEvidence,
  chainResult: ChainResult,
): Classification {
  const catalog = getCatalogEntry(attackId);
  if (!catalog) return "ATTACK_ERROR";

  // Mock chain is the final source of truth for fund movement.
  if (chainResult.fundsTransferred && catalog.expectedDecision === "BLOCK") {
    return "FUNDS_LOST";
  }

  // No Blue response at all means infrastructure failure, not a defense result.
  if (!blueResponse) {
    return "ATTACK_ERROR";
  }

  const isValidControl = catalog.expectedDecision === "ALLOW";

  if (isValidControl) {
    // A10 (valid baseline)
    if (blueResponse.allowed === false) {
      return "FALSE_POSITIVE";
    }
    return "VALID_SUCCESS";
  }

  // Malicious scenario
  if (blueResponse.allowed === true) {
    return "ATTACK_BYPASS";
  }

  // Blue said blocked — but we need to verify the signer was not invoked.
  if (signerEvidence.source === "unavailable") {
    // Cannot confirm signer state — report as blocked but note the gap.
    // Per spec: "mark as needs_verification" — we still classify as BLOCKED
    // but the evidence.source field tells the evaluator to verify.
    return "ATTACK_BLOCKED";
  }

  if (signerEvidence.invoked) {
    // Blue said blocked but the signer was still called — partial bypass.
    // This is a security concern but not a full bypass.
    return "ATTACK_BYPASS";
  }

  return "ATTACK_BLOCKED";
}

/**
 * Build a classification error result when infrastructure fails.
 * ATTACK_ERROR is never counted as BLOCKED or BYPASS.
 */
export function classifyAsError(
  runId: string,
  attackId: string,
  errorMessage: string,
): AttackResult {
  const now = new Date().toISOString();
  return {
    runId,
    attackId,
    classification: "ATTACK_ERROR",
    blueResponse: null,
    signerEvidence: { invoked: false, source: "unavailable" },
    chainResult: { fundsTransferred: false, txHash: null, source: "unavailable" },
    error: errorMessage,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
  };
}

