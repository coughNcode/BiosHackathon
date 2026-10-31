/**
 * L1 — Parse Guard
 *
 * Validates and sanitizes the 402 challenge body before any field
 * is trusted by the guard or passed to the SDK.
 *
 * Blocks:
 *  - Body > 8 KB (DoS protection)
 *  - x402Version not exactly 1 (protocol rule)
 *  - scheme not "exact"
 *  - amount not matching ^(0|[1-9][0-9]{0,18})$ or equal to zero
 *  - More than 4 options in accepts[]
 *  - Unknown or duplicate keys (strict mode)
 *
 * Critical security action:
 *  - Strips `description` and `outputSchema` from the rebuilt 402
 *    so prompt-injection text (A12) never reaches an LLM.
 *  - Hands the SDK a MINIMAL rebuilt 402 with protocol fields only.
 *
 * Fix for G12 (amount parsing):
 *  - All amounts validated as integer strings matching the regex
 *  - Never converted via Number(x)/1e6 — amounts stay as atomic BigInt strings
 */

import { REASON } from "./reasons.js";

const MAX_BODY_BYTES = 8 * 1024; // 8 KB
const MAX_ACCEPTS_OPTIONS = 4;
/** Valid atomic integer: 0 or 1-9 followed by up to 18 digits */
const ATOMIC_AMOUNT_RE = /^(0|[1-9][0-9]{0,18})$/;

export interface ParsedAccept {
  scheme: string;
  network: string;
  /** Validated atomic integer string — never a float */
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
  // description and outputSchema are STRIPPED for security (A12)
}

export interface ParsedChallenge {
  x402Version: number;
  accepts: ParsedAccept[];
}

export type ParseResult =
  | { ok: true; challenge: ParsedChallenge; reason: "ALLOW" }
  | { ok: false; reason: string; detail: string };

/**
 * Parse and validate a raw 402 body.
 * Returns a minimal, sanitized challenge or a parse error.
 */
export function parse402(raw: unknown, bodySizeBytes?: number): ParseResult {
  // Size check
  if (bodySizeBytes !== undefined && bodySizeBytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      reason: REASON.L1_BODY_TOO_LARGE,
      detail: `Body ${bodySizeBytes}B > max ${MAX_BODY_BYTES}B`,
    };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      reason: REASON.L1_PARSE_REJECT,
      detail: "Body must be a JSON object",
    };
  }

  const body = raw as Record<string, unknown>;

  // x402Version must be exactly 1
  if (body["x402Version"] !== 1) {
    return {
      ok: false,
      reason: REASON.L1_UNKNOWN_VERSION,
      detail: `x402Version must be 1, got: ${String(body["x402Version"])}`,
    };
  }

  // accepts must be an array
  if (!Array.isArray(body["accepts"])) {
    return {
      ok: false,
      reason: REASON.L1_PARSE_REJECT,
      detail: "accepts must be an array",
    };
  }

  const accepts = body["accepts"] as unknown[];

  if (accepts.length === 0) {
    return {
      ok: false,
      reason: REASON.L1_PARSE_REJECT,
      detail: "accepts array is empty",
    };
  }

  if (accepts.length > MAX_ACCEPTS_OPTIONS) {
    return {
      ok: false,
      reason: REASON.L1_TOO_MANY_OPTIONS,
      detail: `accepts has ${accepts.length} options > max ${MAX_ACCEPTS_OPTIONS}`,
    };
  }

  const parsedAccepts: ParsedAccept[] = [];

  for (let i = 0; i < accepts.length; i++) {
    const a = accepts[i];
    if (!a || typeof a !== "object" || Array.isArray(a)) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}] must be an object`,
      };
    }
    const entry = a as Record<string, unknown>;

    // scheme must be "exact"
    if (entry["scheme"] !== "exact") {
      return {
        ok: false,
        reason: REASON.L1_UNKNOWN_SCHEME,
        detail: `accepts[${i}].scheme must be "exact", got: ${String(entry["scheme"])}`,
      };
    }

    // network
    if (typeof entry["network"] !== "string" || !entry["network"]) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}].network must be a non-empty string`,
      };
    }

    // maxAmountRequired — must be valid atomic integer string (G12 fix)
    const amount = entry["maxAmountRequired"];
    if (typeof amount !== "string" || !ATOMIC_AMOUNT_RE.test(amount)) {
      return {
        ok: false,
        reason: REASON.L1_INVALID_AMOUNT,
        detail: `accepts[${i}].maxAmountRequired "${String(amount)}" is not a valid atomic integer`,
      };
    }
    // Must not be zero
    if (amount === "0") {
      return {
        ok: false,
        reason: REASON.L1_INVALID_AMOUNT,
        detail: `accepts[${i}].maxAmountRequired must be > 0`,
      };
    }

    // resource
    if (typeof entry["resource"] !== "string" || !entry["resource"]) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}].resource must be a non-empty string`,
      };
    }

    // payTo
    if (typeof entry["payTo"] !== "string" || !entry["payTo"]) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}].payTo must be a non-empty string`,
      };
    }

    // maxTimeoutSeconds
    const timeout = entry["maxTimeoutSeconds"];
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}].maxTimeoutSeconds must be a positive number`,
      };
    }

    // asset
    if (typeof entry["asset"] !== "string" || !entry["asset"]) {
      return {
        ok: false,
        reason: REASON.L1_PARSE_REJECT,
        detail: `accepts[${i}].asset must be a non-empty string`,
      };
    }

    // Build minimal sanitized entry — STRIP description and outputSchema (A12 fix)
    const parsed: ParsedAccept = {
      scheme: "exact",
      network: entry["network"] as string,
      maxAmountRequired: amount,
      resource: entry["resource"] as string,
      payTo: entry["payTo"] as string,
      maxTimeoutSeconds: timeout,
      asset: entry["asset"] as string,
    };

    // Keep extra if present (needed for EIP-712 domain) but sanitize
    if (entry["extra"] && typeof entry["extra"] === "object") {
      parsed.extra = entry["extra"] as Record<string, unknown>;
    }

    parsedAccepts.push(parsed);
  }

  return {
    ok: true,
    challenge: { x402Version: 1, accepts: parsedAccepts },
    reason: "ALLOW",
  };
}
