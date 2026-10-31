import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * SQLite singleton for the Blue Agent security layer.
 *
 * Creates all tables on first run. Used for:
 * - Nonce replay protection (seen_nonces)
 * - Security decision audit log (security_decisions)
 * - Spend tracking (spend_entries) — replaces JSON file ledger
 * - Budget reservations for concurrent safety (budget_reservations)
 * - Attack run scorecards (attack_runs)
 * - Trusted provider registry (trusted_providers)
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen_nonces (
  id          TEXT PRIMARY KEY,
  network     TEXT NOT NULL,
  settled_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_decisions (
  decision_id      TEXT PRIMARY KEY,
  allowed          INTEGER NOT NULL,
  attack_type      TEXT,
  violated_check   TEXT,
  suspicious_field TEXT,
  evidence_json    TEXT NOT NULL,
  intent_token     TEXT,
  latency_ms       INTEGER,
  decided_at       TEXT NOT NULL,
  payment_req_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_entries (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  merchant    TEXT NOT NULL,
  amount_usd  REAL NOT NULL,
  resource    TEXT,
  network     TEXT,
  rail        TEXT,
  verdict_id  TEXT,
  reason      TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  reservation_id  TEXT PRIMARY KEY,
  amount_atomic   TEXT NOT NULL,
  network         TEXT NOT NULL,
  reserved_at     TEXT NOT NULL,
  status          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attack_runs (
  run_id         TEXT PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  target_url     TEXT NOT NULL,
  total_attacks  INTEGER NOT NULL,
  detected       INTEGER,
  missed         INTEGER,
  false_pos      INTEGER,
  scorecard_json TEXT
);

CREATE TABLE IF NOT EXISTS trusted_providers (
  domain         TEXT PRIMARY KEY,
  pay_to         TEXT NOT NULL,
  network        TEXT NOT NULL,
  asset          TEXT NOT NULL,
  max_amount_usd REAL,
  added_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nonces_network_expires
  ON seen_nonces (network, expires_at);

CREATE INDEX IF NOT EXISTS idx_decisions_decided
  ON security_decisions (decided_at, allowed, attack_type);

CREATE INDEX IF NOT EXISTS idx_spend_entries_at
  ON spend_entries (at, kind);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_status
  ON budget_reservations (status, reserved_at);
`;

let _db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolvedPath = dbPath ?? process.env.DB_FILE ?? "./data/payguard-blue.db";
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(resolvedPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDatabaseForTest(dbPath?: string): Database.Database {
  closeDatabase();
  const path = dbPath ?? ":memory:";
  _db = new Database(path);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);
  return _db;
}
