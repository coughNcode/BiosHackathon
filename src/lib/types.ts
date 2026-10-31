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
  result: "BLOCKED" | "PASSED";
  latency: number;
  reason: string;
  ml: number;
}

export interface Policy {
  limits: { daily_budget: number; per_request_max: number; per_merchant_daily: number; approval_threshold: number };
  providers: { domain: string; wallet: string; network: string; token: string; max: number }[];
}
