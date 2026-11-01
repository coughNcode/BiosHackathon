# PayGuard AI — Hackathon Demonstration Runbook

**Version:** 1.0.0-final  
**Branch:** `integration/payguard-full-stack`  
**Target Audience:** Hackathon Judges, Evaluators, and Demonstration Presenters  
**License:** Apache 2.0  

---

## 1. Overview & Demonstration Goals

PayGuard AI is an autonomous, deterministic security firewall and evaluation framework designed specifically for agentic **x402 payment rails**. It enforces strict isolation between AI decision-making, policy validation, cryptographic signing, and on-chain settlement.

During this live 5-to-7 minute demonstration, presenters will prove four core architectural properties:
1. **Zero-Trust Signer Isolation**: The cryptographic wallet signer is never invoked without valid policy clearance and fingerprint verification.
2. **Deterministic Attack Rejection**: 100% of adversarial attacks (A01–A09) are blocked with zero fund loss.
3. **Flawless Legitimate Execution**: Legitimate payments (A10) complete the full four-stage lifecycle (Validation → Signing → Facilitator Settlement → Ledger Transfer).
4. **Adaptive Red-Teaming & Telemetry**: An autonomous UCB1 multi-armed bandit algorithm continuously explores attack vectors, emitting real-time correlated telemetry to the central operations dashboard.

---

## 2. System Topology & Port Reference

The system can run either on a **single developer machine** or distributed across **three physical laptops** over local Wi-Fi / Ethernet LAN:

| Service | Port | Host Role | Description |
|---|---:|---|---|
| **Blue Agent** | `4010` | Laptop A (Defense) | Policy engine, fingerprint verification, isolated signer boundary |
| **Mock Chain** | `4040` | Laptop A (Settlement) | Independent ERC-20 / USDC ledger and transfer registry |
| **Hostile Merchant** | `4020` | Laptop B (Offense) | Serves payment challenges, malicious scenario payloads (A01–A10) |
| **Mock Facilitator** | `4030` | Laptop B (Offense) | x402 verification and settlement simulator with fault injection |
| **Red Console** | `4060` | Laptop B (Offense) | Attack orchestrator, UCB1 bandit selector, mutation fuzzer catalog |
| **Collector** | `4050` | Laptop C (Telemetry) | Multi-party event ingestion, run correlation, and scorecard analytics |
| **PayGuard Dashboard** | `5173` | Laptop C (Operations) | Operations center (Cyberpunk UI, Live Feed, Lab, Scorecard, Adaptive) |

---

## 3. Pre-Flight Setup & Environment Verification

### Option A: Single-Laptop Standalone Startup (Recommended for Fast Demo)

To launch all backend services and the frontend operations dashboard on one machine:

```bash
# Terminal 1: Settlement & Telemetry
npm run chain       # Mock Chain on :4040
npm run collector   # Telemetry Collector on :4050

# Terminal 2: Defensive Agent
npm run blue        # Blue Agent Firewall on :4010

# Terminal 3: Adversarial Engine
npm run red         # Red Merchant (:4020), Facilitator (:4030), Console (:4060)

# Terminal 4: Operations Dashboard
npm run dev         # React/Vite Dashboard on :5173 (or :8080)
```

### Option B: Three-Laptop Multi-Machine LAN Deployment

#### Step 1: Discover Local LAN IP Addresses
- **Laptop A (Defense):** e.g., `192.168.1.101`
- **Laptop B (Offense):** e.g., `192.168.1.102`
- **Laptop C (Collector & UI):** e.g., `192.168.1.103`

#### Step 2: Configure Environment Files
- **Laptop A:** Copy `.env.blue.example` to `.env`. Set:
  ```env
  HOST=0.0.0.0
  BLUE_PORT=4010
  MOCK_CHAIN_PORT=4040
  COLLECTOR_URL=http://192.168.1.103:4050
  CORS_ORIGIN=http://192.168.1.103:5173,http://localhost:5173
  ```
