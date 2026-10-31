# Red Team Repository Audit & Integration Specification

**Document**: `docs/integration/red-audit.md`  
**Role**: Lead Red Team Engineer (Laptop B / Red Team Environment)  
**Branch**: `feature/red-attacks`  
**System**: PayGuard AI — Zero-Trust Payment Firewall for Autonomous AI Agents  
**Target Architecture**: BIOS V2 Hackathon — x402 Red/Blue (Problem 3)  

---

## 1. Executive Summary & Repository Audit

### Language and Runtime
- **Language**: TypeScript 5.7.2, ESM (`"type": "module"` in `package.json`).
- **Compiler Configuration**: Strict mode enabled (`"strict": true`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"` in `tsconfig.json`).
- **Runtime**: Node.js (>= 18; tested on Node 22 LTS) using `tsx` for execution.
- **Framework**: Express 4.21.2 (`express.json()` body parsing).
- **Core Dependencies**:
  - `viem` (^2.21.0) — EIP-712 typed data hashing and signature verification (`verifyTypedData`).
  - `@solana/web3.js` (^1.98.4) & `@solana/spl-token` (^0.4.15) — Solana USDC support.
  - `x402` (^1.2.0) & `x402-fetch` (^1.2.0) — Core micropayment framework.
  - `@three-ws/x402-payment-modal` (^1.2.0) — Solana checkout helper.
  - `node:crypto` — Deterministic HMAC-SHA256 signing and canonicalization.

### Existing Source Code Inventory
The baseline repository consists of seven core source files:

1. `src/server.ts` (150 lines):
   - Express daemon exposing `POST /policy-check` ($0.001 x402 paid), `POST /record-spend` (admin), `GET /ledger` (admin), `GET /policy`, `POST /verify`, `GET /.well-known/x402`, and `GET /health`.
   - Listens on port `4032` (or `PORT` environment variable). **Port 4032 is strictly preserved.**
2. `src/policy.ts` (319 lines):
   - `PolicyEngine` class providing daily budget, per-request caps, approval thresholds, merchant/rail allowlists and blocklists.
   - File-backed ledger in `data/spend-ledger.json`.
3. `src/wrap.ts` (141 lines):
   - Client-side fetch wrapper `wrapPayerFetch`.
   - Hooks into `x402-fetch`'s `select` callback to enforce policy before the wallet signs.
4. `src/payments.ts` (387 lines):
   - Dual-rail paywall middleware (`paywall(routePrices, opts)`).
   - Generates 402 challenge with `accepts[]` array for Base EVM and Solana.
   - Validates and settles via facilitator (`useFacilitator`).
5. `src/sign.ts` (45 lines):
   - Canonical JSON serialisation and HMAC-SHA256 signature generation/verification.
6. `src/schemas.ts` (178 lines):
   - Pre-generated OpenAPI request/response schema specifications (`ROUTE_SCHEMAS`).
7. `src/index.ts` (73 lines):
   - Barrel export of library utilities.

### Existing Attack Scenarios Audit
- **Pre-existing Attack Scenarios in Code**: **None**.
- The base repository was an open-source payment policy daemon (`@nirholas/x402-agent-wallet`) without adversarial tests, red team harnesses, or offensive simulation tools.
- Gap Register G1–G18 was documented in the architecture specification (`x402_red_blue_architecture_detailed.pdf`), which we have mapped into our 10 deterministic attack scenarios (`A01`–`A10`).

### Existing Test Suite Audit
- **Pre-existing Automated Tests**: **None** (`package.json` had no `test` script, and no test directory was present).
- Automated tests for all Red components (merchant, facilitator, console, UCB1, fuzzer, and classification logic) are introduced as part of this branch.

---

## 2. x402 Protocol Version Audit & Migration Plan

### Version Audit
The base repository operates on **x402 Version 1**:
- Response challenge: `res.status(402).json({ x402Version: 1, ... })` in `src/payments.ts:243`.
- Request authorization header: `req.header("X-PAYMENT")` in `src/payments.ts:278`.
- Settlement receipt header: `res.setHeader("X-PAYMENT-RESPONSE", ...)` in `src/payments.ts:336`.
- Client response decoding: `decodeXPaymentResponse` in `src/wrap.ts` and `examples/agent-client.ts`.

### Migration Strategy (V1 to V2)
In accordance with Hackathon specifications:
1. **Header Mapping**:
   - V2 Standard:
     - 402 Challenge header: `PAYMENT-REQUIRED` (or body with `x402Version: 2`).
     - Authorization header: `PAYMENT-SIGNATURE` (instead of `X-PAYMENT`).
     - Settlement receipt: `PAYMENT-RESPONSE` (instead of `X-PAYMENT-RESPONSE`).
2. **Backward Compatibility & Interoperability**:
   - The Red team's Mock Facilitator exposes `/supported` returning `{ x402Version: 1, ... }` or `{ x402Version: 2, ... }` based on client request.
   - Attack scenario **A15** (part of extended suite) verifies whether Blue is vulnerable to header confusion between V1 and V2 headers.
   - All Red components accept case-insensitive headers to ensure robust interoperability across versions.

---

## 3. Red Team Architecture & Boundaries (Laptop B)

Laptop B is dedicated to offensive validation and runs three independent services:

```
┌────────────────────────────────────────────────────────┐
│                   LAPTOP B (RED TEAM)                  │
│                                                        │
│   ┌─────────────────────┐   ┌──────────────────────┐   │
│   │   Hostile Merchant  │   │   Mock Facilitator   │   │
│   │     Port: 4020      │   │      Port: 4030      │   │
│   └──────────┬──────────┘   └───────────┬──────────┘   │
│              │                          │              │
│              └────────────┬─────────────┘              │
│                           ▼                            │
│             ┌───────────────────────────┐              │
│             │        Red Console        │              │
│             │        Port: 4060         │              │
│             │  • Attack Orchestrator    │              │
│             │  • UCB1 Adaptive Selector │              │
│             │  • Mutation Fuzzer        │              │
│             │  • Run History & Metrics  │              │
│             └─────────────┬─────────────┘              │
└───────────────────────────┼────────────────────────────┘
                            │ Attacks (HTTP POST)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   LAPTOP A (BLUE TEAM)                  │
│                                                        │
│       Guarded Agent (4010)   Mock Chain (4040)         │
│          POST /shield-check    GET /transfers          │
└────────────────────────────────────────────────────────┘
```

### Components Owned by Red (Laptop B):
1. **Hostile Merchant (Port 4020)**:
   - Configurable x402 merchant serving malicious and valid payment requirements.
   - `/mode` endpoint toggles the default scenario.
   - `/payment-required` endpoint delivers scenario payloads.
2. **Mock Facilitator (Port 4030)**:
   - Implements `POST /verify` and `POST /settle`.
   - Controllable failure modes: `normal`, `fail_verify`, `fail_settle`, `timeout`, `malformed`.
   - Sets `X-Facilitator-Type: mock` on every response; mock transactions are clearly flagged.
3. **Red Console & Orchestration (Port 4060)**:
   - Attack runner executing deterministic scenarios (`A01`–`A10`).
   - Mutation fuzzer generating single-field and multi-field perturbations.
   - UCB1 multi-armed bandit adaptive attack selector.
   - Run history tracking, classification, and event emission to Collector (`Port 4050`).

### Components NOT Owned by Red (Explicit Boundaries):
- **Blue Guard & Firewall (Port 4010)** — Owned by Laptop A.
- **Mock Chain (Port 4040)** — Owned by Laptop A (neutral judge).
- **Collector & Dashboard (Port 4050)** — Owned by Laptop 3 / Collector team.

---

## 4. Deterministic Attack Scenarios (A01–A10)

| Scenario ID | Attack Name | Target Field | Expected Blue Decision | Threat Level | Target Defense Layer |
|---|---|---|---|---|---|
| `A01_OVERPAY` | Overpayment Attack | `maxAmountRequired` ($10 USDC) | `BLOCK` | HIGH | L1 / L3 Spending Caps |
| `A02_WRONG_PAYTO` | PayTo Hijack | `payTo` (fake test address) | `BLOCK` | CRITICAL | L2 Identity / Allowlist |
| `A03_FAKE_TOKEN` | Fake Token Contract | `asset` (fake token address) | `BLOCK` | CRITICAL | L2 Asset Validation |
| `A04_WRONG_NETWORK` | Wrong Network | `network` (`ethereum-mainnet`) | `BLOCK` | HIGH | L2 Network Allowlist |
| `A05_EXPIRED` | Expired Timeout | `maxTimeoutSeconds` (0 seconds) | `BLOCK` | MEDIUM | L4 Window Enforcement |
| `A06_REPLAY` | Nonce Replay | `nonce` (reused value) | `BLOCK` | HIGH | L4 / L5 Replay Protection |
| `A07_DOMAIN_SPOOF` | Domain Impersonation | `resource` (`evil-impersonator.com`) | `BLOCK` | CRITICAL | L0 / L2 Host Registry |
| `A08_TOCTOU` | TOCTOU Mutation | `maxAmountRequired` (post-approval) | `BLOCK` | CRITICAL | L4 Wallet Pinning |
| `A09_BUDGET_EXHAUST` | Cumulative Drain | Sequential valid calls | `BLOCK` | HIGH | L5 Budget State |
| `A10_VALID` | Control Baseline | None (trusted valid values) | `ALLOW` | NONE | Baseline / Control |

---

## 5. Strict Classification Rules & Separation of Events

Three events must never be conflated:
1. **Policy APPROVED**: Blue's firewall returned `allowed: true`.
2. **Signer INVOKED**: The wallet signing function was actually called.
3. **Funds TRANSFERRED**: The mock chain recorded an actual balance change.

### Classification Matrix
- **`ATTACK_BLOCKED`**: Scenario is malicious (`A01`–`A09`), Blue returned `allowed: false`, and the signer was NOT invoked.
- **`ATTACK_BYPASS`**: Scenario is malicious (`A01`–`A09`), but Blue returned `allowed: true` or the signer was invoked.
- **`FUNDS_LOST`**: Mock chain confirms unauthorized debit for this run (CRITICAL security failure).
- **`FALSE_POSITIVE`**: Scenario is `A10_VALID`, but Blue returned `allowed: false` (over-blocking).
- **`VALID_SUCCESS`**: Scenario is `A10_VALID`, and Blue returned `allowed: true` with valid settlement.
- **`ATTACK_ERROR`**: Network failure, timeout, or infrastructure issue. Never counted as a successful defense.

---

## 6. Global Rules Compliance Checklist

- [x] **Rule 1**: Read repository before changing code (`Phase 0 Audit` complete).
- [x] **Rule 2**: Preserve working code (`src/server.ts`, `src/policy.ts`, `src/wrap.ts`, `src/payments.ts` left intact).
- [x] **Rule 3**: Do not build other laptops' components (no Blue firewall, no mock chain, no collector built).
- [x] **Rule 4**: Use environment variables for all service URLs (`BLUE_URL`, `MOCK_CHAIN_URL`, `COLLECTOR_URL`).
- [x] **Rule 5**: Every service exposes `GET /health` with service identity and port.
- [x] **Rule 6**: All services bind to `0.0.0.0` (configurable via `HOST` env var).
- [x] **Rule 7**: CORS enabled for `CORS_ORIGINS` (supporting `*.lovable.app`, `localhost:5173`, `localhost:3000`).
- [x] **Rule 8**: Zero exposure of private keys or secrets in logs, responses, or git.
- [x] **Rule 9**: Security decisions reside in backend code, not frontend.
- [x] **Rule 10 & 11**: Real classification without fabricated results or unsubstantiated 100% claims.
- [x] **Rule 12**: Mock data explicitly labelled with `mock: true` and `0xMOCK_` tx hashes.
- [x] **Rule 13**: Protocol versions documented and consistent (V1 baseline with V2 support).
- [x] **Rule 14**: Atomic token amounts formatted as integer strings (`1000` atomic units = $0.001 USDC).
- [x] **Rule 15**: Signer invocation verified via separate evidence endpoint, not assumed from `allowed: false`.
- [x] **Rule 16**: Collector outage handled gracefully without interrupting attack execution.

