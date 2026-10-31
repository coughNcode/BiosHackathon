# PayGuard AI — Backend Integration Report
**BIOS V2 Hackathon · Problem 3 · Backend Integration Milestone**
**Branch:** `integration/payguard-full-stack`
**Status:** All 5 Git Conflicts Resolved · Build Passing · 66/66 Automated Tests Passing · Pre-Commit Verification Complete

---

## 1. Executive Summary

This report documents the full integration of the three backend subsystems:
1. **BLUE (Defense & Security Validation Layer):** Zero-trust 6-layer payment firewall on port 4010, independent mock blockchain ledger on port 4040, cryptographic TOCTOU protection, and atomic SQLite state storage.
2. **RED (Adversarial Simulation & Attack Suite):** Hostile merchant on port 4020, adversarial facilitator on port 4030, attack lab console on port 4060, 10 attack scenarios (A01–A10), UCB1 adaptive bandit algorithm, and mutation fuzzer.
3. **COLLECTOR (Central Event & Evaluation Store):** High-throughput event ingestion on port 4050, WAL-mode SQLite event store, real-time run correlation engine, security metrics calculator, and defense scorecard API.

The active `git merge` of `origin/feature/collector-evaluation` onto `integration/payguard-full-stack` has been successfully resolved across all five conflicted files without discarding any staged assets or functionality.

---

## 2. Resolved Git Conflicts

| # | File | Resolution Strategy | Rationale & Changes |
|---|---|---|---|
| 1 | `.gitignore` | Combined Union | Excludes `.env`, `.env.*`, `node_modules/`, `dist/`, `build/`, `*.log`, `data/*.json`, and `data/*.db*`. Explicitly keeps example templates tracked: `!.env.example` and `!.env.collector.example`. |
| 2 | `docs/api-contracts/shared-contract.json` | Preserved Baseline + Collector Additions | Preserved baseline ports, payment requirement fields, shield check request/response schemas, event schemas, and event types. Incorporated collector endpoints (`/events`, `/runs`, `/metrics`, `/scorecard`), guard event schema, and security notes. |
| 3 | `docs/integration/blue-audit.md` | Unified Comprehensive Audit | Combined Phase 0 architectural audit with Blue Team security audit. Preserved all 11 security gap descriptions, TOCTOU signing boundary analysis, and full port topology without omitting security details. |
| 4 | `package.json` | Strict Engine Compatibility Merge | Reconciled dependencies and scripts. Selected `better-sqlite3@^12.11.1` and `vitest@^4.1.12` to ensure full compatibility with the local Node 20 runtime (`v20.20.2`). Preserved all Blue, Red, and Collector startup scripts and tests. |
| 5 | `package-lock.json` | Clean NPM Regeneration | Regenerated using `npm install` on Node `v20.20.2`. All 780 packages resolved and synchronized. No manual edits made to lockfile. |

---

## 3. Dependency Selection & Package Architecture

### Why `better-sqlite3@^12.11.1` (Not v13.0.3)
- `better-sqlite3@13.0.3` specifies `engines: { node: ">=22" }`.
- The current development and execution environment is Node.js `v20.20.2`, and repository policy requires `"node": ">=18"`.
- `better-sqlite3@^12.11.1` supports Node `20.x` and `22.x`, installs prebuilt binaries reliably, and provides the exact same C++ SQLite engine and WAL-mode API (`prepare`, `run`, `all`, `transaction`, `pragma`) used by both Blue (`src/db/database.ts`) and Collector (`src/collector/db.ts`).

### Why `vitest@^4.1.12` (Not v5.0.5)
- `vitest@5.0.5` requires Node `^22.12.0 || ^24.0.0 || >=26.0.0`.
- `vitest@4.1.12` is designed for Node `>=20.0.0` and runs cleanly on Node 20.20.2.

### Additional Key Dependencies Preserved:
- `uuid` (`^14.0.3`) and `@types/uuid` (`^10.0.0`): Utilized by Blue Agent, Mock Chain, Firewall, and Event Emitter.
- `zod` (`^4.6.7`): Strict runtime input schema validation across collector and guard modules.
- `express` (`^4.21.2`) and `cors` (`^2.8.6`): Modular HTTP server layer for all independent backend services.
- `viem` (`^2.21.0`), `@solana/web3.js`, `@solana/spl-token`: Crypto signing and payment rail support.

---

## 4. Backend System Topology & Port Allocation

Each backend service is completely decoupled and independently startable:

