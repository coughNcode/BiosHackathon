import { Link, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, Brain, Copy, LayoutDashboard, Monitor, Moon, Sun, ScrollText, Settings, Shield, ShieldCheck, Swords, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useConnectionStatus, useDecisionFeed } from "@/hooks/use-live";
import { Addr, Chip, Dot } from "./ui";
import { DemoBar, useDemoShortcuts } from "./Demo";

const WALLET = "0x402f9c1e7a3b5d2e8c4a6f0d1b9e3c7aa1b2";
const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/feed", label: "Live Feed", icon: Activity },
  { to: "/lab", label: "Red/Blue Lab", icon: Swords },
  { to: "/ml", label: "ML Guard", icon: Brain },
  { to: "/policy", label: "Policy", icon: Shield },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
] as const;

const BOOT_S = 4 * 3600 + 32 * 60 + 17;

export function Shell({ children }: { children: ReactNode }) {
  useConnectionStatus();
  useDecisionFeed();
  useDemoShortcuts();
  const { demo, toggleDemo } = useStore();
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.classList.contains("light")), []);
  const toggleTheme = () => {
    const next = !light;
    document.documentElement.classList.toggle("light", next);
    document.documentElement.classList.toggle("dark", !next);
    localStorage.setItem("ws-theme", next ? "light" : "dark");
    setLight(next);
  };
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b bg-panel px-4">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <span className="neon-text font-bold tracking-tight">WalletShield</span>
          <span className="hidden text-xs text-muted-foreground md:inline">Zero Trust AI Payment Firewall</span>
        </div>
        <button
          onClick={() => { navigator.clipboard?.writeText(WALLET); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="flex items-center gap-2 rounded border bg-card px-3 py-1 font-mono text-xs hover:border-accent/50"
          title="Copy wallet address"
        >
          {copied ? "copied!" : <Addr text="0x402...a1b2" />} <Copy className="h-3 w-3 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <Chip tone="safe" className="px-2"><span className="relative inline-flex h-2 w-2"><span className="live-ring" /><span className="h-2 w-2 rounded-full bg-safe" /></span><span className="animate-blink">LIVE</span></Chip>
          <Chip tone="accent">Base Sepolia</Chip>
          <button onClick={toggleDemo} aria-pressed={demo} title={demo ? "Demo Mode on" : "Demo Mode off"} className={clsx("flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold transition", demo ? "border-accent bg-accent/15 text-accent shadow-[var(--glow)]" : "border-border text-muted-foreground hover:text-foreground")}>
            <Monitor className="h-3.5 w-3.5" />DEMO
          </button>
          <button onClick={toggleTheme} aria-pressed={light} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title={light ? "Switch to dark theme" : "Switch to light theme"} className={clsx("flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold transition", light ? "border-warn/60 bg-warn/10 text-warn" : "border-border text-muted-foreground hover:border-accent/50 hover:text-accent")}>
            {light ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}{light ? "DARK" : "LIGHT"}
          </button>
          <Settings className="ml-1 h-4 w-4 text-muted-foreground" />
        </div>
      </header>
      <Sidebar />
      <main className="cyber-grid pl-[220px] pt-14">
        <div className="mx-auto max-w-[1400px] p-6">{children}</div>
      </main>
      <Toasts />
      <DemoBar />
    </div>
  );
}

function Sidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { daemonOk, mlOk, demo } = useStore();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const up = BOOT_S + tick;
  const fmt = [Math.floor(up / 3600), Math.floor(up / 60) % 60, up % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <aside className="fixed bottom-0 left-0 top-14 z-20 flex w-[220px] flex-col border-r bg-panel">
      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map(({ to, label, icon: Icon }, i) => {
          const active = path === to;
          return (
            <Link key={to} to={to} className={clsx("flex items-center gap-3 rounded border-l-2 px-3 py-2 text-sm transition", active ? "nav-streak border-accent bg-accent/10 text-accent" : "border-transparent text-muted-foreground hover:bg-card hover:text-foreground")}>
              <Icon className="h-4 w-4" />{label}
              {demo && <kbd className="ml-auto rounded border px-1.5 font-mono text-[10px] text-muted-foreground">{i + 1}</kbd>}
            </Link>
          );
        })}
      </nav>
      {demo && (
        <div className="mx-3 rounded border border-accent/30 bg-accent/5 p-2.5 font-mono text-[10px] text-muted-foreground">
          <div className="mb-1.5 font-semibold tracking-widest text-accent">SHORTCUTS</div>
          {[["1-6", "jump to page"], ["Space", "fire attack"], ["R", "run benchmark"], ["M", "retrain ML"]].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-0.5"><kbd className="rounded border bg-card px-1.5 text-foreground">{k}</kbd>{v}</div>
          ))}
        </div>
      )}
      <div className="m-3 rounded border bg-card p-3">
        <div className="flex items-center gap-2 font-mono text-[11px] font-semibold text-safe"><Dot tone="safe" />FIREWALL ONLINE</div>
        <div className="mt-1 font-mono text-lg">{fmt}</div>
        <div className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
          {[["Daemon :4032", daemonOk], ["ML :4033", mlOk]].map(([l, ok]) => (
            <div key={l as string} className="flex items-center gap-2" title={ok ? "ONLINE" : "OFFLINE"}>
              <Dot tone={ok ? "safe" : "danger"} />{l as string}{!ok && <span className="text-danger">OFFLINE</span>}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Toasts() {
  const { toasts, dismiss } = useStore();
  const tone = { safe: "border-safe/50", danger: "border-danger/50", ml: "border-ml/50", accent: "border-accent/50" };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={clsx("animate-slide-in flex items-center justify-between rounded border bg-card px-3 py-2 font-mono text-xs shadow-lg", tone[t.tone])}>
          {t.text}
          <button onClick={() => dismiss(t.id)}><X className="h-3 w-3 text-muted-foreground" /></button>
        </div>
      ))}
    </div>
  );
}
