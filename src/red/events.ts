/**
 * Red event emission.
 *
 * Sends structured events to the Collector service. Failures are logged but
 * never block attack execution — the Red suite must remain functional even
 * when the collector is down.
 */
import { RED_CONFIG } from "./config.js";
import type { RedEvent } from "./types.js";

/**
 * Emit a Red event to the collector. Fire-and-forget: collector outage
 * must never affect attack execution.
 */
export async function emitEvent(event: Omit<RedEvent, "timestamp"> & { message?: string }): Promise<void> {
  const payload = {
    ...event,
    message: event.message ?? `Red ${event.eventType}${event.attackId ? ` (${event.attackId})` : ""}`,
    timestamp: new Date().toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    await fetch(`${RED_CONFIG.collectorUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Collector outage must never affect Red execution.
    // Log locally so the operator knows events are being dropped.
    console.warn(`[red-events] Failed to emit ${event.eventType} (runId=${event.runId}) — collector may be down`);
  }
}

