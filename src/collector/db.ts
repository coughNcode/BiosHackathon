import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CollectorEvent, RunRecord } from "./types.js";

const DEFAULT_DB_FILE = "./data/payguard-collector.db";

/**
 * Sanitizes an object before serialization so no private keys or secrets are stored.
 */
export function sanitizeData(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val !== "object") return val;

  const FORBIDDEN_KEYS = new Set([
    "privatekey",
    "private_key",
    "secret",
    "signingsecret",
    "signing_secret",
    "adminkey",
    "admin_key",
    "key",
    "mnemonic",
    "seed",
    "password",
    "credential",
    "authorization",
  ]);

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeData(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      sanitized[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      sanitized[k] = sanitizeData(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export class CollectorDatabase {
  public readonly db: Database.Database;

  constructor(filePath?: string) {
    const dbPath = filePath || process.env.DB_FILE || DEFAULT_DB_FILE;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    // WAL mode for concurrent durability
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id    TEXT PRIMARY KEY,
        timestamp   TEXT NOT NULL,
        run_id      TEXT,
        source      TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        severity    TEXT NOT NULL,
        attack_id   TEXT,
        message     TEXT NOT NULL,
        data_json   TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        run_id         TEXT PRIMARY KEY,
        started_at     TEXT NOT NULL,
        finished_at    TEXT,
        attack_id      TEXT,
        source         TEXT,
        classification TEXT,
        blue_decision  TEXT,
        signer_invoked INTEGER,
        chain_transfer INTEGER,
        latency_ms     INTEGER
      );

      CREATE TABLE IF NOT EXISTS demo_events (
        event_id    TEXT PRIMARY KEY,
        timestamp   TEXT NOT NULL,
        run_id      TEXT,
        source      TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        severity    TEXT NOT NULL,
        attack_id   TEXT,
        message     TEXT NOT NULL,
        data_json   TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_attack_id ON events(attack_id);
      CREATE INDEX IF NOT EXISTS idx_runs_attack_id ON runs(attack_id);
      CREATE INDEX IF NOT EXISTS idx_runs_classification ON runs(classification);
    `);
  }

  // ── Event Ingestion ────────────────────────────────────────────────────────

  public insertEvent(evt: CollectorEvent): void {
    const cleanData = sanitizeData(evt.data);
    const stmt = this.db.prepare(`
      INSERT INTO events (
        event_id, timestamp, run_id, source, event_type,
        severity, attack_id, message, data_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        timestamp = excluded.timestamp,
        run_id = excluded.run_id,
        source = excluded.source,
        event_type = excluded.event_type,
        severity = excluded.severity,
        attack_id = excluded.attack_id,
        message = excluded.message,
        data_json = excluded.data_json,
        received_at = excluded.received_at
    `);

    stmt.run(
      evt.eventId,
      evt.timestamp,
      evt.runId,
      evt.source,
      evt.eventType,
      evt.severity,
      evt.attackId,
      evt.message,
      JSON.stringify(cleanData),
      evt.receivedAt
    );
  }

  // ── Event Queries ──────────────────────────────────────────────────────────

  public getEvents(filter: {
    runId?: string;
    attackId?: string;
    source?: string;
    eventType?: string;
    severity?: string;
    since?: string;
    limit?: number;
    offset?: number;
    demo?: boolean;
  }): { events: CollectorEvent[]; total: number } {
    const table = filter.demo ? "demo_events" : "events";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.runId) {
      conditions.push("run_id = ?");
      params.push(filter.runId);
    }
    if (filter.attackId) {
      conditions.push("attack_id = ?");
      params.push(filter.attackId);
    }
    if (filter.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }
    if (filter.eventType) {
      conditions.push("event_type = ?");
      params.push(filter.eventType);
    }
    if (filter.severity) {
      conditions.push("severity = ?");
      params.push(filter.severity);
    }
    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM ${table} ${whereClause}`);
    const countRow = countStmt.get(...params) as { total: number };
    const total = countRow?.total ?? 0;

    const limit = Math.max(1, filter.limit ?? 50);
    const offset = Math.max(0, filter.offset ?? 0);

    const queryParams = [...params, limit, offset];
    const selectCols = filter.demo
      ? "event_id, timestamp, run_id, source, event_type, severity, attack_id, message, data_json, timestamp as received_at"
      : "event_id, timestamp, run_id, source, event_type, severity, attack_id, message, data_json, received_at";

    const queryStmt = this.db.prepare(`
      SELECT ${selectCols}
      FROM ${table}
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const rows = queryStmt.all(...queryParams) as Array<{
      event_id: string;
      timestamp: string;
      run_id: string | null;
      source: string;
      event_type: string;
      severity: string;
      attack_id: string | null;
      message: string;
      data_json: string;
      received_at: string;
    }>;

    const events: CollectorEvent[] = rows.map((r) => ({
      eventId: r.event_id,
      timestamp: r.timestamp,
      runId: r.run_id,
      source: r.source,
      eventType: r.event_type,
      severity: r.severity,
      attackId: r.attack_id,
      message: r.message,
      data: safeJsonParse(r.data_json),
      receivedAt: r.received_at,
    }));

    return { events, total };
  }

  public getEventById(eventId: string, demo = false): CollectorEvent | null {
    const table = demo ? "demo_events" : "events";
    const cols = demo
      ? "event_id, timestamp, run_id, source, event_type, severity, attack_id, message, data_json, timestamp as received_at"
      : "event_id, timestamp, run_id, source, event_type, severity, attack_id, message, data_json, received_at";

    const stmt = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE event_id = ?`);
    const row = stmt.get(eventId) as {
      event_id: string;
      timestamp: string;
      run_id: string | null;
      source: string;
      event_type: string;
      severity: string;
      attack_id: string | null;
      message: string;
      data_json: string;
      received_at: string;
    } | undefined;

    if (!row) return null;

    return {
      eventId: row.event_id,
      timestamp: row.timestamp,
      runId: row.run_id,
      source: row.source,
      eventType: row.event_type,
      severity: row.severity,
      attackId: row.attack_id,
      message: row.message,
      data: safeJsonParse(row.data_json),
      receivedAt: row.received_at,
    };
  }

  // ── Run Records ────────────────────────────────────────────────────────────

  public upsertRun(run: Partial<RunRecord> & { runId: string }): void {
    const existing = this.getRunById(run.runId);

    if (!existing) {
      const stmt = this.db.prepare(`
        INSERT INTO runs (
          run_id, started_at, finished_at, attack_id, source,
          classification, blue_decision, signer_invoked, chain_transfer, latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        run.runId,
        run.startedAt ?? new Date().toISOString(),
        run.finishedAt ?? null,
        run.attackId ?? null,
        run.source ?? null,
        run.classification ?? null,
        run.blueDecision ?? null,
        run.signerInvoked !== undefined ? run.signerInvoked : null,
        run.chainTransfer !== undefined ? run.chainTransfer : null,
        run.latencyMs !== undefined ? run.latencyMs : null
      );
    } else {
      const stmt = this.db.prepare(`
        UPDATE runs SET
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at),
          attack_id = COALESCE(?, attack_id),
          source = COALESCE(?, source),
          classification = COALESCE(?, classification),
          blue_decision = COALESCE(?, blue_decision),
          signer_invoked = COALESCE(?, signer_invoked),
          chain_transfer = COALESCE(?, chain_transfer),
          latency_ms = COALESCE(?, latency_ms)
        WHERE run_id = ?
      `);
      stmt.run(
        run.startedAt ?? null,
        run.finishedAt ?? null,
        run.attackId ?? null,
        run.source ?? null,
        run.classification ?? null,
        run.blueDecision ?? null,
        run.signerInvoked !== undefined ? run.signerInvoked : null,
        run.chainTransfer !== undefined ? run.chainTransfer : null,
        run.latencyMs !== undefined ? run.latencyMs : null,
        run.runId
      );
    }
  }

  public getRuns(filter: {
    classification?: string;
    attackId?: string;
    limit?: number;
    offset?: number;
  }): { runs: RunRecord[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.classification) {
      conditions.push("classification = ?");
      params.push(filter.classification);
    }
    if (filter.attackId) {
      conditions.push("attack_id = ?");
      params.push(filter.attackId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countStmt = this.db.prepare(`SELECT COUNT(*) as total FROM runs ${whereClause}`);
    const countRow = countStmt.get(...params) as { total: number };
    const total = countRow?.total ?? 0;

    const limit = Math.max(1, filter.limit ?? 50);
    const offset = Math.max(0, filter.offset ?? 0);

    const queryStmt = this.db.prepare(`
      SELECT run_id, started_at, finished_at, attack_id, source, classification,
             blue_decision, signer_invoked, chain_transfer, latency_ms
      FROM runs
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = queryStmt.all(...params, limit, offset) as Array<{
      run_id: string;
      started_at: string;
      finished_at: string | null;
      attack_id: string | null;
      source: string | null;
      classification: string | null;
      blue_decision: string | null;
      signer_invoked: number | null;
      chain_transfer: number | null;
      latency_ms: number | null;
    }>;

    const runs: RunRecord[] = rows.map((r) => ({
      runId: r.run_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      attackId: r.attack_id,
      source: r.source,
      classification: r.classification,
      blueDecision: r.blue_decision,
      signerInvoked: r.signer_invoked,
      chainTransfer: r.chain_transfer,
      latencyMs: r.latency_ms,
    }));

    return { runs, total };
  }

  public getRunById(runId: string): RunRecord | null {
    const stmt = this.db.prepare(`
      SELECT run_id, started_at, finished_at, attack_id, source, classification,
             blue_decision, signer_invoked, chain_transfer, latency_ms
      FROM runs WHERE run_id = ?
    `);
    const r = stmt.get(runId) as {
      run_id: string;
      started_at: string;
      finished_at: string | null;
      attack_id: string | null;
      source: string | null;
      classification: string | null;
      blue_decision: string | null;
      signer_invoked: number | null;
      chain_transfer: number | null;
      latency_ms: number | null;
    } | undefined;

    if (!r) return null;

    return {
      runId: r.run_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      attackId: r.attack_id,
      source: r.source,
      classification: r.classification,
      blueDecision: r.blue_decision,
      signerInvoked: r.signer_invoked,
      chainTransfer: r.chain_transfer,
      latencyMs: r.latency_ms,
    };
  }

  // ── Demo Fixtures ──────────────────────────────────────────────────────────

  public seedDemoEvents(events: Array<{
    eventId: string;
    timestamp: string;
    runId?: string | null;
    source: string;
    eventType: string;
    severity: string;
    attackId?: string | null;
    message: string;
    data: Record<string, unknown>;
  }>): number {
    const insertStmt = this.db.prepare(`
      INSERT INTO demo_events (
        event_id, timestamp, run_id, source, event_type,
        severity, attack_id, message, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        timestamp = excluded.timestamp,
        run_id = excluded.run_id,
        source = excluded.source,
        event_type = excluded.event_type,
        severity = excluded.severity,
        attack_id = excluded.attack_id,
        message = excluded.message,
        data_json = excluded.data_json
    `);

    const runInsert = this.db.transaction((items) => {
      let count = 0;
      for (const item of items) {
        insertStmt.run(
          item.eventId,
          item.timestamp,
          item.runId ?? null,
          item.source,
          item.eventType,
          item.severity,
          item.attackId ?? null,
          item.message,
          JSON.stringify(sanitizeData(item.data))
        );
        count++;
      }
      return count;
    });

    return runInsert(events);
  }

  public clearDemoEvents(): number {
    const info = this.db.prepare("DELETE FROM demo_events").run();
    return info.changes;
  }

  public clearAll(): { eventsCleared: number; runsCleared: number; demoEventsCleared: number } {
    const tx = this.db.transaction(() => {
      const e = this.db.prepare("DELETE FROM events").run().changes;
      const r = this.db.prepare("DELETE FROM runs").run().changes;
      const d = this.db.prepare("DELETE FROM demo_events").run().changes;
      return { eventsCleared: e, runsCleared: r, demoEventsCleared: d };
    });
    return tx();
  }

  public getCounts(): { eventCount: number; runCount: number; demoEventCount: number } {
    const e = (this.db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number }).count;
    const r = (this.db.prepare("SELECT COUNT(*) as count FROM runs").get() as { count: number }).count;
    const d = (this.db.prepare("SELECT COUNT(*) as count FROM demo_events").get() as { count: number }).count;
    return { eventCount: e, runCount: r, demoEventCount: d };
  }

  public close(): void {
    this.db.close();
  }
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

