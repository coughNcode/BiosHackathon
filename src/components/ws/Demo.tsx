import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export const DEMO_NAV = ["/", "/feed", "/lab", "/ml", "/policy", "/audit"] as const;

export const TALKING_POINTS: Record<string, string> = {
  "/": "WalletShield is a zero-trust firewall for AI autonomous payments. Every payment an AI agent attempts passes through 7 security checks before any wallet signature occurs.",
  "/feed": "Watch payment decisions in real time. Green = approved and settled on Base Sepolia. Red = blocked before signing. The ML score on each card comes from our adaptive XGBoost anomaly detector.",
  "/lab": "We're firing 10 adversarial attack scenarios against our own firewall -- every attack targets a gap the base x402 repository leaves completely open.",
  "/ml": "After the Red Team benchmark, we retrained XGBoost on the attack corpus. It now detects novel variants that pass all 6 deterministic rules. Risk score 0.94 on the mutated attack -- blocked.",
  "/policy": "All blocks are deterministic. No LLM, no probability -- every SecurityDecision shows the specific field that failed, the expected value, and the received value.",
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
      if (n >= 1 && n <= 6) { navigate({ to: DEMO_NAV[n - 1]! }); return; }
      const cmd = e.key === " " ? "fire" : e.key.toLowerCase() === "r" ? "bench" : e.key.toLowerCase() === "m" ? "retrain" : null;
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
    <button onClick={hideDemoBar} title="Click to dismiss" className="demo-bar animate-slide-up fixed inset-x-0 bottom-0 z-40 border-t border-accent/40 px-8 py-4 text-left">
      <div className="mx-auto flex max-w-5xl items-start gap-4">
        <span className="mt-1 shrink-0 rounded border border-accent/50 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-accent">DEMO</span>
        <p className="text-base leading-relaxed text-foreground">{text}</p>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">click to hide</span>
      </div>
    </button>
  );
}
