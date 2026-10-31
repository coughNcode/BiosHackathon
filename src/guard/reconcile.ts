/**
 * L7 — Post-Payment Reconciler
 *
 * After a payment is signed and settlement is attempted, the reconciler
 * verifies that what the chain actually did matches what the guard approved.
 *
 * CRITICAL DISTINCTION (global rule):
 *   - L3/L4 ALLOW → policy approved AND wallet signed
 *   - L7 runs AFTER settlement → checks mock chain's actual balance delta
 *   - Only the chain's confirmed transfer = "funds moved"
 *
 * Closes G14 (settlement trusted from merchant):
 *   The merchant's x-payment-response header is LOGGED but NEVER decides
 *   anything. Only the mock chain's balance change is authoritative.
 *
 * Closes G18 (retry double-pay):
 *   Works together with L5 budget store:
 *   - On success: BudgetStore.commit(intentId)
 *   - On mismatch: emit SETTLEMENT_MISMATCH alert + BudgetStore.hold(intentId)
 *   - On failure before signing: BudgetStore.release(intentId)
 */

import { REASON } from "./reasons.js";
import { emitEvent } from "./events.js";
import type { BudgetStore } from "./budget.js";

export interface ChainReceipt {
  /** Balance delta for our address (negative = we paid) */
  balanceDeltaAtomic: string;
  /** Address that received the funds */
  recipientAddress: string;
  /** Asset contract address */
  asset: string;
  /** Whether the chain confirmed this transfer */
  confirmed: boolean;
}

export interface ReconcileOptions {
  intentId: string;
  trace_id: string;
  /** What the guard approved */
  pinned: {
    amountAtomic: string;
    payTo: string;
    asset: string;
  };
  /** What the chain says actually happened */
  chainReceipt: ChainReceipt | null;
  budgetStore: BudgetStore;
}

export type ReconcileResult =
  | { ok: true; fundsLostAtomic: "0" }
  | { ok: false; reason: string; detail: string; fundsLostAtomic: string };

/**
 * Reconcile a payment against the mock chain's ground truth.
 * Updates the budget store and emits the appropriate event.
 *
 * This is the ONLY place where fundsLostAtomic is set.
 * It comes from the chain, never from the guard's own logs.
 */
export async function reconcile(opts: ReconcileOptions): Promise<ReconcileResult> {
  const { intentId, trace_id, pinned, chainReceipt, budgetStore } = opts;

  // No chain receipt = payment failed before settlement
  if (!chainReceipt || !chainReceipt.confirmed) {
    budgetStore.release(intentId);
    await emitEvent({
      kind: "GUARD_INTERNAL",
      layer: "L7",
      decision: "ALLOW",
      reason: REASON.ALLOW,
      trace_id,
      detail: { status: "no_chain_receipt", intentId },
      amount_atomic: "0",
    });
    return { ok: true, fundsLostAtomic: "0" };
  }

  // Chain says funds moved — verify all fields match pinned values
  const mismatch: string[] = [];

  // Amount: chain delta should equal pinned amount (as positive value)
  const chainDelta = BigInt(chainReceipt.balanceDeltaAtomic);
  const pinnedAmount = BigInt(pinned.amountAtomic);
  const actualLoss = chainDelta < 0n ? -chainDelta : chainDelta;

  if (actualLoss !== pinnedAmount) {
    mismatch.push(
      `amount: chain=${actualLoss} pinned=${pinnedAmount}`
    );
  }

  // Recipient
  if (
    chainReceipt.recipientAddress.toLowerCase() !== pinned.payTo.toLowerCase()
  ) {
    mismatch.push(
      `payTo: chain=${chainReceipt.recipientAddress} pinned=${pinned.payTo}`
    );
  }

  // Asset
  if (chainReceipt.asset.toLowerCase() !== pinned.asset.toLowerCase()) {
    mismatch.push(
      `asset: chain=${chainReceipt.asset} pinned=${pinned.asset}`
    );
  }

  if (mismatch.length > 0) {
    // Mismatch — hold budget until window expires, raise alert
    budgetStore.hold(intentId);
    const detail = mismatch.join("; ");

    await emitEvent({
      kind: "CHAIN_TRANSFERRED",
      layer: "L7",
      decision: "BLOCK",
      reason: REASON.L7_SETTLEMENT_MISMATCH,
      trace_id,
      detail: { mismatch, chainReceipt, pinned, intentId },
      amount_atomic: actualLoss.toString(),
    });

    return {
      ok: false,
      reason: REASON.L7_SETTLEMENT_MISMATCH,
      detail,
      fundsLostAtomic: actualLoss.toString(),
    };
  }

  // All match — commit the reservation
  budgetStore.commit(intentId);

  await emitEvent({
    kind: "CHAIN_TRANSFERRED",
    layer: "L7",
    decision: "ALLOW",
    reason: REASON.ALLOW,
    trace_id,
    detail: { status: "confirmed", intentId },
    amount_atomic: actualLoss.toString(),
  });

  return { ok: true, fundsLostAtomic: "0" };
}
