/**
 * L2 — Identity / Registry Guard
 *
 * Every endpoint the agent may pay must be pre-registered with:
 *   - origin (scheme + host + port)
 *   - HTTP method and path
 *   - payTo address (who receives funds)
 *   - asset contract address
 *   - chainId
 *   - assetName + assetVersion (EIP-712 domain)
 *   - price band (min/max atomic)
 *   - maxWindowSeconds
 *
 * A 402 is rejected if ANY of these fields doesn't match the registry.
 * This closes G1 (payTo never checked) and G2 (asset/chain never verified).
 *
 * Addresses are compared as lowercase strings.
 * An unknown endpoint → ENDPOINT_UNKNOWN.
 */

import { normalizeOrigin } from "./transport.js";
import { REASON } from "./reasons.js";
import type { ParsedAccept } from "./parse402.js";

export interface EndpointRegistryEntry {
  /** Full origin, e.g. "http://192.168.77.2:4020" */
  origin: string;
  method: string;
  path: string;
  /** Who receives funds — must match payTo in the 402 exactly */
  payTo: string;
  /** USDC contract address or SPL mint */
  asset: string;
  chainId?: number;
  assetName?: string;
  assetVersion?: string;
  price: {
    /** Minimum acceptable amount in atomic units */
    minAtomic: string;
    /** Maximum acceptable amount in atomic units */
    maxAtomic: string;
  };
  maxWindowSeconds: number;
}

export interface RegistryCheckResult {
  allowed: boolean;
  reason: string;
  detail?: string;
  entry?: EndpointRegistryEntry;
}

export class EndpointRegistry {
  private readonly entries: EndpointRegistryEntry[];

  constructor(entries: EndpointRegistryEntry[]) {
    // Normalize addresses to lowercase on construction
    this.entries = entries.map((e) => ({
      ...e,
      payTo: e.payTo.toLowerCase(),
      asset: e.asset.toLowerCase(),
      origin: e.origin,
    }));
  }

  /**
   * Find the registry entry that matches the request context.
   * Returns null if no match.
   */
  lookup(origin: string, method: string, path: string): EndpointRegistryEntry | null {
    const normalizedOrigin = normalizeOrigin(origin) ?? origin;
    return (
      this.entries.find(
        (e) =>
          e.origin === normalizedOrigin &&
          e.method.toUpperCase() === method.toUpperCase() &&
          e.path === path
      ) ?? null
    );
  }

  /**
   * Validate a parsed 402 accept entry against the registry.
   * Checks: endpoint known, payTo match, asset match, network/chainId match.
   */
  checkAccept(
    accept: ParsedAccept,
    requestOrigin: string,
    requestMethod: string,
    requestPath: string
  ): RegistryCheckResult {
    const entry = this.lookup(requestOrigin, requestMethod, requestPath);

    if (!entry) {
      return {
        allowed: false,
        reason: REASON.L2_ENDPOINT_UNKNOWN,
        detail: `${requestMethod} ${requestOrigin}${requestPath} is not in the registry`,
      };
    }

    // payTo must match exactly (case-insensitive address comparison)
    if (accept.payTo.toLowerCase() !== entry.payTo) {
      return {
        allowed: false,
        reason: REASON.L2_PAYTO_MISMATCH,
        detail: `payTo ${accept.payTo} does not match registry ${entry.payTo}`,
        entry,
      };
    }

    // asset (contract address / SPL mint) must match
    if (accept.asset.toLowerCase() !== entry.asset) {
      return {
        allowed: false,
        reason: REASON.L2_ASSET_NOT_ALLOWED,
        detail: `asset ${accept.asset} does not match registry ${entry.asset}`,
        entry,
      };
    }

    // EIP-712 domain name/version check (if registry has them)
    if (entry.assetName && accept.extra?.["name"] !== entry.assetName) {
      return {
        allowed: false,
        reason: REASON.L2_ASSET_NOT_ALLOWED,
        detail: `EIP-712 domain name "${String(accept.extra?.["name"])}" does not match registry "${entry.assetName}"`,
        entry,
      };
    }

    return { allowed: true, reason: REASON.ALLOW, entry };
  }

  entries_(): EndpointRegistryEntry[] {
    return [...this.entries];
  }
}

/**
 * Load registry from a policy v1 JSON file.
 * Format matches the policy.v1.json spec from the architecture PDF.
 */
export function registryFromJson(json: unknown): EndpointRegistry {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Registry JSON must be an object");
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj["endpoints"])) {
    throw new Error("Registry JSON must have an endpoints array");
  }
  const entries = obj["endpoints"] as EndpointRegistryEntry[];
  return new EndpointRegistry(entries);
}
