/**
 * Attack scenario definitions (A01–A10).
 *
 * VALID_BASE contains the trusted, correct payment requirement that matches
 * Blue's trusted-providers.json. Every attack mutates exactly one field (or
 * exercises a temporal / budget vector) so classification is unambiguous.
 *
 * All addresses are DEMO TEST-ONLY FIXTURES. No real wallet addresses.
 */
import type {
  PaymentRequirementPayload,
  ScenarioCatalogEntry,
  ScenarioPayload,
  TOCTOUScenario,
  SequentialScenario,
} from "./types.js";

export const VALID_BASE: PaymentRequirementPayload = {
  scheme: "exact",
  network: "base-sepolia",
  maxAmountRequired: "1000", // $0.001 USDC in atomic units (6 decimals)
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  resource: "https://demo.payguard-merchant.local/paid-api",
  maxTimeoutSeconds: 60,
};

export const SCENARIOS: Record<string, ScenarioPayload> = {
  // A10 — control baseline, must return ALLOW
  A10_VALID: { ...VALID_BASE },

  // A01 — maxAmountRequired is 10× the per-payment limit ($10 USDC)
  A01_OVERPAY: { ...VALID_BASE, maxAmountRequired: "10000000" },

  // A02 — payTo replaced with attacker test address
  A02_WRONG_PAYTO: {
    ...VALID_BASE,
    payTo: "0xDeadBeef00000000000000000000000000000001",
  },

  // A03 — asset replaced with a worthless token contract
  A03_FAKE_TOKEN: {
    ...VALID_BASE,
    asset: "0xFakeToken000000000000000000000000000000001",
  },

  // A04 — network changed to wrong chain
  A04_WRONG_NETWORK: { ...VALID_BASE, network: "ethereum-mainnet" },

  // A05 — expired payment (zero timeout)
  A05_EXPIRED: { ...VALID_BASE, maxTimeoutSeconds: 0 },

  // A06 — replay attack (reuse a nonce Blue has already seen)
  A06_REPLAY: { ...VALID_BASE, nonce: "REPLAY_TEST_NONCE_001" },

  // A07 — domain spoof (resource URL not in Blue's trusted registry)
  A07_DOMAIN_SPOOF: {
    ...VALID_BASE,
    resource: "https://evil-impersonator.com/paid-api",
  },

  // A08 — TOCTOU: approved payload mutated before signing
  A08_TOCTOU: {
    _type: "toctou",
    initialReq: { ...VALID_BASE },
    mutatedReq: { ...VALID_BASE, maxAmountRequired: "9999999" },
  } satisfies TOCTOUScenario,

  // A09 — budget exhaustion: sequential valid payments until daily cap
  A09_BUDGET_EXHAUST: {
    _type: "sequential",
    req: { ...VALID_BASE },
    repeatUntilBlocked: true,
    maxAttempts: 200,
  } satisfies SequentialScenario,
};

/** Full catalog with metadata for each scenario. */
export const SCENARIO_CATALOG: ScenarioCatalogEntry[] = [
  {
    id: "A01_OVERPAY",
    name: "Overpayment Attack",
    description:
      "maxAmountRequired inflated to 10× the per-payment limit ($10 USDC). " +
      "Tests whether Blue enforces per-request spending caps.",
    threatLevel: "HIGH",
    mutatedField: "maxAmountRequired",
    expectedDecision: "BLOCK",
    expectedReasonCode: "OVERPAY",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A02_WRONG_PAYTO",
    name: "Wrong PayTo Address",
    description:
      "payTo replaced with an attacker-controlled test address. " +
      "Tests whether Blue validates the payment destination against trusted providers.",
    threatLevel: "CRITICAL",
    mutatedField: "payTo",
    expectedDecision: "BLOCK",
    expectedReasonCode: "WRONG_PAYTO",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A03_FAKE_TOKEN",
    name: "Fake Token Contract",
    description:
      "asset address replaced with a worthless token contract. " +
      "Tests whether Blue validates the token contract against known USDC addresses.",
    threatLevel: "CRITICAL",
    mutatedField: "asset",
    expectedDecision: "BLOCK",
    expectedReasonCode: "FAKE_TOKEN",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A04_WRONG_NETWORK",
    name: "Wrong Network",
    description:
      "network changed to ethereum-mainnet (not in Blue's allowed list). " +
      "Tests whether Blue enforces network allowlists.",
    threatLevel: "HIGH",
    mutatedField: "network",
    expectedDecision: "BLOCK",
    expectedReasonCode: "WRONG_NETWORK",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A05_EXPIRED",
    name: "Expired Payment",
    description:
      "maxTimeoutSeconds set to 0, creating an already-expired payment window. " +
      "Tests whether Blue checks payment expiry before processing.",
    threatLevel: "MEDIUM",
    mutatedField: "maxTimeoutSeconds",
    expectedDecision: "BLOCK",
    expectedReasonCode: "EXPIRED",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A06_REPLAY",
    name: "Replay Attack",
    description:
      "Resubmits a payment with a nonce Blue has already seen. " +
      "Tests whether Blue maintains a nonce registry to prevent double-spend.",
    threatLevel: "HIGH",
    mutatedField: "nonce",
    expectedDecision: "BLOCK",
    expectedReasonCode: "REPLAY",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A07_DOMAIN_SPOOF",
    name: "Domain Spoof",
    description:
      "resource URL changed to an evil impersonator domain not in Blue's trusted registry. " +
      "Tests whether Blue validates the merchant domain against a trusted list.",
    threatLevel: "CRITICAL",
    mutatedField: "resource",
    expectedDecision: "BLOCK",
    expectedReasonCode: "DOMAIN_SPOOF",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A08_TOCTOU",
    name: "TOCTOU (Time-of-Check / Time-of-Use)",
    description:
      "Submits a valid requirement for approval, obtains an intentToken, " +
      "then attempts to sign with a mutated payload (inflated maxAmountRequired). " +
      "Tests whether Blue's signing boundary re-validates the payload fingerprint.",
    threatLevel: "CRITICAL",
    mutatedField: "maxAmountRequired (post-approval mutation)",
    expectedDecision: "BLOCK",
    expectedReasonCode: "TOCTOU",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A09_BUDGET_EXHAUST",
    name: "Budget Exhaustion",
    description:
      "Sends sequential valid payments until the daily budget is exhausted. " +
      "Tests whether Blue enforces cumulative spending limits and stops signing " +
      "once the budget ceiling is reached.",
    threatLevel: "HIGH",
    mutatedField: null,
    expectedDecision: "BLOCK",
    expectedReasonCode: "BUDGET_EXHAUST",
    signerShouldBeCalled: false,
    fundsShouldMove: false,
  },
  {
    id: "A10_VALID",
    name: "Valid Control Baseline",
    description:
      "Submits a fully valid payment requirement that matches all of Blue's " +
      "trusted provider rules. Must return ALLOW — a block here is a false positive.",
    threatLevel: "NONE",
    mutatedField: null,
    expectedDecision: "ALLOW",
    expectedReasonCode: null,
    signerShouldBeCalled: true,
    fundsShouldMove: true,
  },
];

