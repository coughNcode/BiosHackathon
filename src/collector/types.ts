import { z } from "zod";

/**
 * Zod schema for incoming event payloads per the shared contract.
 */
export const EventInputSchema = z.object({
  eventId: z.string().optional(),
  timestamp: z.string().min(1, "timestamp is required"),
  runId: z.string().nullable().optional(),
  source: z.string().min(1, "source is required"),
  eventType: z.string().min(1, "eventType is required"),
  severity: z.string().default("INFO"),
  attackId: z.string().nullable().optional(),
  message: z.string().optional().default(""),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});

export type EventInput = z.infer<typeof EventInputSchema>;

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

export interface RunRecord {
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

export interface MetricsResponse {
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

export interface ScorecardResponse {
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
