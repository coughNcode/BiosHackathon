# Blue Team — Integration & Security Handoff

**Component:** PayGuard AI — Zero-Trust Payment Firewall (Blue Agent & Mock Chain)  
**Version:** 1.0.0  
**Date:** 2026-11-01  
**Lead Engineer:** Blue Team Security Lead (Laptop 1)  

---

## 1. Architecture Overview

PayGuard AI acts as a zero-trust payment security layer between autonomous AI agents and x402 payment settlement. It eliminates the Time-Of-Check to Time-Of-Use (TOCTOU) vulnerability and enforces strict policy bounds before any private key or wallet signer is ever invoked.

```
                      ┌────────────────────────────────────────────────────────┐
                      │                     AI AGENT                           │
                      └──────────────────────────┬─────────────────────────────┘
                                                 │
                                                 │ 1. Payment Required (402)
                                                 ▼
                      ┌────────────────────────────────────────────────────────┐
                      │            WALLET SHIELD FIREWALL (Port 4010)          │
                      │                                                        │
                      │  Layer 1: Schema & Expiry Check (Zod + UTC)           │
                      │  Layer 2: Recipient Identity Binding (Registry)        │
                      │  Layer 3: Amount Guard (Integer / BigInt arithmetic)   │
                      │  Layer 4: Replay Protection (Atomic SQLite Nonce)      │
                      │  Layer 5: Budget Policy (Atomic reservation)           │
                      │  Layer 6: Canonical Intent Fingerprint Lock           │
                      └──────────────────────────┬─────────────────────────────┘
                                                 │
                                                 │ Allowed: Returns intentToken
                                                 │ Blocked: Reason code + evidence
                                                 ▼
                      ┌────────────────────────────────────────────────────────┐
                      │              SIGNING BOUNDARY ADAPTER                  │
                      │  Re-verifies canonical fingerprint against intentToken │
                      │  BLOCKS if payload mutated between check and sign!     │
                      └──────────────────────────┬─────────────────────────────┘
                                                 │
                                                 │ Signs authorization
                                                 ▼
                      ┌────────────────────────────────────────────────────────┐
                      │              MOCK SETTLEMENT CHAIN (Port 4040)         │
                      │  Independent ledger truth with BigInt balance checks   │
                      └────────────────────────────────────────────────────────┘
```

---

## 2. Ports & Network Interfaces

| Service | Port | Host Binding | Purpose |
|---|---|---|---|
| **Original Wallet Daemon** | `4032` | `0.0.0.0` / `localhost` | Existing x402 policy daemon & routes |
| **Blue Agent Firewall** | `4010` | `0.0.0.0` (LAN accessible) | Payment firewall, identity registry, agent runner |
| **Mock Chain Ledger** | `4040` | `0.0.0.0` (LAN accessible) | Independent settlement ledger & balance records |

---

## 3. Endpoints & Request/Response Contracts

### Blue Agent (Port 4010)

#### `GET /health`
Returns service status and port.
- **Status:** `200 OK`
```json
{
  "status": "ok",
  "service": "blue-agent",
  "port": 4010,
  "timestamp": "2026-10-31T20:28:18.083Z"
}
```

#### `POST /shield-check`
Primary firewall screening endpoint. Validates payment requirements against all 6 layers.
- **Request Body:**
```json
{
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "1000",
    "payTo": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "resource": "https://demo.payguard-merchant.local/paid-api",
    "maxTimeoutSeconds": 60,
    "nonce": "optional_nonce_uuid"
  },
  "runId": "optional_run_id"
}
```
- **Response (Allowed):**
```json
{
  "allowed": true,
  "intentToken": "sha256:9f61f9ae7ad1d9906b894458fe9a13a2cd73a05d53920c1ebfbe30fb7607e760",
  "decision": {
    "decisionId": "dec_uuid",
    "allowed": true,
    "attackType": null,
    "violatedCheck": null,
    "suspiciousField": null,
    "evidence": null,
    "intentToken": "sha256:9f61f9ae7ad1d9906b894458fe9a13a2cd73a05d53920c1ebfbe30fb7607e760",
    "latencyMs": 2,
    "decidedAt": "2026-10-31T20:28:18.000Z"
  }
}
```
- **Response (Blocked):**
```json
{
  "allowed": false,
  "intentToken": null,
  "decision": {
    "decisionId": "dec_uuid",
    "allowed": false,
    "attackType": "WRONG_RECIPIENT",
    "violatedCheck": "recipient_identity",
    "suspiciousField": "payTo",
    "evidence": {
      "expected": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "received": "0xDeadBeef0000000000000000000000000000001"
    },
    "intentToken": null,
    "latencyMs": 1,
    "decidedAt": "2026-10-31T20:28:18.000Z"
  }
}
```

