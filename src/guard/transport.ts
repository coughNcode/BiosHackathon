/**
 * L0 — Transport Guard
 *
 * First checkpoint. Checks the URL BEFORE any network request is made.
 * A payment that fails here never hits the network.
 *
 * Blocks:
 *  - Origin not in the allowlist (exact ASCII match — no trailing dots, no subdomains)
 *  - Userinfo (credentials) present in URL
 *  - Any redirect to a different host (handled via fetch manual redirect mode)
 *  - HTTP origin for an HTTPS-pinned endpoint
 *
 * Fix for G5 (blocklist bypass):
 *   We use an ALLOWLIST not a blocklist.
 *   The allowlist stores the full ASCII origin (scheme + host + port).
 *   We strip trailing dots from the host before comparison.
 *   A trailing-dot or subdomain variant of an allowed host does NOT match.
 */

import { domainToASCII } from "node:url";
import { REASON, type ReasonCode } from "./reasons.js";

export interface AllowedOrigin {
  /** Full origin, e.g. "http://192.168.77.2:4020" */
  origin: string;
}

export interface TransportGuardOptions {
  /** Exact ASCII origins this agent may contact. If empty, all origins blocked. */
  allowedOrigins: AllowedOrigin[];
}

export interface TransportCheckResult {
  allowed: boolean;
  reason: ReasonCode;
  detail?: string;
  normalizedOrigin?: string;
}

/**
 * Normalize a URL into its canonical ASCII origin.
 * Strips trailing dots from the hostname.
 * Returns null if the URL is unparseable.
 */
export function normalizeOrigin(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    // Strip trailing dot from hostname (G5 fix)
    const asciiHost = domainToASCII(u.hostname.replace(/\.+$/, ""));
    const port = u.port ? `:${u.port}` : "";
    return `${u.protocol}//${asciiHost}${port}`;
  } catch {
    return null;
  }
}

/**
 * Check if a request URL is allowed by the transport layer.
 * Does NOT make any network requests.
 */
export function checkTransport(
  rawUrl: string,
  options: TransportGuardOptions
): TransportCheckResult {
  // Parse the URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      reason: REASON.L0_ORIGIN_NOT_ALLOWED,
      detail: `Unparseable URL: ${rawUrl}`,
    };
  }

  // Block userinfo (credentials in URL)
  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      reason: REASON.L0_USERINFO_IN_URL,
      detail: "URL contains credentials (userinfo)",
    };
  }

  const normalizedOrigin = normalizeOrigin(rawUrl);
  if (!normalizedOrigin) {
    return {
      allowed: false,
      reason: REASON.L0_ORIGIN_NOT_ALLOWED,
      detail: "Could not normalize URL origin",
    };
  }

  // Check allowlist — exact ASCII origin match
  const allowed = options.allowedOrigins.some(
    (a) => a.origin === normalizedOrigin
  );

  if (!allowed) {
    return {
      allowed: false,
      reason: REASON.L0_ORIGIN_NOT_ALLOWED,
      detail: `Origin ${normalizedOrigin} is not in the allowlist`,
      normalizedOrigin,
    };
  }

  return { allowed: true, reason: REASON.ALLOW, normalizedOrigin };
}

/**
 * Build a guarded fetch that:
 *  1. Checks the origin before any request
 *  2. Uses manual redirect mode so redirects to other hosts are caught
 *  3. Blocks HTTP→HTTPS downgrade attempts
 */
export function guardedFetch(
  baseFetch: typeof globalThis.fetch,
  options: TransportGuardOptions
): typeof globalThis.fetch {
  return async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    const check = checkTransport(rawUrl, options);
    if (!check.allowed) {
      throw new Error(`[PayGuard L0] ${check.reason}: ${check.detail ?? rawUrl}`);
    }

    // Force manual redirect — we inspect before following
    const response = await baseFetch(input, {
      ...init,
      redirect: "manual",
    });

    // Block redirects to different origins
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      const location = response.headers.get("location")!;
      const redirectOrigin = normalizeOrigin(
        new URL(location, rawUrl).toString()
      );
      const sourceOrigin = check.normalizedOrigin!;

      if (redirectOrigin !== sourceOrigin) {
        throw new Error(
          `[PayGuard L0] ${REASON.L0_REDIRECT_HOST}: redirect from ${sourceOrigin} to ${redirectOrigin}`
        );
      }
    }

    return response;
  };
}
