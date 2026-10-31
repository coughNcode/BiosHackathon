# Blue Team — Phase 0 Repository Audit

**Date:** 2026-10-31
**Branch:** `feature/blue-security`
**Auditor:** Blue Team Agent (Laptop 1)

---

## 1. Current Architecture

### Language & Framework

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | 5.7.2 (strict mode) |
| Runtime | Node.js | >=18, local v20.20.2 |
| Module system | ESM | `"type": "module"` |
| HTTP Framework | Express | 4.21.2 |
| Build | tsc | outDir `dist/`, rootDir `src/` |

### Source Files

| File | Lines | Purpose |
|---|---|---|
| `src/server.ts` | 151 | Express daemon on port **4032** |
| `src/policy.ts` | 320 | PolicyEngine: budgets, merchant caps, rail caps, approval thresholds |
| `src/payments.ts` | 388 | Dual-rail x402 paywall middleware (Base + Solana) |
| `src/wrap.ts` | 142 | Client-side `wrapPayerFetch` with policy enforcement before signing |
| `src/sign.ts` | 46 | HMAC-SHA256 signing/verification over canonical JSON |
| `src/schemas.ts` | 179 | JSON schemas for paid route input/output (generated from openapi.json) |
| `src/index.ts` | 74 | Public package exports |

### Configuration

| File | Purpose |
|---|---|
| `config/policy.json` | WalletPolicy: $1/day budget, $0.10 per-request max, $0.05 approval threshold |
| `.env.example` | Reference env vars with safe defaults |
| `.env` | Local env vars (gitignored) |

---

## 2. Existing Server Port

**Port 4032** — configured at `src/server.ts:25`:
```typescript
const port = Number(process.env.PORT || 4032);
```

**Decision: PRESERVE port 4032 unchanged.** New Blue Agent runs on port 4010 as a separate Express app.

---

## 3. x402 SDK Version

From `package.json`:
- `"x402": "^1.2.0"` (installed: 1.2.0)
- `"x402-fetch": "^1.2.0"` (installed: 1.2.0)
- `"@three-ws/x402-payment-modal": "^1.2.0"`

### Protocol Version: **V1**

Evidence:
- `src/payments.ts:278` reads `X-PAYMENT` header (V1)
- `src/payments.ts:336` sets `X-PAYMENT-RESPONSE` header (V1)
- `src/payments.ts:243` returns `x402Version: 1` in 402 challenge
- `src/wrap.ts:106` checks `x-payment-response` header (V1)

**V2 headers** (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) are NOT used.

**Migration strategy:** The new Blue Agent (port 4010) will work with the existing V1 headers. No silent mixing. If V2 migration is needed, it will be documented and coordinated across all teams.

---

## 4. Existing Signer Integration Path

The signing boundary is in `src/wrap.ts`:

```
fetch → 402 → choose rail → POLICY CHECK → sign & retry → 200
                                  │
                                  └── PolicyViolationError (nothing signed)
```

1. `wrapPayerFetch()` wraps `x402-fetch`'s `wrapFetchWithPayment()`
2. The `select` callback filters rails by policy, evaluates spend via `engine.check()`
3. If denied → throws `PolicyViolationError` before signing
4. If allowed → returns the chosen `PaymentRequirements` to x402-fetch which calls the signer
5. On success → `engine.recordSpend()` tracks the settlement

**Key insight:** The signer is called by `x402-fetch` internally. Our firewall must intercept BEFORE the `select` callback returns the requirement, and AGAIN at the signing boundary.

---

## 5. Existing Budget/Policy Logic

`PolicyEngine` in `src/policy.ts` implements:
- Daily budget cap (UTC day window)
- Per-request maximum
- Per-merchant daily caps
- Per-rail daily caps
- Approval threshold (requires `approvalRef`)
- Merchant allow/block lists
- Network allow list
- Rail allow list with preference

Storage: file-backed JSON at `data/spend-ledger.json` (atomic write via temp+rename).

Budget tracking: only `kind: "spend"` entries consume budget. Intents (approved/denied) are logged but don't consume.

**Gap:** No concurrency protection. Two simultaneous requests could both pass the budget check and collectively overspend.

---

## 6. Existing Tests

**None.** No test framework configured. No test files exist. No `test` script in `package.json`.

---

## 7. Existing Endpoints (Port 4032)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /policy-check | $0.001 (x402) | Evaluate spend intent, return signed verdict |
| POST | /record-spend | X-Admin-Key | Record settled payment |
| GET | /ledger | X-Admin-Key | Spend history + policy digest |
| GET | /policy | Free | Current policy rules |
| POST | /verify | Free | Verify HMAC signature on verdict |
| GET | /health | Free | Service health + active rails |
| GET | /.well-known/x402 | Free | Discovery manifest |
| POST | /api/x402-checkout | Free | Solana checkout router |
| GET | /* | Free | Static assets from `public/` |

---

## 8. Confirmed Gaps

| # | Gap | Severity | Resolution |
|---|---|---|---|
| 1 | No recipient identity verification | CRITICAL | Trusted provider registry + domain binding |
| 2 | No amount validation against atomic BigInt | CRITICAL | Integer-only amount guard |
| 3 | No replay protection (nonce tracking) | HIGH | SQLite nonce table with transactions |
| 4 | No TOCTOU protection | HIGH | Intent fingerprint with signing-boundary verification |
| 5 | No concurrent budget protection | HIGH | SQLite atomic budget reservation |
| 6 | No schema/expiry validation | MEDIUM | Zod validation + expiry check |
| 7 | No structured event emission | MEDIUM | Event emitter to collector |
| 8 | No test suite | HIGH | Vitest with signer instrumentation |
| 9 | No independent settlement verification | HIGH | Mock chain on port 4040 |
| 10 | Budget uses floating-point arithmetic | MEDIUM | Migrate to BigInt for security comparisons |
| 11 | x402 SDK ships without type declarations | LOW | Use skipLibCheck + runtime verification |

---

## 9. Minimal-Change Integration Plan

1. **Do NOT modify** existing `src/server.ts`, `src/payments.ts`, `src/schemas.ts`, `src/sign.ts`
2. **Minimally extend** `src/policy.ts` — migrate storage to SQLite but preserve the `PolicyEngine` interface
3. **Minimally extend** `src/wrap.ts` — inject firewall validation into the `select` callback
4. **Add new files:**
   - `src/db/database.ts` — SQLite singleton
   - `src/identity.ts` — Trusted provider registry
   - `src/fingerprint.ts` — Intent fingerprint
   - `src/firewall.ts` — Six-layer security pipeline
   - `src/event-emitter.ts` — Structured event emission
   - `src/blue-agent.ts` — New Express server on port 4010
   - `src/mock-chain.ts` — Independent ledger on port 4040
   - `config/trusted-providers.json` — Demo fixtures
   - `tests/firewall.test.ts` — Security test suite
5. **Update:** `package.json` scripts, `.env`, `tsconfig.json` as needed
