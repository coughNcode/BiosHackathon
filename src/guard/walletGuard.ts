/**
 * L4 — Wallet Guard (the centrepiece)
 *
 * Wraps a viem LocalAccount so that signTypedData is intercepted and
 * verified against the pinned quote before any bytes are signed.
 *
 * Why this is the centrepiece (from the architecture PDF):
 *   The SDK builds the EIP-712 domain and validity window from
 *   merchant-supplied fields, then calls walletClient.signTypedData.
 *   At THAT CALL the guard sees the final bytes: contract, chain,
 *   recipient, amount, window. It compares them to the hash pinned
 *   during L0-L3. A bug in the SDK, a field the guard failed to parse,
 *   or an attack that mutates terms between steps all end in the same
 *   place: QUOTE_CHANGED, and no signature exists.
 *
 * SECURITY: signMessage and signTransaction are ALWAYS forbidden.
 * Only TransferWithAuthorization typed data may be signed.
 *
 * CRITICAL EVENT DISTINCTION (global rule):
 *   SIGNER_CALLED event fires only when signTypedData is actually invoked.
 *   This is SEPARATE from POLICY_APPROVED (L0-L3 passing) and
 *   CHAIN_TRANSFERRED (mock chain balance change).
 */

import type { PinStore } from "./pin.js";
import { MAX_WINDOW_SECONDS, hashFromTypedData } from "./pin.js";
import { REASON, type ReasonCode } from "./reasons.js";
import { emitBlock, emitEvent } from "./events.js";
import { randomUUID } from "node:crypto";

/** Minimal interface matching what x402-fetch expects from a LocalAccount */
export interface SignableAccount {
  address: string;
  signMessage?: (args: { message: unknown }) => Promise<`0x${string}`>;
  signTransaction?: (args: unknown) => Promise<`0x${string}`>;
  signTypedData?: (args: {
    domain?: { chainId?: number; verifyingContract?: string };
    types?: Record<string, unknown>;
    primaryType?: string;
    message?: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
}

export class GuardBlock extends Error {
  constructor(public readonly code: ReasonCode, detail?: string) {
    super(`[PayGuard] ${code}${detail ? `: ${detail}` : ""}`);
    this.name = "GuardBlock";
  }
}

/**
 * Wrap a signing account with L4 wallet guard.
 * Returns a new account object with the same interface but intercepted signing.
 *
 * @param account  The real signing account (private key stays inside it)
 * @param pins     Shared PinStore from the selector
 * @param traceId  Correlation ID for this payment attempt
 */
export function guardWallet(
  account: SignableAccount,
  pins: PinStore,
  traceId: string
): SignableAccount {
  const refuse = async (code: ReasonCode, detail: unknown): Promise<never> => {
    await emitBlock("L4", code, traceId, {
      kind: "SIGNER_BLOCKED",
      detail,
      merchant: account.address, // merchant not known here — use address as correlation
    });
    throw new GuardBlock(code, String(detail));
  };

  return {
    ...account,

    // signMessage is unconditionally forbidden — no x402 payment needs it
    signMessage: async (_args) => {
      await refuse(REASON.L4_SIGN_FORBIDDEN, "signMessage is not permitted");
      return "0x" as `0x${string}`;
    },

    // signTransaction is unconditionally forbidden
    signTransaction: async (_args) => {
      await refuse(REASON.L4_SIGN_FORBIDDEN, "signTransaction is not permitted");
      return "0x" as `0x${string}`;
    },

    // signTypedData — the only permitted signing path
    signTypedData: async (args) => {
      // 1. Must be TransferWithAuthorization
      if (args.primaryType !== "TransferWithAuthorization") {
        await refuse(
          REASON.L4_SIGN_FORBIDDEN,
          `primaryType must be TransferWithAuthorization, got: ${String(args.primaryType)}`
        );
      }

      // 2. Hash the typed data the wallet is actually being asked to sign
      const { hash, windowSeconds } = hashFromTypedData({
        domain: args.domain,
        message: args.message,
        from: account.address,
      });

      // 3. Window must be ≤ MAX_WINDOW_SECONDS
      if (windowSeconds > MAX_WINDOW_SECONDS) {
        await refuse(
          REASON.L4_WINDOW_TOO_LONG,
          `validBefore window is ${windowSeconds}s > max ${MAX_WINDOW_SECONDS}s`
        );
      }

      // 4. Look up and consume the pin (single-use)
      const pin = pins.take(hash);
      if (!pin) {
        const alreadyConsumed = !pins.has(hash);
        await refuse(
          alreadyConsumed ? REASON.L4_SIGN_UNPINNED : REASON.L4_PIN_CONSUMED,
          `pin hash: ${hash.slice(0, 16)}...`
        );
      }

      // 5. Emit SIGNER_CALLED event (separate from POLICY_APPROVED)
      await emitEvent({
        kind: "SIGNER_CALLED",
        layer: "L4",
        decision: "ALLOW",
        reason: REASON.ALLOW,
        trace_id: traceId,
        pin_hash: `sha256:${hash}`,
        amount_atomic: pin!.amountAtomic,
        merchant: pin!.payTo, // payTo address used as merchant identifier at signing
      });

      // 6. Delegate to the real account — private key never leaves this scope
      if (!account.signTypedData) {
        await refuse(REASON.GUARD_ERROR, "underlying account has no signTypedData");
      }
      const sig = await account.signTypedData!(args);

      return sig;
    },
  };
}
