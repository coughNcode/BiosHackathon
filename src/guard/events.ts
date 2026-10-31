/**
 * L8 — Decision Log
 *
 * Every guard decision (ALLOW or BLOCK) is written here.
 * This layer NEVER blocks — it is purely observational.
 *
 * Each event is:
 *  1. Written to local stdout (JSON lines, structured)
 *  2. Posted to the collector (COLLECTOR_URL env)
 *     — if the collector is down, events buffer in memory and are flushed on reconnect
 *
 * THREE EVENTS ARE TRACKED SEPARATELY (global rule — never conflate):
 *   POLICY_APPROVED  — PolicyEngine said allowed:true
 *   SIGNER_CALLED    — signTypedData was invoked
 *   CHAIN_TRANSFERRED — mock chain confirmed balance change
 *
 * SECURITY RULE: private keys, signing secrets, and raw credentials
 * MUST NEVER appear in event payloads or logs.
 */

import { randomUUID } from "node:crypto";
import type { ReasonCode } from "./reasons.js";

export type EventKind =
  | "POLICY_APPROVED"
  | "POLICY_BLOCKED"
  | "SIGNER_CALLED"
  | "SIGNER_BLOCKED"
  | "CHAIN_TRANSFERRED"
  | "GUARD_INTERNAL";

export interface GuardEvent {
  event_id: string;
  ts: string;
  kind: EventKind;
  layer: string;
  decision: "ALLOW" | "BLOCK";
  reason: ReasonCode;
  detail?: unknown;
  /** SHA-256 of the pinned quote bytes — never the raw quote */
  pin_hash?: string;
  /** HMAC of the policy object */
  policy_digest?: string;
  /** Correlation across layers */
  trace_id: string;
  /** Amount in atomic units (never USD float) */
  amount_atomic?: string;
  /** Merchant host only — never full URL with auth */
  merchant?: string;
  attack?: string;
  target?: string;
}

/** Pending events waiting for collector to come back online */
const _buffer: GuardEvent[] = [];
const MAX_BUFFER = 500;

const COLLECTOR_URL = process.env.COLLECTOR_URL;
const SERVICE_NAME = process.env.SERVICE_NAME ?? "blue-guard";

async function postToCollector(event: GuardEvent): Promise<void> {
  if (!COLLECTOR_URL) return;
  try {
    const res = await fetch(`${COLLECTOR_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`collector ${res.status}`);
  } catch {
    // Buffer for retry
    if (_buffer.length < MAX_BUFFER) _buffer.push(event);
  }
}

async function flushBuffer(): Promise<void> {
  if (!COLLECTOR_URL || _buffer.length === 0) return;
  const toFlush = _buffer.splice(0, _buffer.length);
  for (const evt of toFlush) {
    await postToCollector(evt);
  }
}

/** Emit a guard decision event. Never throws. */
export async function emitEvent(
  event: Omit<GuardEvent, "event_id" | "ts">
): Promise<void> {
  const full: GuardEvent = {
    event_id: `evt_${randomUUID()}`,
    ts: new Date().toISOString(),
    ...event,
  };

  // Structured JSON log line — safe fields only
  const logLine = {
    service: SERVICE_NAME,
    ...full,
    // Explicitly exclude any private key or secret fields
    detail:
      full.detail &&
      typeof full.detail === "object" &&
      !Array.isArray(full.detail)
        ? sanitizeDetail(full.detail as Record<string, unknown>)
        : full.detail,
  };

  // Write to stdout as JSON lines
  process.stdout.write(JSON.stringify(logLine) + "\n");

  // Flush buffer then post new event
  await flushBuffer();
  await postToCollector(full);
}

/** Strip any field that looks like a private key or secret before logging */
function sanitizeDetail(obj: Record<string, unknown>): Record<string, unknown> {
  const FORBIDDEN_KEYS = new Set([
    "privateKey",
    "private_key",
    "secret",
    "signing_secret",
    "signingSecret",
    "key",
    "mnemonic",
    "seed",
    "password",
    "credential",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Convenience: emit a BLOCK decision */
export function emitBlock(
  layer: string,
  reason: ReasonCode,
  trace_id: string,
  extra?: Partial<GuardEvent>
): Promise<void> {
  return emitEvent({
    kind: "POLICY_BLOCKED",
    layer,
    decision: "BLOCK",
    reason,
    trace_id,
    ...extra,
  });
}

/** Convenience: emit an ALLOW decision */
export function emitAllow(
  layer: string,
  reason: ReasonCode,
  trace_id: string,
  extra?: Partial<GuardEvent>
): Promise<void> {
  return emitEvent({
    kind: "POLICY_APPROVED",
    layer,
    decision: "ALLOW",
    reason,
    trace_id,
    ...extra,
  });
}

