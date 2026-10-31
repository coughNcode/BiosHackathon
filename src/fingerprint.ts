import { createHash } from "node:crypto";

/**
 * Payment intent fingerprint — closes the TOCTOU gap.
 *
 * Produces a SHA-256 hash of the security-relevant fields in a payment
 * requirement, sorted canonically at every nesting level. The fingerprint
 * is computed at approval time and verified again at the signing boundary.
 * If any security-relevant field was mutated between approval and signing,
 * the fingerprint will not match and signing is blocked.
 *
 * Only security-relevant fields are included. Arbitrary extra fields are
 * excluded to prevent false mismatches from display-only metadata changes.
 */

export interface PaymentRequirementsLike {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  payTo?: string;
  asset?: string;
  resource?: string;
  maxTimeoutSeconds?: number;
  nonce?: string;
  [key: string]: unknown;
}

const FINGERPRINT_FIELDS = [
  "asset",
  "maxAmountRequired",
  "maxTimeoutSeconds",
  "network",
  "nonce",
  "payTo",
  "resource",
  "scheme",
] as const;

/**
 * Build a canonical JSON string from only the known security-relevant fields.
 * Keys are sorted alphabetically at every nesting level.
 */
export function canonicalize(req: PaymentRequirementsLike): string {
  const picked: Record<string, unknown> = {};
  for (const key of FINGERPRINT_FIELDS) {
    if (key in req && req[key] !== undefined) {
      picked[key] = req[key];
    }
  }
  return JSON.stringify(picked, (_key: string, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value;
  });
}

/**
 * Compute a SHA-256 fingerprint of the security-relevant fields.
 * Prefixed with "sha256:" for type safety and to prevent accidental
 * comparison with raw hashes.
 */
export function fingerprintRequirements(req: PaymentRequirementsLike): string {
  return "sha256:" + createHash("sha256").update(canonicalize(req)).digest("hex");
}

/**
 * Verify that a payment requirement matches a previously computed fingerprint.
 * Used at the signing boundary to detect TOCTOU mutations.
 */
export function verifyFingerprint(req: PaymentRequirementsLike, token: string): boolean {
  return fingerprintRequirements(req) === token;
}