#### `POST /agent/run`
Runs an end-to-end autonomous payment flow with full telemetry.
- **Request Body:**
```json
{
  "task": "Query AI Market Intelligence API",
  "resourceUrl": "https://demo.payguard-merchant.local/paid-api",
  "options": {}
}
```
- **Response:**
```json
{
  "runId": "run_5682fbb3-2d7e-4450-bef3-77c7fc5d4308",
  "success": true,
  "settlement": {
    "success": true,
    "txId": "tx_29e37719-7080-496a-b732-cbfb40eb5e97",
    "amount": "100000",
    "network": "base-sepolia",
    "mockChain": true
  },
  "auditTrail": [
    { "step": "request_received", "at": "..." },
    { "step": "payment_requirements_built", "at": "..." },
    { "step": "shield_check_complete", "result": { ... }, "at": "..." },
    { "step": "signer_invoked", "signerCallCount": 1, "at": "..." },
    { "step": "signature_created", "at": "..." },
    { "step": "settlement_result", "at": "..." }
  ]
}
```

#### `GET /audit-log`
Paginated audit log of security decisions from SQLite.
- **Query Params:** `?attackType=OVERPAYMENT&limit=50&offset=0`

#### `GET /providers`
Returns list of registered trusted merchants from SQLite/config.

#### `POST /providers`
Admin endpoint to register or update a trusted provider.
- **Headers:** `Authorization: Bearer <ADMIN_KEY>` or `X-Admin-Key: <ADMIN_KEY>`
- **Request:**
```json
{
  "domain": "api.example.com",
  "payTo": "0x1234...",
  "network": "base-sepolia",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "maxAmountUsd": 0.50
}
```

#### `DELETE /providers/:domain`
Admin endpoint to delete a trusted provider.

#### `GET /policy`
Returns policy in force (`dailyBudgetUsd`, `perRequestMaxUsd`, `tokenDecimals`).

#### `GET /metrics`
Real-time dashboard metrics calculated live from SQLite:
```json
{
  "totalDecisions": 25,
  "approved": 15,
  "blocked": 10,
  "byAttackType": {
    "OVERPAYMENT": 4,
    "WRONG_RECIPIENT": 3,
    "DOMAIN_SPOOF": 2,
    "EXPIRED_PAYMENT": 1
  },
  "avgLatencyMs": 1.45,
  "p95LatencyMs": 3.0,
  "signerInvokedOnBlock": 0
}
```

#### `POST /budget/reset`
Admin endpoint for test reset. Clears today's `spend_entries` and `budget_reservations` while preserving `security_decisions` and `seen_nonces`.

---

### Mock Chain (Port 4040)

#### `GET /health`
```json
{ "status": "ok", "service": "mock-chain", "port": 4040, "mockChain": true }
```

#### `GET /ledger`
Returns current balances:
```json
{
  "balances": [
    { "address": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "balance": "1000000" },
    { "address": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", "balance": "500000" },
    { "address": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "balance": "2000000" }
  ],
  "mockChain": true
}
```

#### `POST /transactions/execute`
Executes an atomic transfer on the mock ledger:
```json
{
  "from": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "to": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "amount": "100000",
  "network": "base-sepolia",
  "runId": "run_123"
}
```

#### `POST /balances/reset`
Admin endpoint resetting balances to demo defaults.

---

## 4. Attack Types & Reason Codes

| Reason Code | Check Layer | Detection Criteria |
|---|---|---|
| `INVALID_SCHEMA` | Layer 1 | Malformed payload, missing fields, or invalid URL structure |
| `EXPIRED_PAYMENT` | Layer 1 | Payment is expired (`maxTimeoutSeconds <= 0` or past deadline) |
| `DOMAIN_SPOOF` | Layer 2 | Resource domain not found in identity registry |
| `WRONG_RECIPIENT` | Layer 2 | `payTo` address differs from registry address for this domain |
| `FAKE_TOKEN` | Layer 2 | `asset` token address differs from registry asset |
| `WRONG_NETWORK` | Layer 2 | `network` differs from registry network |
| `OVERPAYMENT` | Layer 3 | Amount exceeds policy cap, is negative, or non-integer |
| `REPLAY_ATTACK` | Layer 4 | Nonce previously recorded in `seen_nonces` table |
| `BUDGET_EXHAUST` | Layer 5 | Requested amount exceeds remaining daily budget + pending reservations |
| `TOCTOU_MODIFY` | Layer 6 / Signer | Intent fingerprint at signing boundary does not match approval token |

---

## 5. Expiry Semantics

- In x402 V1/V2 protocol, `maxTimeoutSeconds` specifies the validity window from receipt.
- Expiry calculation:
  $$\text{expiresAt} = \text{currentTime} + (\text{maxTimeoutSeconds} \times 1000)$$
