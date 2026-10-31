import { v4 as uuidv4 } from "uuid";

/**
 * Structured event emitter for PayGuard AI.
 *
 * Sends events to the collector service for the dashboard.
 * CRITICAL: Collector failure MUST NOT affect payment security.
 * Events are fire-and-forget with a 2-second timeout.
 *
 * NEVER include in event data:
 * - Private keys or seed phrases
 * - Raw signing secrets
 * - ADMIN_KEY or SIGNING_SECRET values
 * - Full raw wallet credentials
 * - Unmasked authorization headers
 */

export interface PayGuardEvent {
  eventId: string;
  timestamp: string;
  runId: string;
  source: "BLUE" | "CHAIN" | "SYSTEM";
  eventType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  attackId: string | null;
  message: string;
  data: Record<string, unknown>;
}

export function createEventId(): string {
  return `evt_${uuidv4()}`;
}

export async function emitEvent(event: PayGuardEvent): Promise<void> {
  const url = process.env.COLLECTOR_URL;
  if (!url) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`${url}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    console.warn("[event-emitter] collector unavailable, event dropped:", event.eventId);
  }
}

export function buildEvent(
  source: PayGuardEvent["source"],
  eventType: string,
  severity: PayGuardEvent["severity"],
  message: string,
  data: Record<string, unknown>,
  runId?: string,
  attackId?: string | null,
): PayGuardEvent {
  return {
    eventId: createEventId(),
    timestamp: new Date().toISOString(),
    runId: runId ?? `run_${uuidv4()}`,
    source,
    eventType,
    severity,
    attackId: attackId ?? null,
    message,
    data,
  };
}
