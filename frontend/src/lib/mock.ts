import type { Attack, Policy, SecurityDecision } from "./types";

export const ATTACKS: Attack[] = [
  { id: "wrong_recipient_wallet", desc: "Redirects funds to attacker wallet", reason: "WRONG_RECIPIENT", severity: "critical" },
  { id: "overpayment_10x", desc: "Requests 10x the agreed amount", reason: "OVERPAYMENT", severity: "critical" },
  { id: "intent_toctou_mutation", desc: "Mutates requirement between approval and signing", reason: "INTENT_FINGERPRINT", severity: "critical" },
  { id: "expired_requirement", desc: "Submits an already-expired payment requirement", reason: "EXPIRED", severity: "medium" },
  { id: "wrong_network", desc: "Claims wrong chain ID to bypass validation", reason: "NETWORK_MISMATCH", severity: "medium" },
  { id: "wrong_token_contract", desc: "Swaps USDC address for an ERC-20 honeypot", reason: "TOKEN_MISMATCH", severity: "medium" },
  { id: "replay_attack", desc: "Resubmits a previously settled payment", reason: "REPLAY", severity: "medium" },
  { id: "budget_exhaustion", desc: "Fires 200 micro-payments to drain daily budget", reason: "BUDGET_EXCEEDED", severity: "medium" },
  { id: "probe_sequence", desc: "Growing amounts across 7 payments to calibrate limits", reason: "PROBE_SEQUENCE", severity: "medium" },
  { id: "ml_evasion_variant", desc: "Mutated attack designed to pass rule checks", reason: "ML_ANOMALY", severity: "evasion" },
];

export const FEATURES: { name: string; info: string }[] = [
  { name: "amount_ratio", info: "How large is this payment vs your daily budget limit?" },
  { name: "recipient_mismatch", info: "Did the wallet address match your trusted registry?" },
  { name: "expiry_delta_s", info: "How soon does this payment requirement expire?" },
  { name: "network_match", info: "Is the payment on your approved blockchain network?" },
  { name: "merchant_seen_count", info: "How many times have you paid this merchant before?" },
  { name: "inter_tx_ms", info: "How quickly after the last payment is this one arriving?" },
  { name: "amount_delta_pct", info: "How different is this amount from your recent average?" },
  { name: "hour_of_day", info: "What UTC hour is this payment being made?" },
  { name: "intent_fingerprint_valid", info: "Was the payment tampered with between approval and signing?" },
];

/** Attack threshold per feature (normalized 0-1), drawn as the dashed radar polygon. */
export const FEATURE_THRESHOLDS = [0.6, 0.5, 0.55, 0.5, 0.6, 0.55, 0.6, 0.5, 0.5];

/** Normalized 0-1 risk contribution of each feature for one scored payment. */
export function featureVector(d: SecurityDecision | undefined): number[] {
  if (!d) return FEATURES.map(() => 0);
  const s = d.ml_score;
  const mismatch = d.expected_pay_to !== d.received_pay_to ? 1 : 0;
  const r = d.reason ?? "";
  const h = (n: number) => ((d.timestamp / 1000 + n * 7919) % 97) / 97;
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return [
    c(r === "OVERPAYMENT" || r === "BUDGET_EXCEEDED" ? 0.95 : d.amount * 8 + s * 0.2),
    mismatch ? 0.95 : 0.05,
    c(r === "EXPIRED" ? 0.9 : 0.15 + h(1) * 0.2),
    r === "NETWORK_MISMATCH" ? 0.95 : 0.05,
    c(s * 0.6 + h(2) * 0.2),
    c(r === "REPLAY" || r === "PROBE_SEQUENCE" ? 0.85 : 0.1 + h(3) * 0.3),
    c(s * 0.8 + h(4) * 0.15),
    c(0.2 + h(5) * 0.4),
    r === "INTENT_FINGERPRINT" ? 0.95 : 0.05,
  ];
}

export const FEATURE_WEIGHTS = [0.21, 0.19, 0.06, 0.09, 0.07, 0.11, 0.12, 0.03, 0.12];

export const POLICY: Policy = {
  limits: { daily_budget: 1, per_request_max: 0.05, per_merchant_daily: 0.25, approval_threshold: 0.02 },
  providers: [
    { domain: "api.openai.com", wallet: "0x402f1c9e7a3b5d2e8c4a1b2", network: "base-sepolia", token: "USDC", max: 0.01 },
    { domain: "api.anthropic.com", wallet: "0x402a9d3e6b1c7f0a2e5dabc1", network: "base-sepolia", token: "USDC", max: 0.01 },
    { domain: "data.chainlink.com", wallet: "0x4027be4c2d8a9f3e1b6c55e0", network: "base-sepolia", token: "USDC", max: 0.02 },
  ],
};

const CYCLE: Partial<SecurityDecision>[] = [
  { status: "APPROVED", merchant: "api.openai.com", amount: 0.001, ml_score: 0.08, latency_ms: 4 },
  { status: "BLOCKED", reason: "WRONG_RECIPIENT", merchant: "attacker.evil", amount: 0.001, ml_score: 0.94, latency_ms: 6, firewall_step: "2 -- Identity Binding" },
  { status: "BLOCKED", reason: "OVERPAYMENT", merchant: "api.anthropic.com", amount: 0.1, ml_score: 0.31, latency_ms: 3, firewall_step: "4 -- Amount Bound" },
  { status: "BLOCKED", reason: "INTENT_FINGERPRINT", merchant: "api.openai.com", amount: 0.001, ml_score: 0.77, latency_ms: 5, firewall_step: "3 -- Intent Integrity" },
  { status: "FLAG", reason: "ML_ANOMALY", merchant: "data.chainlink.com", amount: 0.003, ml_score: 0.72, latency_ms: 7, firewall_step: "8 -- ML Guard" },
  { status: "APPROVED", merchant: "data.chainlink.com", amount: 0.005, ml_score: 0.11, latency_ms: 4 },
];

const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
let i = 0;

export function nextMockDecision(ts = Date.now()): SecurityDecision {
  const base = CYCLE[i++ % CYCLE.length]!;
  const expected = "0x402" + hex(33) + "abc1";
  return {
    id: hex(12),
    network: "base-sepolia",
    token: "USDC",
    timestamp: ts,
    intent_token: "0x" + hex(64),
    expected_pay_to: expected,
    received_pay_to: base.reason === "WRONG_RECIPIENT" ? "0xDEAD" + hex(32) + "beef" : expected,
    ...base,
  } as SecurityDecision;
}

export const seedDecisions = (n: number) =>
  Array.from({ length: n }, (_, k) => nextMockDecision(Date.now() - (n - k) * 9000)).reverse();
