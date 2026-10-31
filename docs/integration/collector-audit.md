# Collector & Integration Architecture Audit
**PayGuard AI — Data & Integration Engineer Phase 0 Audit**
*Target: BIOS V2 Hackathon · Problem 3 (x402 Red/Blue) · Port 4050*

---

## 1. Executive Summary & Role Boundary

As the **Data / Integration Engineer** for PayGuard AI:
- **Core Responsibility:** Build the event collector service, SQLite durable event store, run correlation engine, live metrics computation, security scorecard, and clean JSON APIs.
- **Frontend Boundary:** The judge-facing Security Operations Center (SOC) dashboard is being built entirely in **Lovable AI**.
  - **Rule:** We do **NOT** build a React dashboard, Tailwind UI, charts, or any HTML rendering in this service.
  - **Rule:** The collector service exclusively outputs high-performance, predictable, well-documented JSON APIs.
  - **Rule:** Live production data and synthetic demo data are stored in completely separate SQLite tables (`events` vs `demo_events`) and are never mixed.

---

## 2. Existing Repository State & Compatibility

### Technology Stack
- **Language / Runtime:** TypeScript 5.7.2, Node.js `>=18` (`ES2022`, `NodeNext` module resolution).
- **Web Framework:** Express 4.21.2.
- **Database:** SQLite via `better-sqlite3` (WAL mode enabled for concurrent reader/writer safety).
- **Validation:** `zod` for strict incoming event schema enforcement.
- **CORS:** Configured dynamically via `CORS_ORIGINS` to allow Lovable origins (`https://*.lovable.app`, `http://localhost:5173`, `http://localhost:3000`).

### Preserved Existing Functionality
The existing repo provides the core spending policy and daemon:
- `src/policy.ts`: Budget cap enforcement.
- `src/wrap.ts`: Client fetch wrapper.
- `src/payments.ts`: Dual-rail x402 paywall.
- `src/server.ts`: Preserved daemon running on port 4032.
- `src/guard/*`: 9-layer security firewall on Blue agent (Laptop 1).

The **Collector Service** runs as a standalone service on **Port 4050**, binding to **0.0.0.0**, without interfering with or mutating existing daemon code.

---

## 3. Storage Architecture: Live vs Demo Separation

To guarantee 100% scientific integrity during judging:
- `events`: Contains real incoming events from Red attack simulator and Blue security firewall.
- `runs`: Contains correlated attack-to-defense run summaries with timestamps, classification, and latency.
- `demo_events`: Contains pre-seeded synthetic fixtures (`POST /demo/seed`) for Lovable offline/demo testing.
- **API Isolation:** Live endpoints (`GET /events`, `GET /metrics`, `GET /scorecard`) query **only** the `events` and `runs` tables. Only explicit `?demo=true` queries access `demo_events`.

---

## 4. Run Correlation & Event Segregation Model

Events from Red (attacker), Blue (defender), and the Mock Chain (ledger judge) are correlated by `run_id`:

```
               [RED] ATTACK_STARTED (creates run, started_at)
                             │
               [BLUE] PAYMENT_APPROVED or PAYMENT_BLOCKED (sets blue_decision)
                             │
               [WALLET] SIGNER_INVOKED (sets signer_invoked = 1)
                             │
               [CHAIN] FUNDS_TRANSFERRED (chain_transfer = 1) or NO_TRANSFER (chain_transfer = 0)
                             │
               [RED] ATTACK_COMPLETED or ATTACK_ERROR (sets finished_at, classification, latency_ms)
```

### Three Non-Conflated Milestones:
1. `blue_decision` = `ALLOW` | `BLOCK` (Policy decision)
2. `signer_invoked` = `0` | `1` (Cryptographic signing execution)
3. `chain_transfer` = `0` | `1` (Ground-truth settlement)

---

## 5. Security & Data Sanitization Rules

1. **No Sensitive Leaks:** Private keys, signing secrets, mnemonic phrases, and auth tokens are stripped/redacted from the `data` field prior to SQLite persistence.
2. **Administrative Actions:** Complete resets (`POST /evaluation/reset?scope=all`) require `Authorization: Bearer <ADMIN_KEY>`. Demo resets (`scope=demo`) do not touch live attack telemetry.
3. **No Wildcard Credentialed CORS:** CORS origin validation matches exact hostnames or regex for Lovable subdomains (`https://*.lovable.app`).

---

## 6. Collector Service Implementation Roadmap

- **Phase 1:** SQLite database initialization (`better-sqlite3`, WAL mode, indexes).
- **Phase 2:** Express collector application (`src/collector/server.ts`) with all 11 required endpoints.
- **Phase 3:** Automated run correlation engine with latency calculation.
- **Phase 4:** Demo fixtures (`src/demo-fixtures.ts`) and Lovable API documentation (`docs/api-contracts/frontend-api-contract.md`).
- **Phase 5:** Vitest integration test suite covering ingestion, filtering, correlation, metrics, scorecard, and CORS.
- **Phase 6:** Service handoff document (`docs/integration/collector-handoff.md`).