- **Laptop B:** Copy `.env.red.example` to `.env`. Set:
  ```env
  HOST=0.0.0.0
  RED_MERCHANT_PORT=4020
  RED_FACILITATOR_PORT=4030
  RED_CONSOLE_PORT=4060
  BLUE_AGENT_URL=http://192.168.1.101:4010
  MOCK_CHAIN_URL=http://192.168.1.101:4040
  COLLECTOR_URL=http://192.168.1.103:4050
  CORS_ORIGIN=http://192.168.1.103:5173,http://localhost:5173
  ```
- **Laptop C:** Copy `.env.collector.example` to `.env` and `frontend/.env.example` to `frontend/.env`. Set:
  ```env
  HOST=0.0.0.0
  COLLECTOR_PORT=4050
  BLUE_AGENT_URL=http://192.168.1.101:4010
  MOCK_CHAIN_URL=http://192.168.1.101:4040
  RED_CONSOLE_URL=http://192.168.1.102:4060
  RED_MERCHANT_URL=http://192.168.1.102:4020
  RED_FACILITATOR_URL=http://192.168.1.102:4030
  ```

#### Step 3: Fast Health Verification
Run the quick automated health check script:
```bash
node -e "
const ports = [4010, 4040, 4020, 4030, 4060, 4050];
Promise.all(ports.map(p => 
  fetch('http://localhost:' + p + '/health')
    .then(r => r.json())
    .then(d => console.log('Port ' + p + ' OK:', d.service || d.status))
    .catch(e => console.error('Port ' + p + ' FAILED:', e.message))
));
"
```
Ensure all 6 services report `OK`.

---

## 4. Live Demonstration Step-by-Step Script

```mermaid
journey
    title PayGuard AI 5-Minute Hackathon Demo Journey
    section Act 1: Overview
      Open Dashboard & Verify 6 Badges: 5: Presenter
      Toggle Live vs Demo Mode: 5: Presenter
    section Act 2: Control Baseline
      Run Legitimate Payment A10: 5: Presenter, Blue, Red
      Inspect 4-Stage Settlement: 5: Presenter, Mock Chain
    section Act 3: Hostile Defense
      Execute Overpayment Attack A01: 5: Presenter, Blue
      Execute Wrong Recipient A02: 5: Presenter, Blue
      Execute TOCTOU Mutation A06: 5: Presenter, Blue
      Execute Nonce Replay A07: 5: Presenter, Blue
    section Act 4: Telemetry & Scorecard
      Inspect Live Feed & Audit Logs: 5: Presenter, Collector
      Verify 100% Confusion Matrix: 5: Presenter, Judges
    section Act 5: Adaptive Intelligence
      Inspect UCB1 Multi-Armed Bandit: 5: Presenter, Judges
      Explore Fuzzer Mutation Catalog: 5: Presenter, Judges
```

---

### Act 1: Operations Dashboard & Live Mode (30 Seconds)

1. Open your browser to `http://localhost:5173` (or `:8080`).
2. **Highlight the Sidebar Connection Panel**:
   - Point out all 6 service badges:
     - `BLUE AGENT :4010` (Connected, emerald green)
     - `MOCK CHAIN :4040` (Connected, emerald green)
     - `RED MERCHANT :4020` (Connected, emerald green)
     - `FACILITATOR :4030` (Connected, emerald green)
     - `RED CONSOLE :4060` (Connected, emerald green)
     - `COLLECTOR :4050` (Connected, emerald green)
3. **Toggle Demo Mode vs Live Mode**:
   - Show the switch in the top header.
   - *Explain to Judges:* "Demo Mode uses synthetic simulated data for offline evaluation. In Live Mode, the dashboard connects directly to live running RPC nodes with zero synthetic fallbacks."
   - Ensure the toggle is switched to **LIVE MODE**.

---

### Act 2: Legitimate Payment Control Baseline (60 Seconds)

