import { wrapFetchWithPayment, type Signer, type MultiNetworkSigner } from "x402-fetch";
import type { PaymentRequirements } from "x402/types";
import { PolicyEngine, railOf, type PolicyVerdict, type WalletPolicy } from "./policy.js";
import { WalletShieldFirewall, type SecurityDecision } from "./firewall.js";
import { verifyFingerprint, type PaymentRequirementsLike } from "./fingerprint.js";

/**
 * wrapPayerFetch — client-side enforcement of a WalletPolicy and PayGuard AI
 * firewall on any x402-paying fetch.
 *
 *   fetch → 402 → choose rail → FIREWALL CHECK → POLICY CHECK → SIGNING BOUNDARY → sign & retry → 200
 *                                    │                 │              │
 *                                    └── FirewallViolationError       └── TOCTOU_MODIFY blocked
 */

export class PolicyViolationError extends Error {
  constructor(public readonly verdict: PolicyVerdict) {
    super(`Payment blocked by wallet policy: ${verdict.reason}`);
    this.name = "PolicyViolationError";
  }
}

export class FirewallViolationError extends Error {
  constructor(public readonly decision: SecurityDecision) {
    super(`Payment blocked by PayGuard firewall: ${decision.attackType ?? "UNKNOWN"} (${decision.violatedCheck ?? "check failed"})`);
    this.name = "FirewallViolationError";
  }
}

/** Raised when the merchant offers no rail this wallet can pay on. */
export class NoUsableRailError extends Error {
  constructor(public readonly offered: string[]) {
    super(`Merchant offered no rail this wallet can pay on. Offered: ${offered.join(", ") || "nothing"}`);
    this.name = "NoUsableRailError";
  }
}

export interface WrapPayerFetchOptions {
  /**
   * Wallet that signs x402 payments. Pass a single signer, or
   * `{ evm, svm }` to pay on whichever rail the merchant prefers.
   */
  signer: Signer | MultiNetworkSigner;
  /** Policy to enforce, or a pre-built PolicyEngine (shares its ledger). */
  policy: WalletPolicy | PolicyEngine;
  /** PayGuard AI security firewall instance. */
  firewall?: WalletShieldFirewall;
  /** Called with every verdict — allowed or not. Useful for audit logs. */
  onVerdict?: (verdict: PolicyVerdict) => void;
  /** Called with every firewall security decision. */
  onFirewallDecision?: (decision: SecurityDecision) => void;
  /**
   * Rails this signer can actually sign for. Defaults to both when a
   * MultiNetworkSigner is supplied, otherwise inferred at selection time.
   */
  rails?: ("evm" | "solana")[];
}

/**
 * Creates a guarded signer that verifies the payment intent token at the
 * signing boundary before delegating to the underlying wallet signer.
 * Closes the TOCTOU gap by preventing mutated payloads from being signed.
 */
export function createGuardedSigner(
  signer: Signer | MultiNetworkSigner,
  getIntentToken: () => string | undefined,
  getApprovedReq: () => PaymentRequirements | undefined,
): Signer | MultiNetworkSigner {
  const verifyBoundary = (payload?: PaymentRequirementsLike) => {
    const token = getIntentToken();
    if (!token) {
      throw new Error("PayGuard signing boundary: no approved intent token. Signing rejected.");
    }
    const req = payload ?? (getApprovedReq() as unknown as PaymentRequirementsLike);
    if (!req || !verifyFingerprint(req, token)) {
      throw new Error("PayGuard signing boundary: TOCTOU_MODIFY detected! Payment intent mismatch.");
    }
  };

  const wrapSignMethod = (target: unknown, fn: unknown) => {
    if (typeof fn !== "function") return fn;
    return async (...args: unknown[]) => {
      verifyBoundary();
      return (fn as Function).apply(target, args);
    };
  };

  if (isMultiNetwork(signer)) {
    return new Proxy(signer, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (typeof val === "object" && val !== null) {
          return new Proxy(val, {
            get(subTarget, subProp, subReceiver) {
              const subVal = Reflect.get(subTarget, subProp, subReceiver);
              if (typeof subVal === "function" && (subProp === "sign" || subProp === "signMessage" || subProp === "signTransaction" || subProp === "signTypedData")) {
                return wrapSignMethod(subTarget, subVal);
              }
              return subVal;
            },
          });
        }
        if (typeof val === "function" && (prop === "sign" || prop === "signMessage" || prop === "signTransaction")) {
          return wrapSignMethod(target, val);
        }
        return val;
      },
    });
  }

  return new Proxy(signer, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === "function" && (prop === "sign" || prop === "signMessage" || prop === "signTransaction" || prop === "signTypedData")) {
        return wrapSignMethod(target, val);
      }
      return val;
    },
  });
}

