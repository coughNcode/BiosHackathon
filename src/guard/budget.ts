/**
 * L5 — Budget Guard
 *
 * Atomic budget reservation using an in-memory store with locking semantics.
 * Replaces the JSON file ledger's race condition (G4 fix).
 *
 * Fix for G4 (budget race):
 *   The original code: check → (await settle) → record
 *   20 concurrent checks can all pass before any settles.
 *
 *   Our fix: RESERVE before signing, COMMIT after chain confirms, RELEASE on failure.
 *   Reservations count immediately against the budget.
 *   A pending reservation is as real as a settled spend.
 *
 * Fix for G18 (retry double-pay):
 *   Each intent gets a unique intentId. A second reservation with the same
 *   intentId returns DUPLICATE_INTENT.
 *
 * Note: For the hackathon, this uses an in-memory store.
 * Production should use better-sqlite3 WAL mode with BEGIN IMMEDIATE transactions.
 */

import { REASON } from "./reasons.js";

export type ReservationStatus = "RESERVED" | "COMMITTED" | "RELEASED" | "HELD";

export interface Reservation {
  intentId: string;
  amountAtomic: bigint;
  merchantHost: string;
  resource: string;
  status: ReservationStatus;
  reservedAt: string;
  settledAt?: string;
}

export interface BudgetConfig {
  /** Daily budget in atomic units */
  dailyAtomic: bigint;
  /** Per-call max in atomic units */
  perCallAtomic: bigint;
  /** Per-merchant daily cap in atomic units (keyed by host) */
  perMerchantAtomic?: Record<string, bigint>;
  /** Velocity limit: max payments per minute */
  velocityPerMin?: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason: string;
  detail?: string;
}

export class BudgetStore {
  private readonly reservations = new Map<string, Reservation>();
  private readonly config: BudgetConfig;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Attempt to reserve budget for a payment.
   * Returns false if any cap would be exceeded.
   * Atomic: either fully reserves or makes no change.
   */
  reserve(opts: {
    intentId: string;
    amountAtomic: bigint;
    merchantHost: string;
    resource: string;
  }): BudgetCheckResult {
    // G18 fix: reject duplicate intent IDs
    if (this.reservations.has(opts.intentId)) {
      return {
        allowed: false,
        reason: REASON.L5_DUPLICATE_INTENT,
        detail: `Intent ${opts.intentId} already has an outstanding reservation`,
      };
    }

    // Per-call cap
    if (opts.amountAtomic > this.config.perCallAtomic) {
      return {
        allowed: false,
        reason: REASON.L5_BUDGET_EXHAUSTED,
        detail: `Amount ${opts.amountAtomic} exceeds per-call cap ${this.config.perCallAtomic}`,
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const dailyUsed = this.dailyUsed(today);
    const merchantUsed = this.merchantUsed(opts.merchantHost, today);

    // Daily budget check (spent + reserved)
    if (dailyUsed + opts.amountAtomic > this.config.dailyAtomic) {
      return {
        allowed: false,
        reason: REASON.L5_BUDGET_RESERVED,
        detail: `Daily budget: ${dailyUsed} + ${opts.amountAtomic} > ${this.config.dailyAtomic}`,
      };
    }

    // Per-merchant cap check
    const merchantCap = this.config.perMerchantAtomic?.[opts.merchantHost];
    if (merchantCap !== undefined && merchantUsed + opts.amountAtomic > merchantCap) {
      return {
        allowed: false,
        reason: REASON.L5_BUDGET_RESERVED,
        detail: `Merchant daily cap for ${opts.merchantHost}: ${merchantUsed} + ${opts.amountAtomic} > ${merchantCap}`,
      };
    }

    // All checks passed — reserve atomically
    this.reservations.set(opts.intentId, {
      intentId: opts.intentId,
      amountAtomic: opts.amountAtomic,
      merchantHost: opts.merchantHost,
      resource: opts.resource,
      status: "RESERVED",
      reservedAt: new Date().toISOString(),
    });

    return { allowed: true, reason: REASON.ALLOW };
  }

  /** Commit a reservation after chain confirms the transfer */
  commit(intentId: string): boolean {
    const r = this.reservations.get(intentId);
    if (!r || r.status !== "RESERVED") return false;
    r.status = "COMMITTED";
    r.settledAt = new Date().toISOString();
    return true;
  }

  /** Release a reservation on payment failure */
  release(intentId: string): boolean {
    const r = this.reservations.get(intentId);
    if (!r) return false;
    r.status = "RELEASED";
    r.settledAt = new Date().toISOString();
    return true;
  }

  /** Hold a reservation pending chain confirmation timeout */
  hold(intentId: string): boolean {
    const r = this.reservations.get(intentId);
    if (!r) return false;
    r.status = "HELD";
    return true;
  }

  /** Get current status of a reservation */
  getReservation(intentId: string): Reservation | undefined {
    return this.reservations.get(intentId);
  }

  /** All active reservations (for dashboard/audit) */
  allReservations(): Reservation[] {
    return Array.from(this.reservations.values());
  }

  /** Total atomic units committed + reserved today (counts against budget) */
  private dailyUsed(today: string): bigint {
    let total = 0n;
    for (const r of this.reservations.values()) {
      if (
        r.reservedAt.slice(0, 10) === today &&
        (r.status === "RESERVED" || r.status === "COMMITTED")
      ) {
        total += r.amountAtomic;
      }
    }
    return total;
  }

  /** Total for a specific merchant today */
  private merchantUsed(merchantHost: string, today: string): bigint {
    let total = 0n;
    for (const r of this.reservations.values()) {
      if (
        r.merchantHost === merchantHost &&
        r.reservedAt.slice(0, 10) === today &&
        (r.status === "RESERVED" || r.status === "COMMITTED")
      ) {
        total += r.amountAtomic;
      }
    }
    return total;
  }

  /** Summary for dashboard */
  summary(): {
    dailyAtomic: string;
    usedAtomic: string;
    reservedAtomic: string;
    committedAtomic: string;
    freeAtomic: string;
  } {
    const today = new Date().toISOString().slice(0, 10);
    let reserved = 0n;
    let committed = 0n;
    for (const r of this.reservations.values()) {
      if (r.reservedAt.slice(0, 10) === today) {
        if (r.status === "RESERVED") reserved += r.amountAtomic;
        if (r.status === "COMMITTED") committed += r.amountAtomic;
      }
    }
    const used = reserved + committed;
    return {
      dailyAtomic: this.config.dailyAtomic.toString(),
      usedAtomic: used.toString(),
      reservedAtomic: reserved.toString(),
      committedAtomic: committed.toString(),
      freeAtomic: (this.config.dailyAtomic - used).toString(),
    };
  }
}
