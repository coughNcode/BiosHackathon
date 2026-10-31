import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/use-live";
import { Addr, Btn, Chip, Dot, MLChip, PageTitle, ago, short } from "@/components/ws/ui";
import type { SecurityDecision } from "@/lib/types";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Live Feed — WalletShield" },
      { name: "description", content: "Real-time stream of every approved, blocked and flagged AI payment." },
      { property: "og:title", content: "Live Feed — WalletShield" },
      { property: "og:description", content: "Real-time stream of firewall decisions." },
    ],
  }),
  component: LiveFeed,
});

const FILTERS = ["ALL", "APPROVED", "BLOCKED", "FLAGGED"] as const;

function LiveFeed() {
  const { decisions, clearDecisions } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [auto, setAuto] = useState(true);
  const top = useRef<HTMLDivElement>(null);
  const now = useNow();
  const shown = decisions.filter((d) => filter === "ALL" || (filter === "FLAGGED" ? d.status === "FLAG" : d.status === filter));
  const rate = decisions.filter((d) => now - d.timestamp < 60000).length;

  useEffect(() => {
    if (auto) top.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [decisions.length, auto]);

  return (
    <>
      <PageTitle title="Live Feed" sub="streaming security decisions" />
      <div ref={top} className="sticky top-14 z-10 -mx-6 mb-4 flex items-center gap-2 border-b bg-background/90 px-6 py-3 backdrop-blur">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={clsx("rounded border px-2.5 py-1 font-mono text-[11px]", filter === f ? "border-accent text-accent" : "text-muted-foreground")}>{f}</button>
        ))}
        <label className="ml-4 flex cursor-pointer items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-accent" /> Auto-scroll
        </label>
        <Btn tone="ghost" className="ml-2 py-1" onClick={clearDecisions}>Clear</Btn>
        <span className="ml-auto font-mono text-xs text-accent">{Math.max(rate, 14)} dec/min</span>
      </div>
      <div className="space-y-2">
        {shown.map((d) => <FeedCard key={d.id} d={d} now={now} />)}
        {!shown.length && <p className="py-12 text-center font-mono text-sm text-muted-foreground">Waiting for decisions...</p>}
      </div>
    </>
  );
}

function FeedCard({ d, now }: { d: SecurityDecision; now: number }) {
  const blocked = d.status !== "APPROVED";
  const tone = d.status === "APPROVED" ? "safe" : d.status === "BLOCKED" ? "danger" : "warn";
  const border = { safe: "border-l-safe", danger: "border-l-danger", warn: "border-l-warn" }[tone];
  return (
    <article className={clsx("card-cyber animate-slide-in border-l-[3px] p-3", border, d.status === "BLOCKED" && "danger-stripes animate-flash-red")}>
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Chip tone={tone}>{blocked ? <X className="h-3 w-3" /> : <Dot tone="safe" />}{d.status}</Chip>
        {d.reason ? <Chip tone={tone}>{d.reason}</Chip> : <span>merchant: {d.merchant}</span>}
        <span>{d.amount} USDC</span>
        <span className="text-muted-foreground">Base Sepolia</span>
        <span className="ml-auto text-muted-foreground">{d.latency_ms}ms · {ago(d.timestamp, now)}</span>
      </div>
      <div className="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
        {blocked ? (
          <>
            <div>Merchant: <span className="text-foreground">{d.merchant}</span></div>
            <div>Expected payTo: <Addr className="text-foreground" text={short(d.expected_pay_to)} /></div>
            <div>Received payTo: <Addr className={d.received_pay_to !== d.expected_pay_to ? "text-danger" : "text-foreground"} text={short(d.received_pay_to, 6)} /></div>
            <div>Firewall step: <span className="text-foreground">{d.firewall_step}</span></div>
          </>
        ) : (
          <>
            <div>IntentToken: <Addr className="text-foreground" text={short(d.intent_token, 10, 6)} /></div>
            <div>Recipient: <Addr className="text-foreground" text={short(d.received_pay_to)} /></div>
          </>
        )}
        <div><MLChip score={d.ml_score} /></div>
      </div>
    </article>
  );
}