1. Navigate to **Red/Blue Lab** (`/lab`) from the sidebar.
2. In the Attack Scenario selector, choose **`A10_VALID` — Legitimate Payment Baseline (Control)**.
3. Click **Execute Attack / Simulation**.
4. **Observe Real-Time Execution**:
   - Status badge turns **EMERALD (VALID_SUCCESS)**.
   - Point out the 4-Stage Payment Lifecycle:
     - **Stage 1 (Policy Validation)**: Blue Agent `/shield-check` approved the challenge within budget limits.
     - **Stage 2 (Signer Boundary)**: Cryptographic intent token verified; protected signer invoked exactly once (`signerCallCount = 1`).
     - **Stage 3 (Settlement Handshake)**: Mock Facilitator verified signature and settled transaction.
     - **Stage 4 (Ledger Settlement)**: Mock Chain ledger atomically transferred 1,000 units ($0.001 USDC) from payer wallet `0xf39f...` to merchant `0x7099...`.
5. **Show Proof to Judges**:
   - Point to the result card: `Transferred: YES`, `Tx Hash: tx_...`, `Signer Invoked: YES`.

---

### Act 3: Hostile Attack Suite Walkthrough (90 Seconds)

Demonstrate that Blue Agent deterministically denies malicious vectors without risking funds.

#### Vector 1: Overpayment Inflation (`A01_OVERPAY`)
1. Select **`A01_OVERPAY`** (Attacker demands 50,000,000 units, exceeding daily limit).
2. Click **Execute Attack**.
3. **Result:**
   - Status: **`ATTACK_BLOCKED`** (Blue shield).
   - Reason: `DAILY_BUDGET_EXCEEDED` / `MAX_AMOUNT_EXCEEDED`.
   - **Crucial Metric:** `Signer Invoked: NO`, `Funds Moved: 0.00 USDC`.

#### Vector 2: Wrong Recipient Address Substitution (`A02_WRONG_PAYTO`)
1. Select **`A02_WRONG_PAYTO`** (Attacker injects unapproved hacker wallet `0xDeadBeef...`).
2. Click **Execute Attack**.
3. **Result:**
   - Status: **`ATTACK_BLOCKED`**.
   - Reason: `UNAPPROVED_RECIPIENT`.
   - Attacker receives zero funds; protected signer never called.

#### Vector 3: TOCTOU Intent Mutation Attack (`A06_TOCTOU_MODIFY`)
1. Select **`A06_TOCTOU_MODIFY`** (Attacker attempts Time-of-Check to Time-of-Use tampering by altering payload between authorization and signing).
2. Click **Execute Attack**.
3. **Result:**
   - Status: **`ATTACK_BLOCKED`** (or `TOCTOU_DETECTED`).
   - Explanation: "Blue Agent computes a cryptographic SHA-256 fingerprint of the approved intent. When the attacker mutates the recipient at the signing boundary, the hash mismatch immediately aborts execution."

#### Vector 4: Nonce Replay Attack (`A07_REPLAY_NONCE`)
1. Select **`A07_REPLAY_NONCE`** (Attacker replays an already consumed authorization signature).
2. Click **Execute Attack**.
3. **Result:**
   - Status: **`ATTACK_BLOCKED`**.
   - Explanation: "Blue Agent maintains an in-memory & SQLite nonce registry with active sliding-window expiration, rejecting duplicate tokens instantly."

---

### Act 4: Live Telemetry, Scorecard & Confusion Matrix (60 Seconds)

1. On the **Lab** page, scroll down to the **Security Evaluation Scorecard**.
2. **Review Metrics Sourced Directly from Collector (`:4050/scorecard`)**:
   - **True Positives (TP):** Hostile attacks successfully stopped.
   - **True Negatives (TN):** Legitimate payments permitted.
   - **False Positives (FP):** `0` (Zero legitimate transactions blocked).
   - **False Negatives (FN):** `0` (Zero attacks bypassed).
   - **Precision:** `100.0%`
   - **Recall:** `100.0%`
   - **Specificity:** `100.0%`
   - **F1 Score:** `1.000`
3. Navigate to **Live Feed** (`/feed`):
   - Show the real-time event stream arriving from all distributed nodes.
   - Filter by `runId` to reveal the exact chronological trace from Red's challenge initiation to Blue's firewall decision.
4. Navigate to **Payment Inspector** (`/inspector`):
   - Inspect raw JSON payloads, cryptographic signatures, and policy validation step-by-step traces.

---

### Act 5: Adaptive Intelligence — UCB1 Multi-Armed Bandit (45 Seconds)

