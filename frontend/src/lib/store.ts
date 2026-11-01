import { create } from "zustand";
import type { BenchmarkRow, CollectorEvent, SecurityDecision } from "./types";

interface Toast {
  id: number;
  text: string;
  tone: "safe" | "danger" | "ml" | "accent" | "warn";
}

export type ServiceHealthState = "Connected" | "Disconnected" | "Checking" | "Error";

export interface SixServicesStatus {
  blue: ServiceHealthState;
  chain: ServiceHealthState;
  merchant: ServiceHealthState;
  facilitator: ServiceHealthState;
  console: ServiceHealthState;
  collector: ServiceHealthState;
}

interface Store {
  decisions: SecurityDecision[];
  collectorEvents: CollectorEvent[];
  services: SixServicesStatus;
  daemonOk: boolean; // mapped to services.blue === "Connected"
  mlOk: boolean;     // mapped to services.collector === "Connected"
  mlPhase: "WARM" | "HOT";
  lastRetrain: number | null;
  benchmark: BenchmarkRow[];
  toasts: Toast[];
  demo: boolean;
  demoBar: boolean;
  labCmd: "fire" | "bench" | "retrain" | null;
  selectedRunId: string | null;

  toggleDemo: () => void;
  setDemo: (demo: boolean) => void;
  hideDemoBar: () => void;
  sendLabCmd: (c: "fire" | "bench" | "retrain" | null) => void;
  addDecision: (d: SecurityDecision) => void;
  setDecisions: (decisions: SecurityDecision[]) => void;
  clearDecisions: () => void;
  addCollectorEvents: (events: CollectorEvent[]) => void;
  setSixServicesConn: (statuses: Partial<SixServicesStatus>) => void;
  setServicesConn: (blue: boolean, red: boolean, collector: boolean, chain: boolean) => void;
  setConn: (daemonOk: boolean, mlOk: boolean) => void;
  setBenchmark: (rows: BenchmarkRow[]) => void;
  setHot: () => void;
  setSelectedRunId: (id: string | null) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let tid = 0;
export const useStore = create<Store>((set, get) => ({
  decisions: [],
  collectorEvents: [],
  services: {
    blue: "Connected",
    chain: "Connected",
    merchant: "Connected",
    facilitator: "Connected",
    console: "Connected",
    collector: "Connected",
  },
  daemonOk: true,
  mlOk: true,
  mlPhase: "WARM",
  lastRetrain: null,
  benchmark: [],
  toasts: [],
  demo: false,
  demoBar: true,
  labCmd: null,
  selectedRunId: null,

  toggleDemo: () => set((s) => ({ demo: !s.demo, demoBar: true })),
  setDemo: (demo) => set({ demo, demoBar: true }),
  hideDemoBar: () => set({ demoBar: false }),
  sendLabCmd: (labCmd) => set({ labCmd }),
  addDecision: (d) =>
    set((s) => {
      // Deduplicate by ID
      if (s.decisions.some((x) => x.id === d.id)) return s;
      return { decisions: [d, ...s.decisions].slice(0, 300) };
    }),
  setDecisions: (decisions) => set({ decisions }),
  clearDecisions: () => set({ decisions: [], collectorEvents: [] }),
  addCollectorEvents: (newEvents) =>
    set((s) => {
      const existing = new Set(s.collectorEvents.map((e) => e.eventId));
      const fresh = newEvents.filter((e) => !existing.has(e.eventId));
      if (!fresh.length) return s;
      return { collectorEvents: [...fresh, ...s.collectorEvents].slice(0, 500) };
    }),
  setSixServicesConn: (statuses) =>
    set((s) => {
      const updated = { ...s.services, ...statuses };
      return {
        services: updated,
        daemonOk: updated.blue === "Connected",
        mlOk: updated.collector === "Connected",
      };
    }),
  setServicesConn: (blue, red, collector, chain) =>
    set((s) => ({
      services: {
        ...s.services,
        blue: blue ? "Connected" : "Disconnected",
        console: red ? "Connected" : "Disconnected",
        collector: collector ? "Connected" : "Disconnected",
        chain: chain ? "Connected" : "Disconnected",
      },
      daemonOk: blue,
      mlOk: collector,
    })),
  setConn: (daemonOk, mlOk) =>
    set((s) => ({
      daemonOk,
      mlOk,
      services: {
        ...s.services,
        blue: daemonOk ? "Connected" : "Disconnected",
        collector: mlOk ? "Connected" : "Disconnected",
      },
    })),
  setBenchmark: (benchmark) => set({ benchmark }),
  setHot: () => set({ mlPhase: "HOT", lastRetrain: Date.now() }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  toast: (text, tone = "accent") => {
    const id = ++tid;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