export function wrapPayerFetch(
  baseFetch: typeof globalThis.fetch,
  options: WrapPayerFetchOptions,
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
  const engine =
    options.policy instanceof PolicyEngine
      ? options.policy
      : new PolicyEngine(options.policy, { ephemeral: true });

  const signerRails =
    options.rails ??
    (isMultiNetwork(options.signer) ? (["evm", "solana"] as const).slice() : undefined);

  return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
    let approved: { verdict: PolicyVerdict; requirement: PaymentRequirements } | undefined;
    let approvedToken: string | undefined;
    let approvedRequirement: PaymentRequirements | undefined;

    const select = (accepts: PaymentRequirements[]): PaymentRequirements => {
      const merchant = merchantOf(accepts[0]?.resource, input);

      // Narrow to rails this wallet can sign for and the policy permits, in the
      // policy's stated preference order.
      const usable = accepts.filter((requirement) => {
        const rail = railOf(requirement.network);
        if (signerRails && !signerRails.includes(rail)) return false;
        return engine.railAllowed(rail);
      });
      if (usable.length === 0) throw new NoUsableRailError(accepts.map((a) => a.network));

      const requirement = preferred(usable, engine.policy.preferRail);

      // CHECK FIREWALL BEFORE POLICY ENGINE (Phase 4 requirement)
      if (options.firewall) {
        const shieldResult = options.firewall.validateSync(requirement as unknown as Record<string, unknown>);
        options.onFirewallDecision?.(shieldResult.decision);
        if (!shieldResult.allowed) {
          throw new FirewallViolationError(shieldResult.decision);
        }
        approvedToken = shieldResult.intentToken ?? undefined;
        approvedRequirement = requirement;
      }

      const amountUsd = Number(requirement.maxAmountRequired) / 1e6;

      const verdict = engine.check({
        merchant,
        amountUsd,
        resource: requirement.resource,
        network: requirement.network,
        rail: railOf(requirement.network),
      });
      options.onVerdict?.(verdict);
      if (!verdict.allowed) throw new PolicyViolationError(verdict);

      approved = { verdict, requirement };
      return requirement;
    };

    // Belt and braces: cap what x402-fetch may ever sign at the policy's
    // per-request max, so a bug in `select` still can't overspend.
    const maxValueAtomic = BigInt(Math.round(engine.policy.perRequestMaxUsd * 1e6));

    // Guard signer if firewall is provided
    const activeSigner = options.firewall
      ? createGuardedSigner(options.signer, () => approvedToken, () => approvedRequirement)
      : options.signer;

    const payingFetch = wrapFetchWithPayment(baseFetch, activeSigner, maxValueAtomic, select);

    const response = await payingFetch(input, init);

    if (approved && response.ok && response.headers.get("x-payment-response")) {
      engine.recordSpend({
        merchant: merchantOf(approved.requirement.resource, input),
        amountUsd: Number(approved.requirement.maxAmountRequired) / 1e6,
        resource: approved.requirement.resource,
        network: approved.requirement.network,
        rail: railOf(approved.requirement.network),
        verdictId: approved.verdict.verdictId,
      });
    }
    return response;
  };
}

/** Order by the policy's rail preference; otherwise keep the merchant's order. */
function preferred(accepts: PaymentRequirements[], prefer?: "evm" | "solana"): PaymentRequirements {
  if (!prefer) return accepts[0];
  return accepts.find((a) => railOf(a.network) === prefer) ?? accepts[0];
}

function isMultiNetwork(signer: Signer | MultiNetworkSigner): signer is MultiNetworkSigner {
  return typeof signer === "object" && signer !== null && "evm" in signer && "svm" in signer;
}

function merchantOf(resource: string | undefined, input: RequestInfo): string {
  try {
    if (resource) return new URL(resource).host;
  } catch {
    // fall through to the request URL
  }
  try {
    return new URL(typeof input === "string" ? input : input.url).host;
  } catch {
    return "unknown";
  }
}
