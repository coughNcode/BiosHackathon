# PayGuard AI — Frontend API Contract
**Consumer: Lovable AI Frontend (Judge SOC Dashboard)**
**Service: PayGuard Event Collector & Evaluation Engine**
**Base URL:** `http://<DASHBOARD_HOST>:4050` (or `http://localhost:4050`)
**Port:** `4050`
**Content-Type:** `application/json`
**Protocol Version:** x402 V2 Compatible

---

## 1. Overview & Connection Architecture

The Collector is the **single source of truth** for all visual telemetry shown to hackathon judges in Lovable.

- **Zero Fake Data:** All metrics and scores are derived in real-time from persisted SQLite records.
- **Strict Demo Isolation:** Live attack data (`events` and `runs` tables) and synthetic demo data (`demo_events` table) are completely isolated. Live endpoints never return synthetic demo data unless the query parameter `?demo=true` is explicitly provided.
- **No Wildcard Credentialed CORS:** CORS is pre-configured to allow `https://*.lovable.app`, `http://localhost:5173`, and `http://localhost:3000`.

---

## 2. API Endpoints

### 2.1 System Health Check

#### `GET /health`
- **Description:** Verifies collector availability and returns active record counts.
- **Polling Recommendation:** Poll every 5 to 10 seconds for system status indicators.
- **Data Source:** Live SQLite row count.
- **Demo Mode:** Not applicable.
- **Response `200 OK`:**
```json
{
  "status": "ok",
  "service": "collector",
  "port": 4050,
  "eventCount": 42,
  "runCount": 10
}
```

---

### 2.2 Live & Historic Security Events

#### `GET /events`
- **Description:** Returns paginated telemetry events with multi-field filtering.
- **Query Parameters:**
  | Parameter | Type | Default | Description |
  |---|---|---|---|
  | `runId` | `string` | `undefined` | Filter by specific run correlation ID |
  | `attackId` | `string` | `undefined` | Filter by scenario ID (e.g., `A01`, `A02`) |
  | `source` | `string` | `undefined` | Filter by actor: `RED`, `BLUE`, `CHAIN`, `WALLET` |
  | `eventType` | `string` | `undefined` | e.g. `PAYMENT_BLOCKED`, `PAYMENT_APPROVED`, `SIGNER_INVOKED` |
  | `severity` | `string` | `undefined` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, `INFO` |
  | `since` | `string` | `undefined` | ISO 8601 timestamp; returns events with `timestamp >= since` |
  | `limit` | `number` | `50` | Maximum items to return (min: 1) |
  | `offset` | `number` | `0` | Number of items to skip |
  | `demo` | `boolean` | `false` | When `true`, queries `demo_events` instead of live `events` |
- **Polling Recommendation:** Poll every 2 seconds for live battle feeds using `?since=<LAST_SEEN_ISO>`.
- **Response `200 OK`:**
```json
{
  "events": [
    {
      "eventId": "evt_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "timestamp": "2026-10-31T20:15:02.120Z",
      "runId": "run_01j7b9...",
      "source": "BLUE",
      "eventType": "PAYMENT_BLOCKED",
      "severity": "CRITICAL",
      "attackId": "A02",
      "message": "BLOCKED: PAYTO_MISMATCH | expected 0x7099... | received 0xAttacker...",
      "data": {
        "violatedCheck": "payTo",
        "expected": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        "received": "0xattacker66666666666666666666666666666666",
        "layer": "L2"
      },
      "receivedAt": "2026-10-31T20:15:02.125Z"
    }
  ],
  "total": 128,
  "offset": 0,
  "limit": 50
}
```

#### `GET /events/:eventId`
- **Description:** Retrieve a single event by ID.
- **Query Parameters:** `?demo=true` (optional, to lookup in demo table).
- **Response `200 OK`:** Single `Event` object.
- **Response `404 Not Found`:** `{ "error": "Event not found", "code": "NOT_FOUND" }`

---

### 2.3 Attack & Defense Runs

#### `GET /runs`
- **Description:** Returns all attack execution runs with their final security classification.
- **Query Parameters:**
  | Parameter | Type | Default | Description |
  |---|---|---|---|
  | `classification` | `string` | `undefined` | `ATTACK_BLOCKED`, `ATTACK_BYPASS`, `FUNDS_LOST`, `VALID_SUCCESS`, `FALSE_POSITIVE`, `ATTACK_ERROR` |
  | `attackId` | `string` | `undefined` | Scenario ID (e.g. `A01`) |
  | `limit` | `number` | `50` | Pagination limit |
  | `offset` | `number` | `0` | Pagination offset |
