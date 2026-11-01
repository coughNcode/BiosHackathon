import { POLICY, seedDecisions } from "./mock";
import type {
  Attack,
  BenchmarkRow,
  BlueDecisionRecord,
  BlueHealthResponse,
  BlueMetricsResponse,
  BluePolicyResponse,
  BlueProvider,
  ChainHealthResponse,
  ChainLedgerResponse,
  ChainTransactionsResponse,
  CollectorEvent,
  CollectorEventsResponse,
  CollectorHealthResponse,
  CollectorMetricsResponse,
  CollectorRunDetailsResponse,
  CollectorRunsResponse,
  CollectorScorecardResponse,
  FacilitatorHealthResponse,
  MerchantHealthResponse,
  Policy,
  RedAttacksResponse,
  RedFuzzerCatalogResponse,
  RedHealthResponse,
  RedHistoryResponse,
  RedResultResponse,
  RedRunResponse,
  RedUCB1Response,
  SecurityDecision,
} from "./types";

// Base URLs from environment variables with sensible local defaults
export const MOCK = import.meta.env["VITE_MOCK_API"] === "true";
export const BLUE_URL = import.meta.env["VITE_BLUE_URL"] ?? "http://localhost:4010";
export const RED_URL = import.meta.env["VITE_RED_URL"] ?? "http://localhost:4060";
export const COLLECTOR_URL = import.meta.env["VITE_COLLECTOR_URL"] ?? "http://localhost:4050";
export const MOCK_CHAIN_URL = import.meta.env["VITE_MOCK_CHAIN_URL"] ?? "http://localhost:4040";
export const MERCHANT_URL = import.meta.env["VITE_MERCHANT_URL"] ?? "http://localhost:4020";
export const FACILITATOR_URL = import.meta.env["VITE_FACILITATOR_URL"] ?? "http://localhost:4030";

const DEFAULT_TIMEOUT_MS = 6000;

export const delay = <T>(v: T, ms = 200 + Math.random() * 200) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms));

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public url: string,
    public data?: unknown,
  ) {
    super(`API Error ${status} ${statusText} from ${url}`);
    this.name = "ApiError";
  }
}

