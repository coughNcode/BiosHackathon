/**
 * L4 — Quote Pinning
 *
 * The core insight (from the architecture PDF):
 * Nothing ties what the guard approved to what the wallet signs
 * unless we hash the exact typed-data object BEFORE returning it
 * from select(), and verify that same hash INSIDE signTypedData().
 *
 * Flow:
 *   1. L0-L3 pass → build a "pin" from the requirement fields
 *   2. Store pin hash → pin data in an in-memory Map (single-use)
 *   3. When signTypedData is called, recompute hash from the actual
 *      typed-data bytes and compare to the stored pin
 *   4. Any field difference → QUOTE_CHANGED → no signature
 *
 * The pin includes: to (payTo), value (amount), validBefore (window),
 * verifyingContract (asset), chainId, from (our address).
 * A bug in the SDK, a merchant field swap, or a mutated object
 * all produce a different hash → blocked.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "../sign.js";
import type { ReasonCode } from "./reasons.js";
import { REASON } from "./reasons.js";

export interface PinData {
  hash: string;
  /** ISO timestamp when pin was created */
  createdAt: string;
  /** Expires after this timestamp (= validBefore from signed data) */
  expiresAt: string;
  /** Pinned fields for L7 reconciliation */
  payTo: string;
  amountAtomic: string;
  asset: string;
  chainId?: number;
  resource: string;
  trace_id: string;
}

/** Single-use pin store — each hash may only be consumed once */
export class PinStore {
  private readonly pins = new Map<string, PinData>();

  /** Store a pin. Returns the hash. */
  set(pin: PinData): string {
    this.pins.set(pin.hash, pin);
    // Auto-expire pins after their validBefore window
    const ttl = new Date(pin.expiresAt).getTime() - Date.now();
    if (ttl > 0) {
      setTimeout(() => this.pins.delete(pin.hash), ttl + 5_000);
    }
    return pin.hash;
  }

  /** Consume a pin (single-use). Returns the pin data or null. */
  take(hash: string): PinData | null {
    const pin = this.pins.get(hash);
    if (!pin) return null;
    this.pins.delete(hash);
    return pin;
  }

  /** Check without consuming */
  has(hash: string): boolean {
    return this.pins.has(hash);
  }

  size(): number {
    return this.pins.size;
  }
}

/**
 * Build a pin hash from a PaymentRequirements object.
 * Uses canonicalized JSON → SHA-256.
 * Fields that will be in the final signed typed-data.
 */
export function buildPinFromRequirement(opts: {
  payTo: string;
  amountAtomic: string;
  asset: string;
  chainId?: number;
  resource: string;
  validBefore: number; // unix seconds
  from: string; // our wallet address
}): { hash: string; expiresAt: string } {
  const canonical = canonicalize({
    payTo: opts.payTo.toLowerCase(),
    amountAtomic: opts.amountAtomic,
    asset: opts.asset.toLowerCase(),
    chainId: opts.chainId ?? 0,
    resource: opts.resource,
    validBefore: opts.validBefore,
    from: opts.from.toLowerCase(),
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  const expiresAt = new Date(opts.validBefore * 1000).toISOString();
  return { hash, expiresAt };
}

/**
 * Extract pin-relevant fields from EIP-712 typed data that the wallet
 * is being asked to sign. Used inside guardWallet to verify the pin.
 */
export function hashFromTypedData(data: {
  domain?: { chainId?: number; verifyingContract?: string };
  message?: Record<string, unknown>;
  from?: string;
}): { hash: string; windowSeconds: number } {
  const msg = data.message ?? {};
  const to = String(msg["to"] ?? "").toLowerCase();
  const value = String(msg["value"] ?? msg["amount"] ?? "0");
  const validBefore = Number(msg["validBefore"] ?? 0);
  const verifyingContract = String(
    data.domain?.verifyingContract ?? ""
  ).toLowerCase();
  const chainId = data.domain?.chainId ?? 0;
  const from = String(data.from ?? msg["from"] ?? "").toLowerCase();

  const canonical = canonicalize({
    payTo: to,
    amountAtomic: value,
    asset: verifyingContract,
    chainId,
    resource: "", // resource is not in typed-data; verified separately
    validBefore,
    from,
  });

  const hash = createHash("sha256").update(canonical).digest("hex");
  const windowSeconds = Math.max(0, validBefore - Math.floor(Date.now() / 1000));

  return { hash, windowSeconds };
}

/** Maximum validity window we will ever sign (seconds) */
export const MAX_WINDOW_SECONDS = 30;

/** Validate a pin hash against stored pins. Returns reason code or null on success. */
export function validatePin(
  store: PinStore,
  hash: string
): { pin: PinData; error: null } | { pin: null; error: ReasonCode } {
  if (store.has(hash)) {
    const pin = store.take(hash);
    if (pin) return { pin, error: null };
  }
  // Check if it was ever there (already consumed)
  return { pin: null, error: REASON.L4_SIGN_UNPINNED };
}
