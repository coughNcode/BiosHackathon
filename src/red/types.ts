/**
 * Shared types for the Red Team attack infrastructure.
 *
 * Every attack scenario, classification result, event, and facilitator mode
 * lives here so the merchant, facilitator, console, and runner share a single
 * source of truth.
 */

// ── Threat & Classification ─────────────────────────────────────────────────

export type ThreatLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type Classification =
  | "ATTACK_BLOCKED"
  | "ATTACK_BYPASS"
  | "FUNDS_LOST"
  | "FALSE_POSITIVE"
  | "VALID_SUCCESS"
  | "ATTACK_ERROR";

export type ExpectedDecision = "BLOCK" | "ALLOW";

// ── Attack Scenarios ────────────────────────────────────────────────────────

export interface PaymentRequirementPayload {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  asset: string;
  resource: string;
  maxTimeoutSeconds: number;
  nonce?: string;
  [key: string]: unknown;
}

export interface TOCTOUScenario {
  _type: "toctou";
  initialReq: PaymentRequirementPayload;
  mutatedReq: PaymentRequirementPayload;
}

export interface SequentialScenario {
  _type: "sequential";
  req: PaymentRequirementPayload;
  repeatUntilBlocked: boolean;
  maxAttempts: number;
}

export type ScenarioPayload = PaymentRequirementPayload | TOCTOUScenario | SequentialScenario;

export interface ScenarioCatalogEntry {
  id: string;
  name: string;
  description: string;
  threatLevel: ThreatLevel;
  mutatedField: string | null;
  expectedDecision: ExpectedDecision;
  expectedReasonCode: string | null;
  signerShouldBeCalled: boolean;
  fundsShouldMove: boolean;
}

// ── Attack Results ──────────────────────────────────────────────────────────

export interface SignerEvidence {
  invoked: boolean;
  source: "audit_log" | "inferred" | "unavailable";
  details?: string;
}

export interface ChainResult {
  fundsTransferred: boolean;
  txHash: string | null;
  source: "mock_chain" | "unavailable";
  details?: string;
}

export interface BlueResponse {
  allowed: boolean;
  decision?: {
    attackType?: string;
    reason?: string;
    [key: string]: unknown;
  };
  intentToken?: string;
  [key: string]: unknown;
}

export interface AttackResult {
  runId: string;
  attackId: string;
  classification: Classification;
  blueResponse: BlueResponse | null;
  signerEvidence: SignerEvidence;
  chainResult: ChainResult;
  evidence?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface BudgetExhaustResult extends AttackResult {
  blockedOnAttempt?: number;
  totalAttempts: number;
  results: Array<{ attempt: number; allowed: boolean; reason?: string }>;
}

// ── Facilitator Modes ───────────────────────────────────────────────────────

export type FacilitatorMode =
  | "normal"
  | "fail_verify"
  | "fail_settle"
  | "timeout"
  | "malformed";

// ── Red Events ──────────────────────────────────────────────────────────────

export interface RedEvent {
  source: "RED";
  eventType:
    | "ATTACK_STARTED"
    | "ATTACK_COMPLETED"
    | "ATTACK_ERROR"
    | "FACILITATOR_MODE_CHANGED"
    | "MERCHANT_MODE_CHANGED";
  runId: string;
  attackId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ── UCB1 ────────────────────────────────────────────────────────────────────

export interface UCB1ArmState {
  attackId: string;
  pulls: number;
  totalReward: number;
  avgReward: number;
  ucbScore: number;
}

export interface UCB1State {
  totalPulls: number;
  arms: UCB1ArmState[];
  lastSelected: string | null;
  explorationConstant: number;
}

