import { create } from "zustand";
import type { BenchmarkRow, SecurityDecision } from "./types";

interface Toast { id: number; text: string; tone: "safe" | "danger" | "ml" | "accent" }

interface Store {
  decisions: SecurityDecision[];
  daemonOk: boolean;
  mlOk: boolean;
  mlPhase: "WARM" | "HOT";
  lastRetrain: number | null;
  benchmark: BenchmarkRow[];
  toasts: Toast[];
  demo: boolean;
  demoBar: boolean;
  labCmd: "fire" | "bench" | "retrain" | null;
  toggleDemo: () => void;
  hideDemoBar: () => void;
  sendLabCmd: (c: "fire" | "bench" | "retrain" | null) => void;
  addDecision: (d: SecurityDecision) => void;
  clearDecisions: () => void;
  setConn: (daemonOk: boolean, mlOk: boolean) => void;
  setBenchmark: (rows: BenchmarkRow[]) => void;
  setHot: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let tid = 0;
export const useStore = create<Store>((set, get) => ({
  decisions: [],
  daemonOk: true,
  mlOk: true,
  mlPhase: "WARM",
  lastRetrain: null,
  benchmark: [],
  toasts: [],
  demo: false,
  demoBar: true,
  labCmd: null,
  toggleDemo: () => set((s) => ({ demo: !s.demo, demoBar: true })),
  hideDemoBar: () => set({ demoBar: false }),
  sendLabCmd: (labCmd) => set({ labCmd }),
  addDecision: (d) => set((s) => ({ decisions: [d, ...s.decisions].slice(0, 300) })),
  clearDecisions: () => set({ decisions: [] }),
  setConn: (daemonOk, mlOk) => set({ daemonOk, mlOk }),
  setBenchmark: (benchmark) => set({ benchmark }),
  setHot: () => set({ mlPhase: "HOT", lastRetrain: Date.now() }),
  toast: (text, tone = "accent") => {
    const id = ++tid;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
