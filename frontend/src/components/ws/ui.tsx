import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import type { DecisionStatus, SecurityDecision } from "@/lib/types";
import { useCountUp } from "@/hooks/use-live";

export function Addr({ text, className }: { text: string; className?: string }) {
  return (
    <span className={clsx("typewriter font-mono", className)} style={{ "--n": text.length } as React.CSSProperties} title={text}>
      {text}
    </span>
  );
}

export const short = (a: string, h = 5, t = 4) => (a.length > h + t ? `${a.slice(0, h)}...${a.slice(-t)}` : a);
export const ago = (ts: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
export const scoreTone = (s: number) => (s >= 0.85 ? "danger" : s >= 0.6 ? "warn" : "safe");

const toneText = { safe: "text-safe", danger: "text-danger", warn: "text-warn", ml: "text-ml", accent: "text-accent", muted: "text-muted-foreground" } as const;
const toneChip = {
  safe: "text-safe border-safe/40 bg-safe/10",
  danger: "text-danger border-danger/40 bg-danger/10",
  warn: "text-warn border-warn/40 bg-warn/10",
  ml: "text-ml border-ml/40 bg-ml/10",
  accent: "text-accent border-accent/40 bg-accent/10",
  muted: "text-muted-foreground border-border bg-panel",
} as const;
export type Tone = keyof typeof toneChip;

export function Chip({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide", toneChip[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse = true }: { tone: Tone; pulse?: boolean }) {
  return <span className={clsx("inline-block h-1.5 w-1.5 rounded-full bg-current", toneText[tone], pulse && "animate-pulse-dot")} />;
}

const statusTone: Record<DecisionStatus, Tone> = { APPROVED: "safe", BLOCKED: "danger", FLAG: "warn" };
export function StatusChip({ status }: { status: DecisionStatus }) {
  const Icon = status === "APPROVED" ? Check : status === "BLOCKED" ? X : AlertTriangle;
  return (
    <Chip tone={statusTone[status]}>
      <Dot tone={statusTone[status]} />
      <Icon className="h-3 w-3" />
      {status}
    </Chip>
  );
}

export function MLChip({ score }: { score: number }) {
  return <Chip tone={scoreTone(score)}>ML {score.toFixed(2)}</Chip>;
}

export function Card({ children, className, title, icon, right }: { children: ReactNode; className?: string; title?: string; icon?: ReactNode; right?: ReactNode }) {
  return (
    <section className={clsx("card-cyber p-4", className)}>
      {title && (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {icon}
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function KPICard({ label, value, tone, icon, format = (n) => Math.round(n).toString(), children }: { label: string; value: number; tone: Tone; icon: ReactNode; format?: (n: number) => string; children?: ReactNode }) {
  const v = useCountUp(value);
  return (
    <Card>
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className={toneText[tone]}>{icon}</span>
      </div>
      <div className={clsx("mt-3 font-mono text-3xl font-semibold", toneText[tone])}>{format(v)}</div>
      {children}
    </Card>
  );
}

export function Json({ data }: { data: unknown }) {
  const json = JSON.stringify(data, null, 2);
  const parts = json.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|true|false|null)/g);
  return (
    <pre className="overflow-x-auto rounded border bg-background p-3 font-mono text-[11px] leading-relaxed">
      {parts.map((p, i) => {
        if (!p) return null;
        const cls = /^".*:$/.test(p) ? "text-accent" : p.startsWith('"') ? "text-safe" : /^(true|false|null)$/.test(p) ? "text-ml" : /^-?\d/.test(p) ? "text-warn" : "text-muted-foreground";
        return <span key={i} className={cls}>{p}</span>;
      })}
    </pre>
  );
}

export function DecisionRow({ d, now }: { d: SecurityDecision; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-panel">
        <span className="w-28 shrink-0"><StatusChip status={d.status} /></span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{d.merchant}</span>
        <span className="w-16 font-mono text-sm">${d.amount.toFixed(3)}</span>
        <span className={clsx("w-40 truncate font-mono text-[11px]", d.status === "FLAG" ? "text-warn" : "text-danger")}>{d.reason ?? ""}</span>
        <span className="w-14 text-right font-mono text-[11px] text-muted-foreground">{ago(d.timestamp, now)}</span>
        <MLChip score={d.ml_score} />
      </button>
      {open && <div className="pb-3"><Json data={d} /></div>}
    </div>
  );
}

export function Btn({ tone = "accent", children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "accent" | "danger" | "ml" | "ghost" }) {
  const t = {
    accent: "border-accent/50 text-accent hover:bg-accent/10",
    danger: "border-danger/60 text-danger hover:bg-danger/10",
    ml: "border-transparent bg-gradient-ml text-foreground hover:opacity-90",
    ghost: "border-border text-muted-foreground hover:text-foreground",
  }[tone];
  return (
    <button {...p} className={clsx("inline-flex items-center justify-center gap-2 rounded border px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40", t, className)}>
      {children}
    </button>
  );
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "ml" }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded bg-background">
      <div className={clsx("h-full transition-all duration-300", tone === "ml" ? "bg-gradient-ml" : "bg-accent")} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="font-mono text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
