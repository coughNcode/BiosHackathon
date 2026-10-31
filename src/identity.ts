import { readFileSync, existsSync } from "node:fs";
import { getDatabase } from "./db/database.js";

/**
 * Trusted Provider Identity Registry.
 *
 * Domain is extracted from the resource URL and looked up against both the
 * config file and SQLite. Only the domain from the resource URL is used —
 * merchant display names, service names, icons, and hostnames from other
 * sources are never trusted as proof of identity.
 *
 * Address normalization:
 * - EVM (base-sepolia, base, ethereum): toLowerCase() for case-insensitive comparison
 * - Solana: case-sensitive comparison (base58 addresses are case-sensitive)
 */

export interface TrustedProvider {
  domain: string;
  payTo: string;
  network: string;
  asset: string;
  maxAmountUsd: number;
}

interface TrustedProvidersConfig {
  providers: Array<TrustedProvider & { _note?: string }>;
}

export class IdentityRegistry {
  private memoryCache: Map<string, TrustedProvider> = new Map();

  constructor(configPath?: string) {
    const filePath = configPath ?? "config/trusted-providers.json";
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as TrustedProvidersConfig;
      for (const p of raw.providers) {
        this.memoryCache.set(p.domain.toLowerCase(), {
          domain: p.domain.toLowerCase(),
          payTo: p.payTo,
          network: p.network,
          asset: p.asset,
          maxAmountUsd: p.maxAmountUsd,
        });
      }
    }
    this.loadFromDb();
  }

  private loadFromDb(): void {
    try {
      const db = getDatabase();
      const rows = db.prepare("SELECT domain, pay_to, network, asset, max_amount_usd FROM trusted_providers").all() as Array<{
        domain: string;
        pay_to: string;
        network: string;
        asset: string;
        max_amount_usd: number | null;
      }>;
      for (const row of rows) {
        this.memoryCache.set(row.domain.toLowerCase(), {
          domain: row.domain.toLowerCase(),
          payTo: row.pay_to,
          network: row.network,
          asset: row.asset,
          maxAmountUsd: row.max_amount_usd ?? 0,
        });
      }
    } catch {
      /* DB not yet initialized — config file entries only */
    }
  }

  /**
   * Extract domain from a resource URL and look up in the registry.
   * Returns null if the domain is not registered.
   */
  lookup(resourceUrl: string): TrustedProvider | null {
    let domain: string;
    try {
      domain = new URL(resourceUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
    return this.memoryCache.get(domain) ?? null;
  }

  /**
   * Normalize an address for comparison.
   * EVM addresses: toLowerCase() for case-insensitive comparison.
   * Solana addresses: kept as-is (base58 is case-sensitive).
   */
  normalizeAddress(address: string, network: string): string {
    const net = network.toLowerCase();
    if (net.startsWith("solana")) {
      return address;
    }
    return address.toLowerCase();
  }

  add(provider: TrustedProvider): void {
    const normalizedDomain = provider.domain.toLowerCase();
    const entry: TrustedProvider = {
      domain: normalizedDomain,
      payTo: provider.payTo,
      network: provider.network,
      asset: provider.asset,
      maxAmountUsd: provider.maxAmountUsd,
    };
    this.memoryCache.set(normalizedDomain, entry);
    try {
      const db = getDatabase();
      db.prepare(
        `INSERT OR REPLACE INTO trusted_providers (domain, pay_to, network, asset, max_amount_usd, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        normalizedDomain,
        entry.payTo,
        entry.network,
        entry.asset,
        entry.maxAmountUsd,
        new Date().toISOString(),
      );
    } catch {
      /* DB write failed — memory cache still updated */
    }
  }

  remove(domain: string): boolean {
    const normalizedDomain = domain.toLowerCase();
    const existed = this.memoryCache.delete(normalizedDomain);
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM trusted_providers WHERE domain = ?").run(normalizedDomain);
    } catch {
      /* DB delete failed */
    }
    return existed;
  }

  list(): TrustedProvider[] {
    return Array.from(this.memoryCache.values());
  }
}
