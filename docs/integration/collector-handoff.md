# PayGuard AI — Collector Service Handoff Document
**Role: Data & Integration Engineer**
**Target: Laptop 3 / Lovable AI Frontend Team / Bios V2 Hackathon Judges**
**Service:** Event Collector, Persistent Event Store & Evaluation Engine
**Port:** `4050` | **Host:** `0.0.0.0`
**Status:** Production Ready & Verified (13/13 Integration Tests Passing)

---

## 1. Executive Summary

The **PayGuard AI Event Collector** is the durable data engine and single source of truth for all judge-facing telemetry in the Lovable AI Security Operations Center (SOC). It provides real-time event ingestion, automated run correlation, precision/recall scorecard computation, and strictly isolated demo fixtures.

### Key Guarantees
1. **Zero Frontend Interference:** Strictly outputs clean, typed JSON. Contains zero React, Tailwind, or HTML code.
2. **Real vs Demo Isolation:** Live attack telemetry (`events` and `runs` tables) is strictly separated from synthetic demo fixtures (`demo_events` table).
3. **Data Sanitization:** Automatically scrubs sensitive data (private keys, secrets, credentials) before persisting to SQLite.
4. **Resilient Run Correlation:** Matches incoming events across Red, Blue, and the Mock Chain using `runId` to automatically calculate latency and classify attack outcomes.

---

## 2. Service Architecture & Schema

### SQLite Schema (`better-sqlite3` in WAL mode)

```sql
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
```

---

## 3. Environment Variables Configuration

| Variable | Default Value | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind IP for multi-laptop / LAN network access |
| `COLLECTOR_PORT` | `4050` | Port for the collector HTTP service |
| `DB_FILE` | `./data/payguard-collector.db` | Path to persistent SQLite database |
| `CORS_ORIGINS` | `https://*.lovable.app,http://localhost:5173,http://localhost:3000` | Allowed origins (no wildcard credentialed CORS) |
| `ADMIN_KEY` | `dev-admin-key` | Secret key required for complete data reset (`scope=all`) |
| `BLUE_URL` | `http://<LAPTOP1_IP>:4010` | LAN URL of guarded Blue payment agent |
| `RED_URL` | `http://<LAPTOP2_IP>:4060` | LAN URL of Red attack simulator console |
| `MOCK_CHAIN_URL` | `http://<LAPTOP1_IP>:4040` | LAN URL of neutral mock blockchain |

---

## 4. Run Correlation & Latency Rules

The correlation engine automatically tracks the 3 critical non-conflated milestones for every run:

1. **Policy Decision (`blue_decision`):** Set to `ALLOW` on `PAYMENT_APPROVED` or `BLOCK` on `PAYMENT_BLOCKED`.
2. **Signer Invocation (`signer_invoked`):** Set to `1` when `SIGNER_INVOKED` event is received from the wallet guard.
3. **Chain Transfer (`chain_transfer`):** Set to `1` on `FUNDS_TRANSFERRED` and `0` on `NO_TRANSFER`.

### Latency Calculation:
$$\text{Latency} = \text{Timestamp}(\text{Decision Event}) - \text{Timestamp}(\text{PAYMENT\_VALIDATION\_STARTED})$$
If validation start is not present, it measures from `ATTACK_STARTED`.

### Classification Logic:
- **`VALID_SUCCESS`:** Control scenario (`A10`), Blue decision = `ALLOW`, Chain transfer = `1`.
- **`FALSE_POSITIVE`:** Control scenario (`A10`), Blue decision = `BLOCK`.
- **`ATTACK_BLOCKED`:** Malicious scenario (`A01`–`A09`, `A11`–`A18`), Blue decision = `BLOCK`.
- **`ATTACK_BYPASS`:** Malicious scenario, Blue decision = `ALLOW`, Chain transfer = `0`.
- **`FUNDS_LOST`:** Malicious scenario, Blue decision = `ALLOW`, Chain transfer = `1` (Attacker drained funds).
- **`ATTACK_ERROR`:** Scenario execution failed (excluded from scoring ratios).

---

## 5. Complete API Reference

| Method | Path | Auth Required | Description |
|---|---|---|---|
| `GET` | `/health` | None | Service status, port, and live event/run counts |
| `POST` | `/events` | None | Ingests event, validates schema via Zod, updates correlated run |
| `GET` | `/events` | None | Returns paginated events with filtering (`runId`, `attackId`, `source`, `since`, `demo`) |
| `GET` | `/events/:eventId`| None | Retrieves single event by ID |
| `GET` | `/runs` | None | Returns all correlated runs with classifications |
| `GET` | `/runs/:runId` | None | Returns run record plus full chronological event timeline |
| `GET` | `/metrics` | None | Live metrics: total attacks, blocked, bypass, latency, detection rate |
| `GET` | `/audit-log` | None | Paginated security decisions in reverse chronological order |
| `GET` | `/scorecard` | None | Confusion matrix (TP, FP, FN, TN, precision, recall, F1, perAttack) |
| `POST` | `/evaluation/run` | None | Triggers immediate metric recalculation from persisted records |
| `POST` | `/evaluation/reset`| `Bearer $ADMIN_KEY` for `all` | Scoped reset (`demo` vs `all` with `confirm: true`) |
| `POST` | `/demo/seed` | None | Seeds `demo_events` with 32 synthetic fixtures covering all attacks |

*Full JSON request and response schemas are documented in [`docs/api-contracts/frontend-api-contract.md`](file:///Users/mannatsaini/Downloads/x402-agent-wallet-main/docs/api-contracts/frontend-api-contract.md).*

---

## 6. Startup Commands

```bash
# 1. Start the Collector Service
npm run collector
# Or:
npx tsx src/collector/server.ts

# 2. Run Integration Tests
npm test
# Or:
npx vitest run tests/collector.test.ts
```

---

## 7. Verified Test Results

All 13 integration tests pass deterministically:
```
✓ PayGuard AI Event Collector Integration Tests (13)
  ✓ GET /health returns 200 with initial counts
  ✓ Empty dataset returns zeros and null ratios (no NaN or errors)
  ✓ POST /events stores valid event in SQLite and sanitizes secrets
  ✓ POST /events handles missing eventId by auto-generating a UUID
  ✓ POST /events returns 400 for malformed payload and does not store it
  ✓ Handles duplicate event IDs gracefully (idempotent / upsert)
  ✓ GET /events returns events with correct filtering and pagination
  ✓ Run correlation: tracks full lifecycle, latency, and classification
  ✓ POST /demo/seed and demo mode isolation
  ✓ POST /evaluation/reset with scope=demo clears ONLY demo events
  ✓ POST /evaluation/reset with scope=all requires admin key and confirmation
  ✓ Collector restart: persisted events survive new DB instance
  ✓ CORS: trusted origin receives allow header, untrusted origin is rejected on OPTIONS
```

---

## 8. Known Limitations & Handoff Notes

1. **Storage Concurrency:** SQLite in WAL mode safely supports concurrent reads and writes. If multi-process clustering is needed, use standard SQLite file locking.
2. **Hotspot IP Changes:** Before demoing, verify that `BLUE_URL` and `RED_URL` in `.env` match the current Wi-Fi/hotspot IP addresses.
3. **No External Network Dependencies:** The collector operates 100% locally and offline without public internet access.

