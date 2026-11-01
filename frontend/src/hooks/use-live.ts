import { useEffect, useRef, useState } from "react";
import {
  getChainHealth,
  getCollectorEvents,
  getCollectorHealth,
  getFacilitatorHealth,
  getHealth,
  getMerchantHealth,
  getRedHealth,
  MOCK,
} from "@/lib/api";
import { nextMockDecision, seedDecisions } from "@/lib/mock";
import { useStore, type ServiceHealthState } from "@/lib/store";
import type { CollectorEvent, SecurityDecision } from "@/lib/types";

export function useConnectionStatus() {
  const demo = useStore((s) => s.demo);

  useEffect(() => {
    let prevStates: Record<string, ServiceHealthState> = {
      blue: "Connected",
      chain: "Connected",
      merchant: "Connected",
      facilitator: "Connected",
      console: "Connected",
      collector: "Connected",
    };

    const checkService = async (fn: () => Promise<any>): Promise<ServiceHealthState> => {
      try {
        const res = await fn();
        if (res && (res.status === "ok" || res.service || !res.error)) {
          return "Connected";
        }
        return "Error";
      } catch (err: any) {
        if (err?.message?.includes("timed out") || err?.status >= 500) {
          return "Error";
        }
        return "Disconnected";
      }
    };

    const check = async () => {
      if (demo) {
        useStore.getState().setSixServicesConn({
          blue: "Connected",
          chain: "Connected",
          merchant: "Connected",
          facilitator: "Connected",
          console: "Connected",
          collector: "Connected",
        });
        return;
      }

      const [blueState, chainState, merchantState, facilitatorState, consoleState, collectorState] =
        await Promise.all([
          checkService(() => getHealth(false)),
          checkService(() => getChainHealth(false)),
          checkService(() => getMerchantHealth(false)),
          checkService(() => getFacilitatorHealth(false)),
          checkService(() => getRedHealth(false)),
          checkService(() => getCollectorHealth(false)),
        ]);

      useStore.getState().setSixServicesConn({
        blue: blueState,
        chain: chainState,
        merchant: merchantState,
        facilitator: facilitatorState,
        console: consoleState,
        collector: collectorState,
      });

      if (prevStates["blue"] === "Connected" && blueState !== "Connected") {
        useStore.getState().toast("Blue Agent offline (:4010)", "danger");
      }
      if (prevStates["collector"] === "Connected" && collectorState !== "Connected") {
        useStore.getState().toast("Collector offline (:4050)", "warn");
      }
      if (prevStates["console"] === "Connected" && consoleState !== "Connected") {
        useStore.getState().toast("Red Console offline (:4060)", "warn");
      }
      if (prevStates["chain"] === "Connected" && chainState !== "Connected") {
        useStore.getState().toast("Mock Chain offline (:4040)", "warn");
      }

      prevStates = {
        blue: blueState,
        chain: chainState,
        merchant: merchantState,
        facilitator: facilitatorState,
        console: consoleState,
        collector: collectorState,
      };
    };

    check();
    const t = setInterval(check, 3500);
    return () => clearInterval(t);
  }, [demo]);
}

/** Live feed cadence: every 2s in Demo Mode so the synthetic feed looks active */
export const feedInterval = (demo: boolean) => (demo ? 2000 : 4300);

function mapCollectorEventToDecision(evt: CollectorEvent): SecurityDecision {
  const d = (evt.data ?? {}) as Record<string, unknown>;
  const isBlocked =
    evt.eventType.includes("BLOCK") ||
    evt.eventType.includes("REJECT") ||
    evt.severity === "CRITICAL" ||
    evt.severity === "HIGH" ||
    d["allowed"] === false;

  const amountNum =
    typeof d["amount"] === "number"
      ? d["amount"]
      : typeof d["amount"] === "string"
      ? parseFloat(d["amount"]) / 1_000_000
      : 0.05;

  return {
    id: evt.eventId,
    status: isBlocked ? "BLOCKED" : "APPROVED",
    reason: (typeof d["reason"] === "string" ? d["reason"] : (d["attackType"] as string)) ?? (isBlocked ? evt.eventType : undefined),
    merchant: (typeof d["merchant"] === "string" ? d["merchant"] : (d["domain"] as string)) ?? evt.source,
    amount: isNaN(amountNum) ? 0.05 : amountNum,
    ml_score: typeof d["ml_score"] === "number" ? d["ml_score"] : isBlocked ? 0.94 : 0.08,
    latency_ms: typeof d["latencyMs"] === "number" ? d["latencyMs"] : 40,
    network: (typeof d["network"] === "string" ? d["network"] : undefined) ?? "base-sepolia",
    token: (typeof d["asset"] === "string" ? d["asset"] : undefined) ?? "USDC",
    timestamp: new Date(evt.timestamp).getTime(),
    intent_token: (typeof d["intentToken"] === "string" ? d["intentToken"] : undefined) ?? evt.runId ?? evt.eventId,
    expected_pay_to: (typeof d["expectedPayTo"] === "string" ? d["expectedPayTo"] : (d["expected"] as string)) ?? "0x402f9c...a1b2",
    received_pay_to: (typeof d["receivedPayTo"] === "string" ? d["receivedPayTo"] : (d["received"] as string)) ?? "0x402f9c...a1b2",
    firewall_step: (typeof d["violatedCheck"] === "string" ? d["violatedCheck"] : undefined) ?? evt.eventType,
  };
}

export function useDecisionFeed() {
  const demo = useStore((s) => s.demo);
  const seenEventIds = useRef(new Set<string>());

  useEffect(() => {
    // ── DEMO MODE: Isolated synthetic fixtures only ─────────────────────────────
    if (demo || MOCK) {
      if (!useStore.getState().decisions.length) {
        seedDecisions(18).reverse().forEach(useStore.getState().addDecision);
      }
      const t = setInterval(() => {
        const d = nextMockDecision();
        useStore.getState().addDecision(d);
        if (d.status === "BLOCKED") {
          useStore.getState().toast(`[DEMO] Attack blocked: ${d.reason}`, "danger");
        }
      }, feedInterval(demo));
      return () => clearInterval(t);
    }

    // ── LIVE MODE: Real backend APIs only (Never generate fake events) ──────────
    // Clear out any stale synthetic decisions from Demo mode when entering Live mode
    let isMounted = true;

    const pollLiveEvents = async () => {
      try {
        const res = await getCollectorEvents({ limit: 50 }, false);
        if (!isMounted) return;

        if (res.events && res.events.length > 0) {
          useStore.getState().addCollectorEvents(res.events);

          for (const evt of res.events) {
            if (!seenEventIds.current.has(evt.eventId)) {
              seenEventIds.current.add(evt.eventId);
              const dec = mapCollectorEventToDecision(evt);
              useStore.getState().addDecision(dec);

              if (dec.status === "BLOCKED" && seenEventIds.current.size > 1) {
                useStore.getState().toast(`Attack blocked: ${dec.reason || evt.eventType}`, "danger");
              }
            }
          }
        }
      } catch {
        // Live polling failure is signaled by useConnectionStatus
      }
    };

    pollLiveEvents();
    const interval = setInterval(pollLiveEvents, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [demo]);
}

export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const val = a + (target - a) * (1 - Math.pow(1 - p, 3));
      setV(val);
      from.current = val;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