const ALIAS_MAP: Record<string, string> = {
  VALID: "A10_VALID",
  A10: "A10_VALID",
  A10_VALID: "A10_VALID",
  OVERPAY: "A01_OVERPAY",
  A01: "A01_OVERPAY",
  A01_OVERPAY: "A01_OVERPAY",
  WRONG_PAYTO: "A02_WRONG_PAYTO",
  A02: "A02_WRONG_PAYTO",
  A02_WRONG_PAYTO: "A02_WRONG_PAYTO",
  FAKE_TOKEN: "A03_FAKE_TOKEN",
  A03: "A03_FAKE_TOKEN",
  A03_FAKE_TOKEN: "A03_FAKE_TOKEN",
  WRONG_NETWORK: "A04_WRONG_NETWORK",
  A04: "A04_WRONG_NETWORK",
  A04_WRONG_NETWORK: "A04_WRONG_NETWORK",
  EXPIRED: "A05_EXPIRED",
  A05: "A05_EXPIRED",
  A05_EXPIRED: "A05_EXPIRED",
  REPLAY: "A06_REPLAY",
  A06: "A06_REPLAY",
  A06_REPLAY: "A06_REPLAY",
  DOMAIN_SPOOF: "A07_DOMAIN_SPOOF",
  A07: "A07_DOMAIN_SPOOF",
  A07_DOMAIN_SPOOF: "A07_DOMAIN_SPOOF",
  TOCTOU: "A08_TOCTOU",
  A08: "A08_TOCTOU",
  A08_TOCTOU: "A08_TOCTOU",
  BUDGET_EXHAUST: "A09_BUDGET_EXHAUST",
  A09: "A09_BUDGET_EXHAUST",
  A09_BUDGET_EXHAUST: "A09_BUDGET_EXHAUST",
};

/** Normalize any scenario identifier or alias to the canonical ID. */
export function normalizeScenarioId(id: string): string {
  const upper = id.toUpperCase().trim();
  return ALIAS_MAP[upper] ?? id;
}

/** Look up a scenario payload by its ID or alias. */
export function getScenario(id: string): ScenarioPayload | undefined {
  const canonical = normalizeScenarioId(id);
  return SCENARIOS[canonical];
}

/** Look up catalog metadata by scenario ID or alias. */
export function getCatalogEntry(id: string): ScenarioCatalogEntry | undefined {
  const canonical = normalizeScenarioId(id);
  return SCENARIO_CATALOG.find((e) => e.id === canonical);
}

/** Check whether a scenario payload is a simple (non-compound) requirement. */
export function isSimplePayload(s: ScenarioPayload): s is PaymentRequirementPayload {
  return !("_type" in s);
}

/** Check whether a scenario payload is a TOCTOU compound attack. */
export function isTOCTOU(s: ScenarioPayload): s is TOCTOUScenario {
  return "_type" in s && s._type === "toctou";
}

/** Check whether a scenario payload is a sequential/budget-exhaust attack. */
export function isSequential(s: ScenarioPayload): s is SequentialScenario {
  return "_type" in s && s._type === "sequential";
}

