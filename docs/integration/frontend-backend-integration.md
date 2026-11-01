# PayGuard AI — Frontend & Backend Full-Stack Integration Report

**Date:** November 1, 2026  
**Repository:** [https://github.com/coughNcode/BiosHackathon](https://github.com/coughNcode/BiosHackathon)  
**Branch:** `integration/payguard-full-stack`  
**Frontend Source Ref:** `origin/feature/lovable-frontend` (`ed6869a`)  
**Target Frontend Directory:** `frontend/`  
**Engineer:** Senior React, TypeScript, Vite & Backend Integration Engineer

---

## 1. Executive Summary

The existing Lovable React frontend (previously branded *WalletShield*) has been safely imported into `frontend/` and completely integrated with the PayGuard AI backend microservices:
1. **Blue Agent** (`:4010`) — Deterministic firewall checks, spending caps, identity registry, signed policy verdicts.
2. **Mock Chain** (`:4040`) — In-memory ledger, atomic balance updates, transfer verification.
3. **Collector** (`:4050`) — Event correlation engine, run timelines, live scorecard, and audit database.
4. **Red Team Engine** (`:4060`) — Adversarial attack console (A01–A10), UCB1 multi-armed bandit, and mutation fuzzer catalog.

The original cyberpunk visual design, neon accents, dark/light themes, animations, interactive charts, and user experience were preserved 100%. Product naming was unified under **PayGuard AI**. Mock data fallback was removed from Live Mode, and two new operational routes (`/inspector` and `/adaptive`) were added.

---

## 2. Frontend Import Strategy & Technology Stack

### Safe Extraction
The entire frontend codebase was extracted cleanly into `frontend/` without combining dependencies with the backend root `package.json`:
- `src/` — React application source code, components, routes, hooks, utilities.
- `public/` — Static assets and favicons.
- `package.json` & `package-lock.json` — Isolated frontend dependencies.
- `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` — Build and test configurations.

### Technology Stack
- **Framework:** React 19.2 + TypeScript 5.8
- **Bundler:** Vite 8.1.5 + Nitro (Cloudflare module preset)
- **Routing:** TanStack Router / TanStack Start (file-based routing via `routeTree.gen.ts`)
- **State Management:** Zustand 5.0
- **Data Fetching:** TanStack Query 5.90
- **Styling:** Tailwind CSS 4.1 + Vanilla CSS custom properties (`styles.css`)
- **Charts:** Recharts 2.15
- **Icons:** Lucide React 1.16
- **Test Runner:** Vitest 4.1.12 + Testing Library

---

## 3. Final Route List

The integrated frontend delivers eight distinct operational pages:

| Path | Name | Primary Backend API Sources | Purpose |
|---|---|---|---|
| `/` | Overview | Collector `:4050/metrics`, `:4050/runs`, Blue `:4010/policy` | Live KPI dashboard, recent runs, budget burn progress, attack category distribution pie chart |
| `/feed` | Live Feed | Collector `:4050/events` | Real-time event stream across Blue, Red, Chain, and Collector with search, filtering, and connection status |
| `/lab` | Red/Blue Lab | Red `:4060/attacks`, `:4060/redblue/run`, `:4060/redblue/result/:runId` | Adversarial attack console (A01–A10), attack firing animations, shatter/pass effects, live terminal, and scorecard |
| `/ml` | Risk Analytics | Blue `:4010/metrics`, Red `:4060/ucb1/state` | Multi-dimensional telemetry feature vectors, radar charts, live risk gauge, and heuristic feature weights (port 4033 references removed) |
| `/policy` | Policy Engine | Blue `:4010/policy`, Blue `:4010/providers` | Read-only view of daily spending budget, per-request cap, and trusted merchant registry |
| `/audit` | Audit Log | Collector `:4050/audit-log` | Verifiable append-only event log with server-side pagination, JSON evidence viewer, and CSV export |
| `/inspector` | Payment Inspector *(New)* | Collector `:4050/runs/:runId`, Red `:4060/redblue/result/:runId` | Forensic drill-down for selected run: expected vs received invariants, signer isolation boundary check, and event timeline |
| `/adaptive` | Adaptive UCB1 *(New)* | Red `:4060/ucb1/state`, Red `:4060/fuzzer/catalog` | Multi-armed bandit strategy scores, exploration/exploitation metrics, one-click optimal arm dispatch, and 27 mutation vectors |

---

## 4. API Mapping for Every Page

### Overview (`/`)
- **Collector `GET /metrics`:** Maps `totalAttacks`, `attacksBlocked`, `attacksBypass`, `fundsLost`, `detectionRate`, `avgLatencyMs`, `p95LatencyMs`, and `falsePositives`.
- **Collector `GET /runs`:** Displays the last 8 evaluated runs with attackId, runId, classification, and signer isolation state.
- **Blue Agent `GET /policy`:** Displays real daily budget ($1.00 USDC) and current spend tracking.

### Live Feed (`/feed`)
- **Collector `GET /events?limit=50`:** Polled every 2,000ms.
- Deduplication by `eventId` via `seenEventIds` `Set`.
- Supports filtering by `ALL`, `BLOCKED`, `APPROVED`, `CRITICAL`, `BLUE`, `RED`, `CHAIN`.
- Expandable JSON payload inspector for each event.
- Displays Collector connection status dot.

### Red/Blue Lab (`/lab`)
- **Red Console `GET /attacks`:** Loads real scenario catalog (A01–A10).
- **Single attack:**
  1. User selects scenario.
  2. Dispatches `POST /redblue/run` with `{ attackId }`.
  3. Receives unified `runId`.
  4. Polls `GET /redblue/result/:runId` until completed.
  5. Triggers shatter animation (`animate-packet-shatter`) on `ATTACK_BLOCKED`, or pass animation on `PASSED`.
  6. Prints verdict, violated check, expected vs received values, signer status, and latency to live terminal.
- **Full Benchmark:**
  1. Dispatches all 10 scenarios sequentially.
  2. Tracks progress bar and fills live Security Scorecard table.
  3. Computes grade tier (`S-TIER`, `A-TIER`, `B-TIER`, `NEEDS WORK`).

### Risk Analytics (`/ml`)
- Removed all connections to the deprecated port 4033 service.
- Removed claims of synthetic XGBoost retraining models.
- Displays real Blue Agent decision metrics (`GET /metrics`) and Red UCB1 bandit arms (`GET /ucb1/state`).
- Clearly banners multi-dimensional feature importance and radar vectors as heuristic telemetry.

### Policy (`/policy`)
- **Blue Agent `GET /policy`:** Reads `dailyBudgetUsd`, `perRequestMaxUsd`, and `tokenDecimals`.
- **Blue Agent `GET /providers`:** Populates trusted merchant table (`domain`, `payTo`, `network`, `asset`, `maxAmountUsd`).
- Labeled "Admin Key Protected" (write endpoints require `X-Admin-Key` and are not exposed to the browser).

### Audit Log (`/audit`)
- **Collector `GET /audit-log?limit=15&offset=N`:** Real paginated audit stream.
- Search filter queries eventId, source, eventType, runId, and payload.
- Detailed JSON forensics accordion on row click.
- Export CSV downloads real event records.

### Payment Inspector (`/inspector`)
- Populates run selector from Collector `GET /runs`.
- Queries Collector `GET /runs/:runId` and Red `GET /redblue/result/:runId`.
- Displays:
  - Violated check & suspicious field (`amount_guard`, `maxAmountRequired`).
  - Expected by Policy vs Received in Payload comparison.
  - Signer function invocation check (`ZERO INVOCATIONS (SAFE)` vs `INVOKED`).
  - Mock Chain transfer check (`ZERO BALANCE CHANGE (SAFE)` vs `FUNDS LOST`).
  - Chronological event timeline for the run.

### Adaptive Intelligence (`/adaptive`)
- **Red Console `GET /ucb1/state`:** Displays `totalPulls`, `arms` array (`attackId`, `pulls`, `totalReward`, `avgReward`, `ucbScore`), and `nextRecommended`.
- Includes "Pull Optimal Arm" button to trigger `POST /redblue/run { useUCB1: true }`.
- **Red Console `GET /fuzzer/catalog`:** Displays all 27 mutation vectors categorized by amount, payTo, asset, network, timeout, resource, scheme, and multi-field tampering.

---

## 5. Central API Client (`frontend/src/lib/api.ts`)

The central API client implements typed methods with request timeouts (`AbortSignal.timeout(6000)`), useful error reporting (`ApiError`), and clean separation between Live Mode and Demo Mode:

```typescript
// Base URLs from environment variables
export const MOCK = import.meta.env["VITE_MOCK_API"] === "true";
export const BLUE_URL = import.meta.env["VITE_BLUE_URL"] ?? "http://localhost:4010";
export const RED_URL = import.meta.env["VITE_RED_URL"] ?? "http://localhost:4060";
export const COLLECTOR_URL = import.meta.env["VITE_COLLECTOR_URL"] ?? "http://localhost:4050";
export const MOCK_CHAIN_URL = import.meta.env["VITE_MOCK_CHAIN_URL"] ?? "http://localhost:4040";
```

### Exported Methods
- **Blue Agent:** `getHealth()`, `getBluePolicy()`, `getBlueProviders()`, `getPolicy()`, `getBlueMetrics()`, `getBlueAuditLog()`, `postShieldCheck()`.
- **Red Team:** `getRedHealth()`, `getRedAttacks()`, `postRedRun()`, `getRedResult()`, `getRedHistory()`, `getUCB1State()`, `getFuzzerCatalog()`.
- **Collector:** `getCollectorHealth()`, `getCollectorEvents()`, `getCollectorEventById()`, `getCollectorRuns()`, `getCollectorRunById()`, `getCollectorMetrics()`, `getCollectorAuditLog()`, `getCollectorScorecard()`.
- **Mock Chain:** `getChainHealth()`, `getChainLedger()`, `getChainTransactions()`.

---

## 6. Environment Variables

### `frontend/.env` (Local Development)
```ini
# When VITE_MOCK_API is "false", frontend communicates directly with live services.
VITE_MOCK_API=false
VITE_BLUE_URL=http://localhost:4010
VITE_RED_URL=http://localhost:4060
VITE_COLLECTOR_URL=http://localhost:4050
VITE_MOCK_CHAIN_URL=http://localhost:4040
```

### Multi-Laptop Hackathon Configuration (`frontend/.env.example`)
```ini
# Laptop A (Blue Agent + Mock Chain):
# VITE_BLUE_URL=http://192.168.1.10:4010
# VITE_MOCK_CHAIN_URL=http://192.168.1.10:4040

# Laptop B (Red Team Engine):
# VITE_RED_URL=http://192.168.1.20:4060

# Laptop C (Collector & Evaluation):
# VITE_COLLECTOR_URL=http://192.168.1.30:4050
```

### Backend CORS Configuration
All backend services (`src/blue-agent.ts`, `src/collector/cors.ts`, `src/red/config.ts`, `src/mock-chain.ts`) allow:
```ini
CORS_ORIGINS=https://*.lovable.app,http://localhost:5173,http://localhost:3000,http://localhost:8080,http://127.0.0.1:8080
```

---

## 7. Startup Commands

### Start All Services (Single Laptop)

1. **Blue Agent & Firewall (:4010):**
   ```bash
   npm run blue
   ```
2. **Mock Chain (:4040):**
   ```bash
   npm run chain
   ```
3. **Collector & Evaluator (:4050):**
   ```bash
   npm run collector
   ```
4. **Red Team Console & Merchant (:4060, :4020, :4030):**
   ```bash
   npm run red
   ```
5. **PayGuard AI Frontend Dashboard (:8080):**
   ```bash
   cd frontend
   npm run dev
   ```

---

## 8. Demo Mode vs Live Mode Behavior

| Feature | Live Mode (`demo: false`) | Demo Mode (`demo: true`) |
|---|---|---|
| **Data Source** | Real HTTP requests to Blue (:4010), Red (:4060), Collector (:4050), Chain (:4040) | Isolated in-memory synthetic fixtures (`mock.ts`) |
| **Header Badge** | Pulsing green `LIVE` indicator with Base Sepolia network chip | High-visibility amber `DEMO / SYNTHETIC` banner |
| **Decision Feed** | Strictly polls Collector `GET /events` every 2s; deduplicates by `eventId`; zero fabricated events | Synthetic random decision generation every 2s for visual demonstration |
| **Attack Execution** | Dispatches real attacks via Red `POST /redblue/run` and polls results | Local deterministic simulation with instant playback |
| **Teleprompter** | Hidden | Displays contextual talking points bar at bottom of screen with `1-8` shortcut keys |
| **Network Safety** | Never sends synthetic demo payments to real chain | Completely isolated from real backend APIs |

---

## 9. Security & Secret Isolation

- **Zero Secret Leakage:** Checked that `ADMIN_KEY`, `SIGNING_SECRET`, private keys, and wallet credentials are NOT exposed in `VITE_` client variables.
- **Client Read-Only:** All administrative endpoints (such as `POST /budget/reset`, `POST /providers`, `POST /balances/reset`) require secret bearer keys and are disabled or omitted in the frontend client.
- **Deterministic Bounds:** All payment verdicts displayed in the UI show cryptographic proofs (violated check names, expected vs received values) rather than arbitrary LLM outputs.

---

## 10. Test Results & Verification

### Root Backend Test Suite
```bash
npm test
```
- **Vitest:** 3 test files, 46 passed (Collector, Firewall, Correlation).
- **Node:Test:** 5 test suites, 20 passed (Red catalog, classification, UCB1, fuzzer, CORS).
- **Total Backend Tests:** **66 / 66 PASSED (100%)**.

### Root Backend Build
```bash
npm run build
```
- TypeScript (`tsc`) compilation: **0 errors**.

### Frontend Test Suite
```bash
cd frontend && npm test
```
- `src/test/demo.test.ts` (2 passed)
- `src/test/tier.test.tsx` (5 passed)
- `src/test/app-routing.test.tsx` (1 passed)
- `src/test/integration.test.ts` (7 passed)
- **Total Frontend Tests:** **15 / 15 PASSED (100%)**.

### Frontend Production Build
```bash
cd frontend && npm run build
```
- Vite client bundle + SSR bundle + Nitro Cloudflare worker: **Built successfully in 11.45s with 0 errors**.

### Live HTTP / SSR Route Verification
All 8 routes respond with `HTTP 200 OK` and complete server-side rendered PayGuard AI HTML:
- `GET http://localhost:8080/` → `HTTP 200` (33,212 bytes)
- `GET http://localhost:8080/feed` → `HTTP 200` (23,046 bytes)
- `GET http://localhost:8080/lab` → `HTTP 200` (24,652 bytes)
- `GET http://localhost:8080/ml` → `HTTP 200` (28,019 bytes)
- `GET http://localhost:8080/policy` → `HTTP 200` (26,032 bytes)
- `GET http://localhost:8080/audit` → `HTTP 200` (23,529 bytes)
- `GET http://localhost:8080/inspector` → `HTTP 200` (20,698 bytes)
- `GET http://localhost:8080/adaptive` → `HTTP 200` (30,400 bytes)

---

## 11. Remaining Limitations & Hackathon Judge Notes

1. **Local Ports vs Multi-Laptop:** In a multi-laptop hackathon environment, update `frontend/.env` with the actual IP addresses of Laptop 1, Laptop 2, and Laptop 3 as outlined in `.env.example`.
2. **Mock Chain Scope:** The mock chain currently simulates Base Sepolia USDC transfers in memory; in a live mainnet deployment, this connects to the Base Sepolia RPC endpoint.
3. **Admin Controls:** Adding providers and resetting budget limits are intentionally locked in the frontend UI to prevent judge demonstrations from bypassing administrative key authorization.