| Service | Port | Host Env Var | Primary Responsibilities |
|---|---|---|---|
| **Blue Agent** | `4010` | `BLUE_PORT`, `BLUE_HOST` | 6-layer firewall, TOCTOU verification, intent tokens, agent execution |
| **Mock Chain** | `4040` | `MOCK_CHAIN_PORT`, `HOST` | Neutral simulated ledger, atomic balance updates, EIP-3009 settlement |
| **Red Merchant** | `4020` | `MERCHANT_PORT`, `HOST` | 402 Payment Required challenges (honest & hostile modes) |
| **Red Facilitator** | `4030` | `FACILITATOR_PORT`, `HOST` | Payment settlement intermediary (normal, drop, malformed modes) |
| **Red Console** | `4060` | `RED_CONSOLE_PORT`, `HOST` | Attack execution, scenario catalog (A01–A10), UCB1 adaptive runner |
| **Collector** | `4050` | `COLLECTOR_PORT`, `HOST` | Event ingestion, run correlation, live metrics, scorecard API |
| **Legacy Daemon** | `4032` | `PORT` | Backward-compatible x402 V1/V2 wallet daemon |
| **Frontend SOC** | `5173` | `DASHBOARD_URL` | React + Tailwind SOC monitoring interface |

All services are configured to bind to `0.0.0.0` (not `127.0.0.1`) to ensure cross-laptop communication over a shared local network.

---

## 5. Startup Commands

| Subsystem | Command | Description |
|---|---|---|
| **Blue Agent** | `npm run blue` | Starts Blue firewall on `http://0.0.0.0:4010` |
| **Mock Chain** | `npm run chain` | Starts simulated ledger on `http://0.0.0.0:4040` |
| **Collector** | `npm run collector` | Starts Collector on `http://0.0.0.0:4050` |
| **Red All-in-One** | `npm run red` | Starts Red Merchant (4020), Facilitator (4030), and Console (4060) |
| **Red Merchant** | `npm run red:merchant` | Starts Red Merchant standalone |
| **Red Facilitator**| `npm run red:facilitator`| Starts Red Facilitator standalone |
| **Red Console** | `npm run red:console` | Starts Red Console standalone |
| **Legacy Daemon** | `npm run dev` | Starts original x402 daemon on port 4032 |
| **All Tests** | `npm test` | Runs Vitest suites (Firewall, Collector, Correlation) + Red TAP test suite |
| **TypeScript Build**| `npm run build` | Compiles entire repository (`tsc`) with zero errors |

---

## 6. End-to-End Event Integration & Correlation

### Event Pipeline Architecture
```
    [ RED TEAM ]                          [ BLUE FIREWALL ]                         [ MOCK CHAIN ]
   (Port 4020/4060)                         (Port 4010)                              (Port 4040)
          │                                      │                                        │
    ATTACK_STARTED                               │                                        │
    ATTACK_SENT ─────────────────────────> /shield-check                                  │
          │                                      │                                        │
          │                               PAYMENT_BLOCKED ──(If blocked)                  │
          │                                      OR                                       │
          │                               PAYMENT_APPROVED ─(If allowed)                  │
          │                                      │                                        │
          │                               SIGNER_INVOKED ───(Fingerprint Valid)           │
          │                               SIGNATURE_CREATED                               │
          │                               SETTLEMENT_ATTEMPTED ────────────────────> POST /settle
          │                                                                               │
          │                                                                      FUNDS_TRANSFERRED
          │                                                                             OR
          │                                                                         NO_TRANSFER
          │                                                                               │
    ATTACK_COMPLETED <────────────────────────────────────────────────────────────────────┘
          │
          ▼
   ═════════════════════════════════════════════════════════════════════════════════════════════
                                   COLLECTOR SERVICE (Port 4050)
   ═════════════════════════════════════════════════════════════════════════════════════════════
     • Ingests events into SQLite WAL table (`events`)
     • Correlates events by `runId` into unified `runs` record
     • Strict classification: ATTACK_BLOCKED | ATTACK_BYPASS | FUNDS_LOST | VALID_SUCCESS
     • Computes live metrics: detection rate, false positives, funds lost, latency percentiles
```

### Strict Evidence Segregation Guarantees
1. **`POLICY_APPROVED` ≠ `SIGNER_INVOKED`:** If a payment passes firewall checks, but the intent fingerprint fails at the signing boundary (TOCTOU attack A08), `verifyFingerprint` fails and the **signer is never called**.
2. **`SIGNER_INVOKED` ≠ `FUNDS_TRANSFERRED`:** A signature may be generated, but if the facilitator drops it or the chain rejects settlement, funds never leave the wallet.
3. **Neutral Chain Ledger:** The mock chain is the **sole source of truth** for funds transferred (`FUNDS_TRANSFERRED` vs `NO_TRANSFER`). Guard approval never implies settlement.
4. **Collector Resilience:** All event emissions use non-blocking fire-and-forget requests with timeouts. Collector unavailability **never** affects Blue security decisions or Red attack execution.

---

## 7. Key API Endpoints Reference

### Blue Agent (`:4010`)
- `POST /shield-check`: Zero-trust evaluation of payment challenge against L1–L6 security layers. Returns `{ allowed, intentToken, decision: { attackType, evidence, latencyMs } }`.
- `POST /agent/run`: Protected autonomous agent task execution with signing boundary fingerprint check.
- `GET /health`: Health status and port binding.
- `GET /audit`: Paginated historical decision log from SQLite.
- `GET /merchants`: Registered trusted providers registry.
- `GET /metrics`: Local firewall metrics.

