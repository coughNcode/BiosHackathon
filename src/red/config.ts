/**
 * Red Team environment configuration.
 *
 * All service URLs come from environment variables — never hardcode a LAN IP.
 */
import "dotenv/config";

export const RED_CONFIG = {
  /** Bind address for all Red services. */
  host: process.env.HOST ?? "0.0.0.0",

  /** Hostile Merchant port. */
  merchantPort: Number(process.env.MERCHANT_PORT ?? 4020),

  /** Mock Facilitator port. */
  facilitatorPort: Number(process.env.FACILITATOR_PORT ?? 4030),

  /** Red Console / orchestration port. */
  consolePort: Number(process.env.RED_CONSOLE_PORT ?? 4060),

  /** Blue firewall URL — the target we are testing. */
  blueUrl: process.env.BLUE_URL ?? "http://localhost:4010",

  /** Mock chain URL — source of truth for fund transfers. */
  mockChainUrl: process.env.MOCK_CHAIN_URL ?? "http://localhost:4040",

  /** Collector URL — where Red events are sent. */
  collectorUrl: process.env.COLLECTOR_URL ?? "http://localhost:4050",

  /** Admin key for Blue's protected endpoints. */
  blueAdminKey: process.env.BLUE_ADMIN_KEY ?? "dev-admin-key",

  /** CORS origins, comma-separated with optional wildcards. */
  corsOrigins: process.env.CORS_ORIGINS ?? "https://*.lovable.app,http://localhost:5173,http://localhost:3000,http://localhost:8080,http://127.0.0.1:8080",
} as const;

/**
 * Parse CORS_ORIGINS into an Express-compatible origin checker.
 *
 * Supports exact matches and `*.domain` wildcard-subdomain patterns.
 * Never uses wildcard credentialed CORS.
 */
export function parseCorsOrigins(raw: string): (string | RegExp)[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .map((origin) => {
      if (origin.includes("*")) {
        const escaped = origin
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[a-zA-Z0-9.-]+");
        return new RegExp(`^${escaped}$`);
      }
      return origin;
    });
}