- **Polling Recommendation:** Poll every 3 seconds on overview or battle summary views.
- **Data Source:** Live `runs` table only.
- **Response `200 OK`:**
```json
{
  "runs": [
    {
      "runId": "run_01j7b9...",
      "startedAt": "2026-10-31T20:15:00.000Z",
      "finishedAt": "2026-10-31T20:15:02.500Z",
      "attackId": "A02",
      "source": "RED",
      "classification": "ATTACK_BLOCKED",
      "blueDecision": "BLOCK",
      "signerInvoked": 0,
      "chainTransfer": 0,
      "latencyMs": 4.2
    }
  ],
  "total": 10
}
```

#### `GET /runs/:runId`
- **Description:** Returns a run summary and the full chronological timeline of all correlated events.
- **Response `200 OK`:**
```json
{
  "run": {
    "runId": "run_01j7b9...",
    "startedAt": "2026-10-31T20:15:00.000Z",
    "finishedAt": "2026-10-31T20:15:02.500Z",
    "attackId": "A02",
    "source": "RED",
    "classification": "ATTACK_BLOCKED",
    "blueDecision": "BLOCK",
    "signerInvoked": 0,
    "chainTransfer": 0,
    "latencyMs": 4.2
  },
  "events": [
    { "eventType": "ATTACK_STARTED", "source": "RED", ... },
    { "eventType": "PAYMENT_BLOCKED", "source": "BLUE", ... },
    { "eventType": "ATTACK_COMPLETED", "source": "RED", ... }
  ]
}
```

---

### 2.4 Live Real-Time Metrics

#### `GET /metrics`
- **Description:** Aggregates real-time performance, attack coverage, and defense rates across all runs.
- **Polling Recommendation:** Poll every 2 seconds.
- **Data Source:** Persisted facts in the `runs` table.
- **Null Safety:** Ratios and latencies are `null` if no matching runs exist (never `NaN` or unhandled errors).
- **Response `200 OK`:**
```json
{
  "totalAttacks": 9,
  "attacksBlocked": 9,
  "attacksBypass": 0,
  "fundsLost": 0,
  "validControls": 1,
  "validControlsAccepted": 1,
  "falsePositives": 0,
  "attackErrors": 0,
  "signerInvokedOnBlock": 0,
  "avgLatencyMs": 4.8,
  "p95LatencyMs": 7.5,
  "detectionRate": 1.0,
  "lastUpdated": "2026-10-31T20:15:02.120Z"
}
```

---

### 2.5 Security Scorecard & Evaluation

#### `GET /scorecard`
- **Description:** Full confusion matrix (TP, FP, FN, TN) and per-attack breakdown.
- **Query Parameters:** `?demo=true` (returns verified synthetic fixture dataset with `_synthetic: true`).
- **Response `200 OK`:**
```json
{
  "TP": 9,
  "FP": 0,
  "FN": 0,
  "TN": 1,
  "errors": 0,
  "precision": 1.0,
  "recall": 1.0,
  "specificity": 1.0,
  "f1": 1.0,
  "perAttack": [
    {
      "attackId": "A01",
      "attackName": "Overpayment 10x Attack",
      "expectedDecision": "BLOCK",
      "classification": "ATTACK_BLOCKED",
      "blueDecision": "BLOCK",
      "signerInvoked": false,
      "chainTransfer": false,
      "latencyMs": 4.8,
      "runId": "run_01...",
      "runAt": "2026-10-31T20:15:02.000Z"
    }
  ],
  "calculatedAt": "2026-10-31T20:15:10.000Z"
}
```

#### `GET /audit-log`
- **Description:** Paginated security decision stream ordered by `timestamp DESC`.
- **Query Parameters:** `limit` (default 50), `offset` (default 0).
- **Response `200 OK`:** `{ "events": Event[], "total": number }`

---

### 2.6 Control & Demo APIs

#### `POST /evaluation/run`
- **Description:** Triggers immediate recalculation of metrics.
- **Response `200 OK`:** `{ "status": "recalculated", "metrics": { ... } }`

#### `POST /evaluation/reset`
- **Description:** Scoped reset of collector state.
- **Request Body:**
  ```json
  {
    "scope": "demo | all",
    "confirm": true
  }
  ```
- **Authentication:**
  - `scope: "demo"`: No auth required. Clears `demo_events` table only.
  - `scope: "all"`: Requires header `Authorization: Bearer <ADMIN_KEY>` or `X-Admin-Key: <ADMIN_KEY>`. Clears `events`, `runs`, and `demo_events`.
- **Response `200 OK`:** `{ "cleared": "Cleared ...", "scope": "..." }`

#### `POST /demo/seed`
- **Description:** Seeds the separate `demo_events` table with synthetic fixture data covering all 10 attacks and 1 valid control.
- **Response `200 OK`:** `{ "seeded": true, "count": 32 }`