### Mock Chain (`:4040`)
- `GET /health`: Mock chain health check.
- `GET /balances`: Current balances of all demo wallets.
- `GET /balance/:address`: Specific address balance.
- `POST /transfer`: Simulated token transfer with atomic integer validation.
- `POST /settle`: Simulated EIP-3009 settlement.
- `POST /reset`: Resets demo ledger balances to initial states.

### Red Console (`:4060`)
- `GET /health`: Console status and target configuration.
- `GET /scenarios`: Catalog of all 10 attack scenarios (A01–A10).
- `POST /attacks/run`: Execute a single attack scenario against Blue.
- `POST /attacks/run-all`: Execute complete attack matrix.
- `GET /status`: Live attack runner progress and UCB1 statistics.

### Collector Service (`:4050`)
- `POST /events`: Ingest structured PayGuard event.
- `GET /events`: Paginated list of ingested events or SSE stream.
- `GET /runs`: Correlated attack and control runs with classification and latency.
- `GET /metrics`: Aggregate defense metrics (detection rate, funds lost, bypasses).
- `GET /scorecard`: Per-attack scenario breakdown (expected vs actual decisions).
- `GET /health`: Collector health, event counts, and run counts.

---

## 8. Test Execution Results

All automated test suites were executed on the integrated codebase:

```bash
npm test
```

### Results Summary:
- **`tests/collector.test.ts` (Vitest):** 13 / 13 passed (100%)
  - Database schema initialization, event sanitization (redaction of keys/secrets), event ingestion, run correlation, metrics computation, scorecard calculation, SSE streams.
- **`tests/firewall.test.ts` (Vitest):** 30 / 30 passed (100%)
  - Schema validation, recipient binding, amount limits, integer arithmetic, nonce replay protection, budget reservations, TOCTOU intent fingerprint verification, collector offline tolerance.
- **`tests/correlation.test.ts` (Vitest):** 3 / 3 passed (100%)
  - Full attack lifecycle correlation (`ATTACK_STARTED` → `ATTACK_SENT` → `PAYMENT_BLOCKED` → `NO_TRANSFER` → `ATTACK_COMPLETED`).
  - Legitimate payment lifecycle correlation (`PAYMENT_APPROVED` → `SIGNER_INVOKED` → `SIGNATURE_CREATED` → `SETTLEMENT_ATTEMPTED` → `FUNDS_TRANSFERRED`).
  - Strict evidence segregation (approval does not move funds without chain confirmation).
- **`tests/red.test.ts` (Node Test Runner):** 20 / 20 passed (100%)
  - Attack catalog definitions (A01–A10), strict classification engine, UCB1 bandit selection, mutation fuzzer, CORS origin parser.

**Total Tests:** **66 passed, 0 failed.**

### Build Verification:
```bash
npm run build
```
- `tsc` exited with code `0`. Zero type errors.

---

## 9. Environment Variables Configuration

| Variable | Default Value | Used By | Purpose |
|---|---|---|---|
| `BLUE_PORT` | `4010` | Blue Agent | Port for Blue Agent firewall |
| `MOCK_CHAIN_PORT` | `4040` | Mock Chain | Port for mock chain ledger |
| `MOCK_CHAIN_URL` | `http://localhost:4040` | Blue / Red | URL to mock blockchain service |
| `COLLECTOR_PORT` | `4050` | Collector | Port for collector service |
| `COLLECTOR_URL` | `http://localhost:4050` | Blue / Red | Target collector endpoint for event telemetry |
| `MERCHANT_PORT` | `4020` | Red Merchant | Port for hostile merchant |
| `FACILITATOR_PORT` | `4030` | Red Facilitator | Port for mock facilitator |
| `RED_CONSOLE_PORT` | `4060` | Red Console | Port for Red attack console |
| `PORT` | `4032` | Legacy Server | Port for legacy x402 wallet daemon |
| `ADMIN_KEY` | `dev-admin-key` | All services | Authentication key for administrative endpoints |
| `SIGNING_SECRET` | `dev-secret-...` | Blue Agent | Secret key for HMAC intent token signing |
| `CORS_ORIGINS` | `https://*.lovable.app,...` | All services | Allowed CORS origins (wildcards supported) |
| `DB_FILE` | `./data/*.db` | Blue / Collector | SQLite file path for persistence |

---

## 10. Known Considerations Before Frontend Integration

1. **Active Merging State:** The active merge is resolved and staged. The repository awaits the user's explicit authorization before committing (`git commit`).
2. **Network IP Binding for Multi-Laptop Demo:** When testing across multiple laptops on the venue WiFi/hotspot, update `.env` variables (`BLUE_URL`, `COLLECTOR_URL`, `MOCK_CHAIN_URL`) with the actual LAN IP addresses of the respective machines. All servers already bind to `0.0.0.0`.
3. **Database Files Excluded:** Local `.db` files (`payguard-blue.db`, `payguard-collector.db`) are safely gitignored and will be created automatically on first run.
4. **Mock Chain Persistence:** The mock chain maintains in-memory balances during testing sessions and provides a `/reset` endpoint to restore clean balances between demonstration runs.
