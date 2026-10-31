import { useEffect, useRef, useState } from "react";
import { getHealth, getMLHealth, MOCK } from "@/lib/api";
import { nextMockDecision, seedDecisions } from "@/lib/mock";
import { useStore } from "@/lib/store";

export function useConnectionStatus() {
  useEffect(() => {
    let prev = true;
    const check = async () => {
      const [d, m] = await Promise.all([
        getHealth().then(() => true, () => false),
        getMLHealth().then(() => true, () => false),
      ]);
      useStore.getState().setConn(d, m);
      if (prev && !d) useStore.getState().toast("Connection lost: daemon :4032", "danger");
      prev = d;
    };
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, []);
}

/** Live feed cadence: every 2s in Demo Mode so the feed always looks busy. */
export const feedInterval = (demo: boolean) => (demo ? 2000 : 4300);

export function useDecisionFeed() {
  const demo = useStore((s) => s.demo);
  useEffect(() => {
    if (!MOCK && !demo) return;
    if (!useStore.getState().decisions.length) seedDecisions(18).reverse().forEach(useStore.getState().addDecision);
    const t = setInterval(() => {
      const d = nextMockDecision();
      useStore.getState().addDecision(d);
      if (d.status === "BLOCKED") useStore.getState().toast(`Attack blocked: ${d.reason}`, "danger");
    }, feedInterval(demo));
    return () => clearInterval(t);
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