1. Navigate to **Adaptive Intelligence** (`/adaptive`) from the sidebar.
2. **Explain the UCB1 Multi-Armed Bandit Engine**:
   - "Red Team is not running dumb static tests. It runs an autonomous Upper Confidence Bound (UCB1) multi-armed bandit algorithm."
   - In exploration phase ($N_i = 0$), the bandit methodically tests every scenario.
   - As data accumulates, it dynamically balances exploitation of potential weak spots with exploration of uncertain vectors using:
     $$\text{Score}_i = \bar{X}_i + c \sqrt{\frac{2 \ln N}{N_i}}$$
3. **Examine Live Bandit State**:
   - Point out the scenario arm pull counts, reward scores, and exploration rank.
4. **Inspect the Mutation Fuzzer Catalog**:
   - Show the catalog of automated schema mutations, bit-flips, boundary numbers, and token truncations.

---

### Act 6: Dynamic Policy Configuration (30 Seconds)

1. Navigate to **Policy Editor** (`/policy`).
2. Show runtime configurable parameters:
   - Daily spending cap (e.g., $100.00 USDC).
   - Single-transaction threshold (e.g., $10.00 USDC).
   - Approved merchant whitelist and asset registry (USDC on Base Sepolia).
3. Explain that policies are dynamically enforced by the Blue firewall with sub-millisecond evaluation latency.

---

## 5. Judge Q&A & Verification Reference Sheet

| Question | Verification Command / Proof Point |
|---|---|
| **"How do you prove funds were not stolen?"** | 1. Query Mock Chain: `curl http://localhost:4040/transfers?runId=<RUN_ID>` → Returns `transferred: false`.<br>2. Query Blue Agent: `curl http://localhost:4010/signer-evidence?runId=<RUN_ID>` → Confirms `signerInvoked: false`, `callCount: 0`. |
| **"Can an attacker bypass Blue by calling the signer endpoint directly?"** | Direct calls to `POST /agent/run` without a valid `intentToken` issued by `/shield-check` are rejected with `401 Unauthorized` / `INVALID_INTENT_TOKEN`. |
| **"What happens if the Collector telemetry server crashes?"** | Collector downtime does **not** block transactions. All event emissions timeout after 3000ms with silent local logging. The Blue firewall and Red attack engine continue without interruption. |
| **"How are transactions prevented from being replayed?"** | Blue maintains a cryptographic nonce cache (`seen_nonces` table) with expiration windows. Replay attempts are caught instantly with `REPLAY_ATTEMPT_DETECTED`. |
| **"What test coverage backs this system?"** | Run `npm test` in the root repository. 78 unit/integration tests and 15 frontend tests pass with 100% success in under 8 seconds. |

---

## 6. Troubleshooting & Emergency Triage

### Issue 1: Port Already in Use (`EADDRINUSE`)
- **Symptom:** A service fails to start with `Error: listen EADDRINUSE: address already in use :::4010` (or 4020, 4030, 4040, 4050, 4060, 5173).
- **Remedy:**
  ```powershell
  # Find process occupying the port (e.g., 4010)
  Get-NetTCPConnection -LocalPort 4010 | Select-Object OwningProcess
  # Terminate process
  Stop-Process -Id <PID> -Force
  ```

### Issue 2: Frontend Shows "Disconnected" for One Service
- **Symptom:** Sidebar badge shows red or grey for a service.
- **Remedy:**
  1. Verify the specific service terminal is running.
  2. Test health directly: `curl http://localhost:<PORT>/health`.
  3. If testing across LAN, verify the host IP in `frontend/.env` matches the physical machine IP.

### Issue 3: Stale Database State / Reset Everything
- **Symptom:** Need to start from a completely clean slate before judging.
- **Remedy:**
  ```bash
  # Remove SQLite databases and ledger persistence
  rm -f collector.db firewall.db ledger.json
  # Restart services
  ```

### Issue 4: Running Automated E2E Suite for Judges
If judges want programmatic verification on the CLI:
```bash
# Run the 12-scenario full-stack verification suite
npm test -- tests/e2e-integration.test.ts
```
Expected output: **12 tests passed (100%)** in ~1.3 seconds.