async function req<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      ...init,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        // Ignored
      }
      throw new ApiError(res.status, res.statusText, url, errBody);
    }
    return (await res.json()) as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Error(`Network failure connecting to ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

// ── BLUE AGENT API (:4010) ────────────────────────────────────────────────────

export const getHealth = (isDemo = false) =>
  MOCK || isDemo ? delay({ status: "ok", service: "blue-agent", port: 4010, timestamp: new Date().toISOString() }) : req<BlueHealthResponse>(`${BLUE_URL}/health`);

export const getBluePolicy = async (isDemo = false): Promise<BluePolicyResponse> => {
  if (MOCK || isDemo) {
    return delay({
      perRequestMaxUsd: POLICY.limits.per_request_max,
      dailyBudgetUsd: POLICY.limits.daily_budget,
      tokenDecimals: 6,
    });
  }
  return req<BluePolicyResponse>(`${BLUE_URL}/policy`);
};

export const getBlueProviders = async (isDemo = false): Promise<BlueProvider[]> => {
  if (MOCK || isDemo) {
    return delay(
      POLICY.providers.map((p) => ({
        domain: p.domain,
        payTo: p.wallet,
        network: p.network,
        asset: p.token,
        maxAmountUsd: p.max,
      })),
    );
  }
  return req<BlueProvider[]>(`${BLUE_URL}/providers`);
};

export const getPolicy = async (isDemo = false): Promise<Policy> => {
  if (MOCK || isDemo) return delay<Policy>(POLICY);
  try {
    const [policy, providers] = await Promise.all([
      getBluePolicy(false),
      getBlueProviders(false),
    ]);
    return {
      limits: {
        daily_budget: policy.dailyBudgetUsd ?? 50,
        per_request_max: policy.perRequestMaxUsd ?? 10,
        per_merchant_daily: policy.perRequestMaxUsd * 2 ?? 20,
        approval_threshold: policy.perRequestMaxUsd * 0.8 ?? 8,
      },
      providers: (providers ?? []).map((p) => ({
        domain: p.domain,
        wallet: p.payTo,
        network: p.network,
        token: p.asset,
        max: p.maxAmountUsd,
      })),
    };
  } catch {
    // If backend policy fails, return standard policy structure with zeros rather than fake data
    return {
      limits: { daily_budget: 0, per_request_max: 0, per_merchant_daily: 0, approval_threshold: 0 },
      providers: [],
    };
  }
};

export const getBlueMetrics = (isDemo = false) =>
  MOCK || isDemo
    ? delay<BlueMetricsResponse>({
        totalDecisions: 18,
        approved: 12,
        blocked: 6,
        byAttackType: { OVERPAYMENT: 2, WRONG_RECIPIENT: 2, WRONG_NETWORK: 2 },
        avgLatencyMs: 42,
        p95LatencyMs: 85,
        signerInvokedOnBlock: 0,
      })
    : req<BlueMetricsResponse>(`${BLUE_URL}/metrics`);

export const getBlueAuditLog = (params?: { attackType?: string; limit?: number; offset?: number }, isDemo = false) => {
  if (MOCK || isDemo) return delay<BlueDecisionRecord[]>([]);
  const sp = new URLSearchParams();
  if (params?.attackType) sp.set("attackType", params.attackType);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const query = sp.toString() ? `?${sp.toString()}` : "";
  return req<BlueDecisionRecord[]>(`${BLUE_URL}/audit-log${query}`);
};

export const postShieldCheck = (body: unknown, isDemo = false) =>
  MOCK || isDemo ? delay({ allowed: false, decision: { allowed: false, attackType: "DEMO_BLOCKED" } }) : req(`${BLUE_URL}/shield-check`, post(body));

// ── RED TEAM API (:4060) ──────────────────────────────────────────────────────

export const getRedHealth = (isDemo = false) =>
  MOCK || isDemo
    ? delay<RedHealthResponse>({
        status: "ok",
        service: "red-console",
        port: 4060,
        blueTarget: "http://localhost:4010",
        totalRuns: 10,
        runningAttacks: 0,
      })
    : req<RedHealthResponse>(`${RED_URL}/health`);

export const getMerchantHealth = (isDemo = false) =>
  MOCK || isDemo
    ? delay<MerchantHealthResponse>({
        status: "ok",
        service: "red-merchant",
        port: 4020,
      })
    : req<MerchantHealthResponse>(`${MERCHANT_URL}/health`);

export const getFacilitatorHealth = (isDemo = false) =>
  MOCK || isDemo
    ? delay<FacilitatorHealthResponse>({
        status: "ok",
        service: "red-facilitator",
        port: 4030,
        mode: "normal",
      })
    : req<FacilitatorHealthResponse>(`${FACILITATOR_URL}/health`);

export const getRedAttacks = (isDemo = false) =>
  MOCK || isDemo
    ? delay<RedAttacksResponse>({
        attacks: [
          { id: "A01_OVERPAY", name: "Overpayment Attack", category: "Economic", threatLevel: "CRITICAL", expectedDecision: "BLOCK", description: "Attempts 10x max payment", expectedCheck: "amount_guard" },
          { id: "A02_WRONG_RECIPIENT", name: "Recipient Tamper", category: "Integrity", threatLevel: "CRITICAL", expectedDecision: "BLOCK", description: "Substitutes attacker address", expectedCheck: "recipient_guard" },
          { id: "A03_WRONG_TOKEN", name: "Asset Substitution", category: "Currency", threatLevel: "HIGH", expectedDecision: "BLOCK", description: "Demands unknown token", expectedCheck: "token_guard" },
          { id: "A04_WRONG_NETWORK", name: "Chain Mismatch", category: "Protocol", threatLevel: "HIGH", expectedDecision: "BLOCK", description: "Targets wrong chain ID", expectedCheck: "network_guard" },
          { id: "A10_VALID", name: "Legitimate Baseline", category: "Control", threatLevel: "BENIGN", expectedDecision: "ALLOW", description: "Legitimate payment below caps", expectedCheck: "none" },
        ],
        totalScenarios: 5,
        blueTarget: "http://localhost:4010",
      })
    : req<RedAttacksResponse>(`${RED_URL}/attacks`);

export const postRedRun = (options: { attackId?: string; runAll?: boolean; useUCB1?: boolean }, isDemo = false) =>
  MOCK || isDemo
    ? delay<RedRunResponse>({
        runId: `demo_run_${Date.now()}`,
        attackId: options.attackId ?? "A01_OVERPAY",
        status: "running",
      })
    : req<RedRunResponse>(`${RED_URL}/redblue/run`, post(options));

export const getRedResult = (runId: string, isDemo = false) =>
  MOCK || isDemo
    ? delay<RedResultResponse>({
        runId,
        attackId: "A01_OVERPAY",
        classification: "ATTACK_BLOCKED",
        blueResponse: {
          allowed: false,
          intentToken: null,
          decision: {
            decisionId: `dec_${Date.now()}`,
            allowed: false,
            attackType: "OVERPAYMENT",
            violatedCheck: "amount_guard",
            suspiciousField: "maxAmountRequired",
            evidence: { expected: "100000", received: "10000000" },
            intentToken: null,
            latencyMs: 12,
            decidedAt: new Date().toISOString(),
          },
        },
        signerEvidence: { invoked: false, source: "blue-firewall", details: "Blocked at policy check" },
        chainResult: { fundsTransferred: false, txHash: null, source: "mock-chain", details: "No transfer occurred" },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 45,
        status: "completed",
      })
    : req<RedResultResponse>(`${RED_URL}/redblue/result/${runId}`);

export const getRedHistory = (isDemo = false) =>
  MOCK || isDemo
    ? delay<RedHistoryResponse>({
        stats: { total: 0, blocked: 0, bypassed: 0, fundsLost: 0, falsePositives: 0, validSuccess: 0, errors: 0 },
        perAttack: {},
        runs: [],
        running: [],
      })
    : req<RedHistoryResponse>(`${RED_URL}/redblue/history`);

export const getUCB1State = (isDemo = false) =>
  MOCK || isDemo
    ? delay<RedUCB1Response>({
        ucb1: {
          totalPulls: 25,
          arms: [
            { attackId: "A01_OVERPAY", pulls: 5, reward: 0, score: 0.45 },
            { attackId: "A02_WRONG_RECIPIENT", pulls: 4, reward: 0, score: 0.52 },
            { attackId: "A09_TOCTOU_MUTATION", pulls: 7, reward: 1, score: 0.88 },
            { attackId: "A06_REPLAY_NONCE", pulls: 4, reward: 0, score: 0.39 },
            { attackId: "A07_BURST_RACE", pulls: 5, reward: 0, score: 0.48 },
          ],
        },
        nextRecommended: "A09_TOCTOU_MUTATION",
      })
    : req<RedUCB1Response>(`${RED_URL}/ucb1/state`);

export const getFuzzerCatalog = (isDemo = false) =>
  MOCK || isDemo
    ? delay<RedFuzzerCatalogResponse>({
        totalMutations: 4,
        mutations: [
          { mutationId: "M01", category: "PAYEE", description: "Address bit-flip permutation", mutatedFields: ["payTo"] },
          { mutationId: "M02", category: "AMOUNT", description: "Scientific notation overflow", mutatedFields: ["maxAmountRequired"] },
          { mutationId: "M03", category: "TIMESTAMP", description: "Epoch boundary drift", mutatedFields: ["validUntil"] },
          { mutationId: "M04", category: "NETWORK", description: "Cross-chain RPC confusion", mutatedFields: ["network"] },
        ],
      })
    : req<RedFuzzerCatalogResponse>(`${RED_URL}/fuzzer/catalog`);

// ── COLLECTOR API (:4050) ─────────────────────────────────────────────────────

export const getCollectorHealth = (isDemo = false) =>
  MOCK || isDemo
    ? delay<CollectorHealthResponse>({ status: "ok", service: "collector", port: 4050, eventCount: 15, runCount: 3 })
    : req<CollectorHealthResponse>(`${COLLECTOR_URL}/health`);

export const getCollectorEvents = (
  params?: {
    runId?: string;
    attackId?: string;
    source?: string;
    eventType?: string;
    severity?: string;
    limit?: number;
    offset?: number;
  },
  isDemo = false,
) => {
  if (MOCK || isDemo) {
    return delay<CollectorEventsResponse>({ events: [], total: 0, offset: 0, limit: 50 });
  }
  const sp = new URLSearchParams();
  if (params?.runId) sp.set("runId", params.runId);
  if (params?.attackId) sp.set("attackId", params.attackId);
  if (params?.source) sp.set("source", params.source);
  if (params?.eventType) sp.set("eventType", params.eventType);
  if (params?.severity) sp.set("severity", params.severity);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const query = sp.toString() ? `?${sp.toString()}` : "";
  return req<CollectorEventsResponse>(`${COLLECTOR_URL}/events${query}`);
};

export const getCollectorEventById = (eventId: string, isDemo = false) =>
  MOCK || isDemo
    ? delay<CollectorEvent>({
        eventId,
        timestamp: new Date().toISOString(),
        runId: null,
        source: "DEMO",
        eventType: "POLICY_BLOCKED",
        severity: "HIGH",
        attackId: "A01",
        message: "Demo event payload",
        data: {},
        receivedAt: new Date().toISOString(),
      })
    : req<CollectorEvent>(`${COLLECTOR_URL}/events/${eventId}`);

export const getCollectorRuns = (
  params?: { classification?: string; attackId?: string; limit?: number; offset?: number },
  isDemo = false,
) => {
  if (MOCK || isDemo) {
    return delay<CollectorRunsResponse>({ runs: [], total: 0 });
  }
  const sp = new URLSearchParams();
  if (params?.classification) sp.set("classification", params.classification);
  if (params?.attackId) sp.set("attackId", params.attackId);
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const query = sp.toString() ? `?${sp.toString()}` : "";
  return req<CollectorRunsResponse>(`${COLLECTOR_URL}/runs${query}`);
};

export const getCollectorRunById = (runId: string, isDemo = false) =>
  MOCK || isDemo
    ? delay<CollectorRunDetailsResponse>({
        run: {
          runId,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          attackId: "A01_OVERPAY",
          source: "RED",
          classification: "ATTACK_BLOCKED",
          blueDecision: "BLOCKED",
          signerInvoked: 0,
          chainTransfer: 0,
          latencyMs: 38,
        },
        events: [],
      })
    : req<CollectorRunDetailsResponse>(`${COLLECTOR_URL}/runs/${runId}`);

export const getCollectorMetrics = (isDemo = false) =>
  MOCK || isDemo
    ? delay<CollectorMetricsResponse>({
        totalAttacks: 10,
        attacksBlocked: 10,
        attacksBypass: 0,
        fundsLost: 0,
        validControls: 1,
        validControlsAccepted: 1,
        falsePositives: 0,
        attackErrors: 0,
        signerInvokedOnBlock: 0,
        avgLatencyMs: 34.5,
        p95LatencyMs: 62.0,
        detectionRate: 1.0,
        lastUpdated: new Date().toISOString(),
      })
    : req<CollectorMetricsResponse>(`${COLLECTOR_URL}/metrics`);

export const getCollectorAuditLog = (params?: { limit?: number; offset?: number }, isDemo = false) => {
  if (MOCK || isDemo) {
    return delay<{ events: CollectorEvent[]; total: number }>({ events: [], total: 0 });
  }
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const query = sp.toString() ? `?${sp.toString()}` : "";
  return req<{ events: CollectorEvent[]; total: number }>(`${COLLECTOR_URL}/audit-log${query}`);
};

export const getCollectorScorecard = (isDemo = false) =>
  MOCK || isDemo
    ? req<CollectorScorecardResponse>(`${COLLECTOR_URL}/scorecard?demo=true`).catch(() =>
        delay<CollectorScorecardResponse>({
          TP: 9,
          FP: 0,
          FN: 0,
          TN: 1,
          errors: 0,
          precision: 1.0,
          recall: 1.0,
          specificity: 1.0,
          f1: 1.0,
          perAttack: [],
          calculatedAt: new Date().toISOString(),
          _synthetic: true,
        }),
      )
    : req<CollectorScorecardResponse>(`${COLLECTOR_URL}/scorecard`);

// ── MOCK CHAIN API (:4040) ────────────────────────────────────────────────────

export const getChainHealth = (isDemo = false) =>
  MOCK || isDemo
    ? delay<ChainHealthResponse>({ status: "ok", service: "mock-chain", port: 4040, timestamp: new Date().toISOString(), mockChain: true })
    : req<ChainHealthResponse>(`${MOCK_CHAIN_URL}/health`);

export const getChainLedger = (isDemo = false) =>
  MOCK || isDemo
    ? delay<ChainLedgerResponse>({
        balances: [
          { address: "0x402f9c1e7a3b5d2e8c4a6f0d1b9e3c7aa1b2", balance: "100000000" },
          { address: "0xmerchant_safe_00000000000000000000000001", balance: "5000000" },
        ],
        mockChain: true,
      })
    : req<ChainLedgerResponse>(`${MOCK_CHAIN_URL}/ledger`);

export const getChainTransactions = (params?: { status?: string; address?: string }, isDemo = false) => {
  if (MOCK || isDemo) {
    return delay<ChainTransactionsResponse>({ transactions: [], mockChain: true });
  }
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.address) sp.set("address", params.address);
  const query = sp.toString() ? `?${sp.toString()}` : "";
  return req<ChainTransactionsResponse>(`${MOCK_CHAIN_URL}/transactions${query}`);
};

// ── BACKWARD-COMPATIBLE WRAPPERS ──────────────────────────────────────────────

export const getLedger = async (isDemo = false): Promise<SecurityDecision[]> => {
  if (MOCK || isDemo) return delay<SecurityDecision[]>(seedDecisions(64));
  try {
    const res = await getCollectorAuditLog({ limit: 100 }, false);
    if (res.events && res.events.length > 0) {
      return res.events.map((evt) => {
        const d = (evt.data ?? {}) as Record<string, unknown>;
        const isBlocked = evt.eventType.includes("BLOCK") || evt.severity === "HIGH" || evt.severity === "CRITICAL";
        return {
          id: evt.eventId,
          status: isBlocked ? "BLOCKED" : "APPROVED",
          reason: typeof d["reason"] === "string" ? d["reason"] : evt.eventType,
          merchant: typeof d["merchant"] === "string" ? d["merchant"] : evt.source ?? "unknown",
          amount: typeof d["amount"] === "number" ? d["amount"] : typeof d["amount"] === "string" ? parseFloat(d["amount"]) / 1_000_000 : 0.05,
          ml_score: typeof d["ml_score"] === "number" ? d["ml_score"] : isBlocked ? 0.92 : 0.08,
          latency_ms: typeof d["latencyMs"] === "number" ? d["latencyMs"] : 40,
          network: typeof d["network"] === "string" ? d["network"] : "base-sepolia",
          token: typeof d["asset"] === "string" ? d["asset"] : "USDC",
          timestamp: new Date(evt.timestamp).getTime(),
          intent_token: typeof d["intentToken"] === "string" ? d["intentToken"] : evt.runId ?? "0x0",
          expected_pay_to: typeof d["expectedPayTo"] === "string" ? d["expectedPayTo"] : "0x0",
          received_pay_to: typeof d["receivedPayTo"] === "string" ? d["receivedPayTo"] : "0x0",
          firewall_step: typeof d["violatedCheck"] === "string" ? d["violatedCheck"] : evt.eventType,
        };
      });
    }
  } catch {
    // If collector audit log is empty, try Blue audit log
    try {
      const rows = await getBlueAuditLog({ limit: 50 }, false);
      return rows.map((r) => {
        let ev: { expected?: string; received?: string } = {};
        try {
          if (r.evidence_json) ev = JSON.parse(r.evidence_json);
        } catch {
          // Ignored
        }
        return {
          id: r.decision_id,
          status: r.allowed === 1 ? "APPROVED" : "BLOCKED",
          reason: r.attack_type ?? r.violated_check ?? undefined,
          merchant: "api.provider.ai",
          amount: 0.05,
          ml_score: r.allowed === 1 ? 0.05 : 0.95,
          latency_ms: r.latency_ms ?? 30,
          network: "base-sepolia",
          token: "USDC",
          timestamp: new Date(r.decided_at).getTime(),
          intent_token: r.intent_token ?? "0x0",
          expected_pay_to: ev.expected ?? "0x0",
          received_pay_to: ev.received ?? "0x0",
          firewall_step: r.violated_check ?? undefined,
        };
      });
    } catch {
      // Ignored
    }
  }
  return [];
};

// Deprecated ML mock wrappers preserved for Demo mode compatibility only
export const getMLHealth = () => delay({ ok: true });
export const postPolicyCheck = (body: unknown) => postShieldCheck(body);
export const postVerify = (body: unknown) => delay({ ok: true });
export const postMLScore = (features: number[]) => delay({ score: Math.random() });
export const postRetrain = (corpus: unknown) => delay({ model: "XGBClassifier" });