- Payments received with `maxTimeoutSeconds <= 0` are evaluated as expired upon receipt and rejected immediately with `EXPIRED_PAYMENT`.
- Nonce records stored in `seen_nonces` remain active until `expires_at`.

---

## 6. Signer Boundary Protection & `signerCallCount` Tracking

To ensure private keys and wallet signers are never exposed to malicious or mutated payloads:

1. **Signer Call Count (`signerCallCount`):**
   - The Blue Agent maintains `signerCallCount` in memory and exposes `getSignerCallCount()` / `resetSignerCallCount()`.
   - In all blocked tests, `signerCallCount` is verified to be exactly `0`.
   - The signer is only invoked after all 6 checks succeed.

2. **Guarded Signer Proxy (`createGuardedSigner`):**
   - Implemented in `src/wrap.ts`.
   - Wraps any EVM or SVM signer with an interception proxy.
   - When `sign()`, `signTransaction()`, `signMessage()`, or `signTypedData()` is called, it recomputes `fingerprintRequirements(payload)`.
   - If the fingerprint does not match the approved `intentToken`, it throws `TOCTOU_MODIFY detected!` and aborts execution before the raw signer function is called.

---

## 7. Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4032` | Existing x402 wallet daemon port |
| `BLUE_PORT` | `4010` | Blue Agent firewall API port |
| `MOCK_CHAIN_PORT` | `4040` | Mock Chain settlement ledger port |
| `HOST` | `0.0.0.0` | Network interface binding (LAN accessible) |
| `ADMIN_KEY` | `dev-admin-key` | Bearer authorization key for administrative endpoints |
| `CORS_ORIGINS` | `https://*.lovable.app,http://localhost:5173,http://localhost:3000` | Allowed origins for web frontend |
| `DAILY_BUDGET_USD` | `1.0` | Maximum daily budget in USD |
| `PER_REQUEST_MAX_USD` | `0.1` | Per-request maximum spend cap in USD |
| `COLLECTOR_URL` | `http://localhost:4020` (optional) | Collector event pipeline endpoint |

---

## 8. Startup Commands

```bash
# Install dependencies
npm install

# Run all firewall unit and integration tests (30 tests)
npm test

# Start the unified dev environment (Existing daemon on 4032 + Blue Agent on 4010)
npm run dev

# Start Mock Chain settlement ledger on 4040
npm run chain

# Or run Blue Agent independently
npm run blue
```

---

## 9. Test Suite Verification

Vitest execution results (`npm test`):
```
 ✓ tests/firewall.test.ts (30 tests) 1159ms
   ✓ produces sha256-prefixed fingerprint
   ✓ changed payTo produces different fingerprint
   ✓ changed amount produces different fingerprint
   ✓ changed network produces different fingerprint
   ✓ changed asset produces different fingerprint
   ✓ changed resource produces different fingerprint
   ✓ equivalent objects with different key ordering produce SAME fingerprint
   ✓ nested objects with different key ordering produce SAME fingerprint
   ✓ missing optional field is handled consistently
   ✓ verifyFingerprint returns true for matching payload
   ✓ verifyFingerprint returns false for mutated payload
   ✓ valid payment passes all checks and returns intentToken
   ✓ overpayment is blocked, signer NOT called
   ✓ wrong payTo is blocked, signer NOT called
   ✓ fake token is blocked
   ✓ wrong network is blocked
   ✓ expired payment is blocked using correct expiry semantics
   ✓ replay attack is blocked
   ✓ domain spoof is blocked
   ✓ TOCTOU mutation is blocked at signing boundary
   ✓ budget exhaustion is blocked
   ✓ concurrent requests cannot collectively overspend budget
   ✓ collector offline does not affect firewall decision
   ✓ invalid schema (missing fields) is blocked
   ✓ invalid schema (bad resource URL) is blocked
   ✓ negative amount is blocked
   ✓ non-numeric amount string is blocked
   ✓ decision is persisted to security_decisions table
   ✓ no unauthorized transfer on any blocked attack
   ✓ guarded signer boundary rejects mutated payload without calling raw signer

Test Files: 1 passed (1)
Tests:      30 passed (30)
```

---

## 10. Security Invariants Confirmed

1. **Fail Closed:** Any unhandled exception or parsing failure immediately resolves to `allowed: false`.
2. **Zero-Knowledge Credentials:** Private keys, signing secrets, and admin tokens never appear in logs, API responses, or event payloads.
3. **Integer Precision:** Currency calculations use integer and `BigInt` atomic values (e.g., $10^6$ for 6-decimal USDC) avoiding floating-point rounding exploits.
4. **Independent Ledger Truth:** `FUNDS_TRANSFERRED` events and mock ledger balances are only updated by verified settlement on port 4040. Blocked attacks never result in settled transfers.
