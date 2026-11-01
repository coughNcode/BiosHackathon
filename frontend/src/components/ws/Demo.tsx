import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export const DEMO_NAV = [
  "/",
  "/feed",
  "/lab",
  "/ml",
  "/policy",
  "/audit",
  "/inspector",
  "/adaptive",
] as const;

export const TALKING_POINTS: Record<string, string> = {
  "/": "PayGuard AI is a zero-trust payment firewall for autonomous AI agents. Every agent payment request passes strict deterministic checks before any private key signature can ever be executed.",
  "/feed": "Watch live payment telemetry and evaluations stream in real time. Decisions show exact cryptographic reasons, expected versus received payee addresses, and isolation latency.",
  "/lab": "Adversarial Red/Blue Lab firing live attack scenarios (A01-A10) against PayGuard AI. Every attack is scored for policy verdict, signer invocation, and mock chain fund safety.",
  "/ml": "Risk Analytics & Guard Telemetry inspecting multi-dimensional payment vectors, policy bounds, and UCB1 adaptive bandit exploration across adversarial mutation arms.",
  "/policy": "Deterministic policy enforcement: hard spending caps, daily allowances, approval thresholds, and trusted merchant registry queried directly from Blue Agent :4010.",
  "/audit": "Append-only verifiable audit log aggregating events across Blue Agent, Red Engine, and Collector with complete cryptographic provenance and evidence payloads.",
  "/inspector": "Payment Inspector providing deep forensics on selected attack runs: comparing expected vs received parameters, signer isolation status, and full event timelines.",
  "/adaptive": "Adaptive Intelligence inspecting the UCB1 multi-armed bandit algorithm orchestrating attack mutations and discovering optimal adversarial strategies against the firewall.",
};

export function useDemoShortcuts() {
  const demo = useStore((s) => s.demo);
  const navigate = useNavigate();
  useEffect(() => {
    if (!demo) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable=true]")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= DEMO_NAV.length) {
        navigate({ to: DEMO_NAV[n - 1]! });
        return;
      }
      const cmd =
        e.key === " " ? "fire" : e.key.toLowerCase() === "r" ? "bench" : e.key.toLowerCase() === "m" ? "retrain" : null;
      if (!cmd) return;
      e.preventDefault();
      if (location.pathname !== "/lab") navigate({ to: "/lab" });
      useStore.getState().sendLabCmd(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demo, navigate]);
}

export function DemoBar() {
  const { demo, demoBar, hideDemoBar } = useStore();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const text = TALKING_POINTS[path];
  if (!demo || !demoBar || !text) return null;
  return (
    <button
      onClick={hideDemoBar}
      title="Click to dismiss"
      className="demo-bar animate-slide-up fixed inset-x-0 bottom-0 z-40 border-t border-accent/40 px-8 py-4 text-left"
    >
      <div className="mx-auto flex max-w-5xl items-start gap-4">
        <span className="mt-1 shrink-0 rounded border border-warn bg-warn/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-warn">
          DEMO MODE
        </span>
        <p className="text-base leading-relaxed text-foreground">{text}</p>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">click to hide</span>
      </div>
    </button>
  );
}
