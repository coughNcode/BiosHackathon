export type DecisionStatus = "APPROVED" | "BLOCKED" | "FLAG";

export interface SecurityDecision {
  id: string;
  status: DecisionStatus;
  reason?: string;
  merchant: string;
  amount: number;
  ml_score: number;
  latency_ms: number;
  network: string;
  token: string;
  timestamp: number;
  intent_token: string;
  expected_pay_to: string;
  received_pay_to: string;
  firewall_step?: string;
}

export interface Attack {
  id: string;
  desc: string;
  reason: string;
  severity: "critical" | "medium" | "evasion";
}

export interface BenchmarkRow {
  attack: string;
  result: "BLOCKED" | "PASSED" | "ERROR";
  latency: number;
  reason: string;
  ml: number;
  evidence?: {
    expected?: string;
    received?: string;
    violatedCheck?: string;
  };
  signerInvoked?: boolean;
  chainTransferred?: boolean;
}

export interface Policy {
  limits: { daily_budget: number; per_request_max: number; per_merchant_daily: number; approval_threshold: number };
  providers: { domain: string; wallet: string; network: string; token: string; max: number }[];
}

// ── Blue Agent API Types ──────────────────────────────────────────────────────

export interface BlueHealthResponse {
  status: string;
  service: string;
  port: number;
  timestamp: string;
}

export interface BluePolicyResponse {
  perRequestMaxUsd: number;
  dailyBudgetUsd: number;
  tokenDecimals: number;
}

export interface BlueProvider {
  domain: string;
  payTo: string;
  network: string;
  asset: string;
  maxAmountUsd: number;
}

export interface BlueMetricsResponse {
  totalDecisions: number;
  approved: number;
  blocked: number;
  byAttackType: Record<string, number>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  signerInvokedOnBlock: number;
}

export interface BlueDecisionRecord {
  decision_id: string;
  decided_at: string;
  allowed: number;
  attack_type: string | null;
  violated_check: string | null;
  suspicious_field: string | null;
  evidence_json: string | null;
  intent_token: string | null;
  latency_ms: number;
}

// ── Red Team API Types ────────────────────────────────────────────────────────

export interface RedHealthResponse {
  status: string;
  service: string;
  port: number;
  blueTarget: string;
  totalRuns: number;
  runningAttacks: number;
}

export interface RedAttackScenario {
  id: string;
  name: string;
  category: string;
  threatLevel: string;
  expectedDecision: string;
  description: string;
  expectedCheck: string;
}

export interface RedAttacksResponse {
  attacks: RedAttackScenario[];
  totalScenarios: number;
  blueTarget: string;
}

export interface RedRunResponse {
  runId: string;
  attackId?: string;
  status: string;
  strategy?: string;
  attacks?: string[];
  total?: number;
}

export interface RedResultResponse {
  runId: string;
  attackId: string;
  classification: string;
  blueResponse?: {
    allowed: boolean;
    intentToken: string | null;
    decision?: {
      decisionId: string;
      allowed: boolean;
      attackType: string;
      violatedCheck: string;
      suspiciousField: string;
      evidence: {
        expected?: string;
        received?: string;
      };
      intentToken: string | null;
      latencyMs: number;
      decidedAt: string;
    };
  };
  signerEvidence?: {
    invoked: boolean;
    source: string;
    details: string;
  };
  chainResult?: {
    fundsTransferred: boolean;
    txHash: string | null;
    source: string;
    details: string;
  };
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: string;
  childRuns?: RedResultResponse[];
}

export interface RedHistoryResponse {
  stats: {
    total: number;
    blocked: number;
    bypassed: number;
    fundsLost: number;
    falsePositives: number;
    validSuccess: number;
    errors: number;
  };
  perAttack: Record<string, Record<string, number>>;
  runs: RedResultResponse[];
  running: { runId: string; attackId: string; startedAt: string }[];
}

export interface RedUCB1Arm {
  attackId: string;
  pulls: number;
  reward: number;
  score: number;
}

export interface RedUCB1State {
  totalPulls: number;
  arms: RedUCB1Arm[];
}

export interface RedUCB1Response {
  ucb1: RedUCB1State;
  nextRecommended: string;
}

export interface RedMutationItem {
  mutationId: string;
  category: string;
  description: string;
  mutatedFields: string[];
}

export interface RedFuzzerCatalogResponse {
  totalMutations: number;
  mutations: RedMutationItem[];
}

// ── Collector API Types ───────────────────────────────────────────────────────

export interface CollectorHealthResponse {
  status: string;
  service: string;
  port: number;
  eventCount: number;
  runCount: number;
}

export interface CollectorEvent {
  eventId: string;
  timestamp: string;
  runId: string | null;
  source: string;
  eventType: string;
  severity: string;
  attackId: string | null;
  message: string;
  data: Record<string, unknown>;
  receivedAt: string;
}

export interface CollectorEventsResponse {
  events: CollectorEvent[];
  total: number;
  offset: number;
  limit: number;
}

export interface CollectorRunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  attackId: string | null;
  source: string | null;
  classification: string | null;
  blueDecision: string | null;
  signerInvoked: number | null;
  chainTransfer: number | null;
  latencyMs: number | null;
}

export interface CollectorRunsResponse {
  runs: CollectorRunRecord[];
  total: number;
}

export interface CollectorRunDetailsResponse {
  run: CollectorRunRecord;
  events: CollectorEvent[];
}

export interface CollectorMetricsResponse {
  totalAttacks: number;
  attacksBlocked: number;
  attacksBypass: number;
  fundsLost: number;
  validControls: number;
  validControlsAccepted: number;
  falsePositives: number;
  attackErrors: number;
  signerInvokedOnBlock: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  detectionRate: number | null;
  lastUpdated: string;
}

export interface PerAttackScorecardItem {
  attackId: string;
  attackName: string;
  expectedDecision: "BLOCK" | "ALLOW";
  classification: string;
  blueDecision: string | null;
  signerInvoked: boolean | null;
  chainTransfer: boolean | null;
  latencyMs: number | null;
  runId: string | null;
  runAt: string | null;
}

export interface CollectorScorecardResponse {
  TP: number;
  FP: number;
  FN: number;
  TN: number;
  errors: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  f1: number | null;
  perAttack: PerAttackScorecardItem[];
  calculatedAt: string;
  _synthetic?: boolean;
}

// ── Mock Chain API Types ──────────────────────────────────────────────────────

export interface ChainHealthResponse {
  status: string;
  service: string;
  port: number;
  timestamp: string;
  mockChain: boolean;
}

export interface ChainLedgerResponse {
  balances: { address: string; balance: string }[];
  mockChain: boolean;
}

export interface ChainTransaction {
  txId: string;
  from: string;
  to: string;
  amount: string;
  network: string;
  status: string;
  runId: string | null;
  timestamp: string;
  error: string | null;
}

export interface ChainTransactionsResponse {
  transactions: ChainTransaction[];
  mockChain: boolean;
}

// ── 6-Service Health Panel Types ──────────────────────────────────────────────

export type ServiceHealthState = "Connected" | "Disconnected" | "Checking" | "Error";

export interface SixServicesStatus {
  blue: ServiceHealthState;
  chain: ServiceHealthState;
  merchant: ServiceHealthState;
  facilitator: ServiceHealthState;
  console: ServiceHealthState;
  collector: ServiceHealthState;
}

export interface MerchantHealthResponse {
  status: string;
  service: string;
  port: number;
}

export interface FacilitatorHealthResponse {
  status: string;
  service: string;
  port: number;
  mode?: string;
}
