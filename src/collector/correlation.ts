import type { CollectorDatabase } from "./db.js";
import type { CollectorEvent, RunRecord } from "./types.js";

/**
 * Correlates events for a given runId and updates the runs record.
 */
export function correlateEvent(db: CollectorDatabase, evt: CollectorEvent): void {
  if (!evt.runId) return;

  const runId = evt.runId;
  const existing = db.getRunById(runId);
  const data = evt.data || {};

  const runUpdate: Partial<RunRecord> & { runId: string } = {
    runId,
    startedAt: existing?.startedAt ?? evt.timestamp,
  };

  if (evt.attackId) {
    runUpdate.attackId = evt.attackId;
  } else if (typeof data["attackId"] === "string") {
    runUpdate.attackId = data["attackId"];
  } else if (typeof data["scenario"] === "string") {
    runUpdate.attackId = data["scenario"];
  }

  if (evt.source && !existing?.source) {
    runUpdate.source = evt.source;
  }

  // Handle explicit fields in data if present
  if (typeof data["classification"] === "string") {
    runUpdate.classification = data["classification"];
  }
  if (typeof data["blueDecision"] === "string") {
    runUpdate.blueDecision = data["blueDecision"];
  } else if (typeof data["blue_decision"] === "string") {
    runUpdate.blueDecision = data["blue_decision"];
  }

  // Event type specific handling
  switch (evt.eventType) {
    case "ATTACK_STARTED": {
      runUpdate.startedAt = evt.timestamp;
      break;
    }

    case "ATTACK_SENT": {
      if (!existing?.startedAt) {
        runUpdate.startedAt = evt.timestamp;
      }
      break;
    }

    case "PAYMENT_APPROVED": {
      runUpdate.blueDecision = "ALLOW";
      break;
    }

    case "PAYMENT_BLOCKED": {
      runUpdate.blueDecision = "BLOCK";
      break;
    }

    case "BLUE_RESPONSE_RECEIVED": {
      const decision =
        typeof data["decision"] === "string"
          ? data["decision"]
          : typeof data["blueDecision"] === "string"
          ? data["blueDecision"]
          : evt.message.toUpperCase().includes("BLOCK")
          ? "BLOCK"
          : evt.message.toUpperCase().includes("ALLOW")
          ? "ALLOW"
          : null;
      if (decision) runUpdate.blueDecision = decision;
      break;
    }

    case "SIGNER_INVOKED": {
      runUpdate.signerInvoked = 1;
      break;
    }

    case "SIGNATURE_CREATED": {
      runUpdate.signerInvoked = 1;
      break;
    }

    case "SETTLEMENT_ATTEMPTED": {
      // Settlement attempt recorded
      break;
    }

    case "FUNDS_TRANSFERRED": {
      runUpdate.chainTransfer = 1;
      break;
    }

    case "NO_TRANSFER": {
      runUpdate.chainTransfer = 0;
      break;
    }

    case "ATTACK_COMPLETED": {
      runUpdate.finishedAt = evt.timestamp;

      // Latency computation
      if (typeof data["latencyMs"] === "number") {
        runUpdate.latencyMs = data["latencyMs"];
      } else {
        const computedLatency = computeRunLatency(db, runId, evt.timestamp);
        if (computedLatency !== null) {
          runUpdate.latencyMs = computedLatency;
        }
      }

      // Classification computation if not already set
      if (!runUpdate.classification && !existing?.classification) {
        runUpdate.classification = deduceClassification(
          runUpdate.attackId ?? existing?.attackId,
          runUpdate.blueDecision ?? existing?.blueDecision,
          runUpdate.chainTransfer ?? existing?.chainTransfer
        );
      }
      break;
    }

    case "ATTACK_ERROR": {
      runUpdate.finishedAt = evt.timestamp;
      runUpdate.classification = "ATTACK_ERROR";
      break;
    }
  }

  db.upsertRun(runUpdate);
}

/**
 * Computes latency: timestamp of decision event minus timestamp of validation started.
 */
function computeRunLatency(
  db: CollectorDatabase,
  runId: string,
  finishedAt: string
): number | null {
  const { events } = db.getEvents({ runId, limit: 100 });
  const startEvt = events.find((e) => e.eventType === "PAYMENT_VALIDATION_STARTED") ||
                   events.find((e) => e.eventType === "ATTACK_SENT") ||
                   events.find((e) => e.eventType === "ATTACK_STARTED");

  const decEvt = events.find(
    (e) => e.eventType === "PAYMENT_BLOCKED" ||
           e.eventType === "PAYMENT_APPROVED" ||
           e.eventType === "BLUE_RESPONSE_RECEIVED"
  );

  if (startEvt && decEvt) {
    const startMs = new Date(startEvt.timestamp).getTime();
    const decMs = new Date(decEvt.timestamp).getTime();
    if (!isNaN(startMs) && !isNaN(decMs) && decMs >= startMs) {
      return decMs - startMs;
    }
  } else if (startEvt) {
    const startMs = new Date(startEvt.timestamp).getTime();
    const finMs = new Date(finishedAt).getTime();
    if (!isNaN(startMs) && !isNaN(finMs) && finMs >= startMs) {
      return finMs - startMs;
    }
  }

  return null;
}

/**
 * Deduce classification based on scenario and observed facts.
 */
function deduceClassification(
  attackId?: string | null,
  blueDecision?: string | null,
  chainTransfer?: number | null
): string | null {
  const isControl = attackId === "A10" || attackId?.toLowerCase().includes("control") || attackId?.toLowerCase().includes("valid");

  if (isControl) {
    if (blueDecision === "BLOCK") return "FALSE_POSITIVE";
    if (blueDecision === "ALLOW") return "VALID_SUCCESS";
    return null;
  }

  // Malicious scenario
  if (blueDecision === "BLOCK") return "ATTACK_BLOCKED";
  if (blueDecision === "ALLOW") {
    if (chainTransfer === 1) return "FUNDS_LOST";
    return "ATTACK_BYPASS";
  }

  return null;
}

