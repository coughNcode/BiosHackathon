/**
 * L6 — Behaviour Guard
 *
 * Detects anomalous payment patterns that each individual check cannot catch:
 *  - Loop detection: repeated 402s on the same resource with no delivery
 *  - Velocity: too many payments per minute (slow drain, A11)
 *
 * The behaviour guard can only TIGHTEN limits or require approval.
 * It can NEVER loosen a rule set by other layers.
 */

import { REASON } from "./reasons.js";

export interface BehaviourConfig {
  /** Maximum payment attempts per resource within the window before loop detection */
  maxAttemptsPerResource: number;
  /** Time window for loop detection in ms */
  loopWindowMs: number;
  /** Maximum payments per minute globally */
  velocityPerMin: number;
}

export interface BehaviourCheckResult {
  allowed: boolean;
  reason: string;
  detail?: string;
}

interface AttemptRecord {
  resource: string;
  ts: number;
  succeeded: boolean;
}

export class BehaviourTracker {
  private readonly config: BehaviourConfig;
  private readonly attempts: AttemptRecord[] = [];

  constructor(config: BehaviourConfig) {
    this.config = config;
  }

  /**
   * Record and evaluate a payment attempt.
   * Call BEFORE allowing the payment.
   */
  check(resource: string): BehaviourCheckResult {
    const now = Date.now();
    this.prune(now);

    // Velocity check: payments per minute globally
    const lastMinute = this.attempts.filter(
      (a) => now - a.ts < 60_000
    );
    if (lastMinute.length >= this.config.velocityPerMin) {
      return {
        allowed: false,
        reason: REASON.L6_VELOCITY,
        detail: `${lastMinute.length} payments in the last 60s >= limit ${this.config.velocityPerMin}`,
      };
    }

    // Loop detection: too many attempts on the same resource without success
    const resourceAttempts = this.attempts.filter(
      (a) =>
        a.resource === resource &&
        !a.succeeded &&
        now - a.ts < this.config.loopWindowMs
    );
    if (resourceAttempts.length >= this.config.maxAttemptsPerResource) {
      return {
        allowed: false,
        reason: REASON.L6_LOOP_DETECTED,
        detail: `${resourceAttempts.length} failed attempts on ${resource} within ${this.config.loopWindowMs}ms`,
      };
    }

    // Record this attempt
    this.attempts.push({ resource, ts: now, succeeded: false });

    return { allowed: true, reason: REASON.ALLOW };
  }

  /** Mark the most recent attempt for a resource as succeeded */
  markSuccess(resource: string): void {
    // Find the most recent unresolved attempt for this resource
    for (let i = this.attempts.length - 1; i >= 0; i--) {
      if (this.attempts[i].resource === resource && !this.attempts[i].succeeded) {
        this.attempts[i].succeeded = true;
        break;
      }
    }
  }

  /** Remove old records outside the tracking window */
  private prune(now: number): void {
    const cutoff = now - Math.max(this.config.loopWindowMs, 60_000 * 5);
    let i = 0;
    while (i < this.attempts.length && this.attempts[i].ts < cutoff) i++;
    if (i > 0) this.attempts.splice(0, i);
  }

  stats(): { totalAttempts: number; lastMinuteCount: number } {
    const now = Date.now();
    return {
      totalAttempts: this.attempts.length,
      lastMinuteCount: this.attempts.filter((a) => now - a.ts < 60_000).length,
    };
  }
}

