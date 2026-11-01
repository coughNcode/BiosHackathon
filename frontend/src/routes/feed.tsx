import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { getCollectorEvents } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/use-live";
import { Addr, Btn, Chip, Dot, Json, PageTitle, ago, short } from "@/components/ws/ui";
import type { CollectorEvent, SecurityDecision } from "@/lib/types";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Live Feed — PayGuard AI" },
      { name: "description", content: "Real-time stream of evaluated security events across Blue, Red, and Collector." },
      { property: "og:title", content: "Live Feed — PayGuard AI" },
      { property: "og:description", content: "Real-time stream of firewall decisions and evaluation events." },
    ],
  }),
  component: LiveFeed,
});

const FILTERS = ["ALL", "BLOCKED", "APPROVED", "CRITICAL", "BLUE", "RED", "CHAIN"] as const;

function LiveFeed() {
  const { decisions, collectorEvents, clearDecisions, demo, services } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  // Combine real Collector events with decisions
  const items: Array<{
    id: string;
    timestamp: number;
    source: string;
    eventType: string;
    severity: string;
    isBlocked: boolean;
    merchant?: string;
    amount?: number;
    expectedPayTo?: string;
    receivedPayTo?: string;
    reason?: string;
    raw?: unknown;
  }> = [];

  if (collectorEvents.length > 0) {
    for (const evt of collectorEvents) {
      const d = (evt.data ?? {}) as Record<string, unknown>;
      const isBlocked =
        evt.eventType.includes("BLOCK") ||
        evt.eventType.includes("REJECT") ||
        evt.severity === "CRITICAL" ||
        evt.severity === "HIGH" ||
        d["allowed"] === false;

      const amt =
        typeof d["amount"] === "number"
          ? d["amount"]
          : typeof d["amount"] === "string"
          ? parseFloat(d["amount"]) / 1_000_000
          : undefined;

      items.push({
        id: evt.eventId,
        timestamp: new Date(evt.timestamp).getTime(),
        source: evt.source,
        eventType: evt.eventType,
        severity: evt.severity,
        isBlocked,
        merchant: (typeof d["merchant"] === "string" ? d["merchant"] : (d["domain"] as string)) ?? undefined,
        amount: amt,
        expectedPayTo: (typeof d["expectedPayTo"] === "string" ? d["expectedPayTo"] : (d["expected"] as string)) ?? undefined,
        receivedPayTo: (typeof d["receivedPayTo"] === "string" ? d["receivedPayTo"] : (d["received"] as string)) ?? undefined,
        reason: (typeof d["reason"] === "string" ? d["reason"] : (d["attackType"] as string)) ?? evt.message,
        raw: evt,
      });
    }
  } else {
    // In demo mode or if decisions exist, map decisions
    for (const d of decisions) {
      items.push({
        id: d.id,
        timestamp: d.timestamp,
        source: "BLUE",
        eventType: d.status === "BLOCKED" ? "POLICY_CHECK_REJECTED" : "POLICY_CHECK_APPROVED",
        severity: d.status === "BLOCKED" ? "HIGH" : "INFO",
        isBlocked: d.status === "BLOCKED",
        merchant: d.merchant,
        amount: d.amount,
        expectedPayTo: d.expected_pay_to,
        receivedPayTo: d.received_pay_to,
        reason: d.reason ?? d.firewall_step,
        raw: d,
      });
    }
  }

  // Filter items
  const filtered = items.filter((item) => {
    if (filter === "BLOCKED" && !item.isBlocked) return false;
    if (filter === "APPROVED" && item.isBlocked) return false;
    if (filter === "CRITICAL" && item.severity !== "CRITICAL" && item.severity !== "HIGH") return false;
    if (filter === "BLUE" && !item.source.toUpperCase().includes("BLUE")) return false;
    if (filter === "RED" && !item.source.toUpperCase().includes("RED")) return false;
    if (filter === "CHAIN" && !item.source.toUpperCase().includes("CHAIN")) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchText = `${item.id} ${item.source} ${item.eventType} ${item.reason ?? ""} ${item.merchant ?? ""}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  useEffect(() => {
    if (autoScroll && items.length > 0) {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [items.length, autoScroll]);

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Live Feed" sub="streaming security decisions & evaluation events" />
        <div className="flex items-center gap-2">
          {demo ? (
            <Chip tone="warn">SYNTHETIC DEMO FEED</Chip>
          ) : (
            <Chip tone={services.collector ? "safe" : "danger"}>
              <Dot tone={services.collector ? "safe" : "danger"} />
              COLLECTOR {services.collector ? "STREAM ONLINE" : "DISCONNECTED"} (:4050)
            </Chip>
          )}
        </div>
      </div>

      <div
        ref={topRef}
        className="sticky top-14 z-10 -mx-6 mb-4 flex flex-wrap items-center gap-2 border-b bg-background/90 px-6 py-3 backdrop-blur"
      >
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded border px-2.5 py-1 font-mono text-[11px] transition",
                filter === f ? "border-accent bg-accent/10 text-accent font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="ml-2 flex items-center gap-1.5 rounded border bg-card px-2 py-1 text-xs">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-32 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-accent"
          />{" "}
          Auto-scroll
        </label>

        <Btn tone="ghost" className="py-1" onClick={clearDecisions}>
          Clear
        </Btn>
        <span className="font-mono text-xs text-accent">
          {items.length} events buffered
        </span>
      </div>

      <div className="space-y-2">
        {filtered.map((item) => {
          const isBlocked = item.isBlocked;
          const tone = isBlocked ? "danger" : "safe";
          const isExpanded = expandedId === item.id;

          return (
            <article
              key={item.id}
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
              className={clsx(
                "card-cyber animate-slide-in cursor-pointer border-l-[3px] p-3 transition hover:border-accent/50",
                isBlocked ? "border-l-danger bg-danger/5" : "border-l-safe",
                isBlocked && "animate-flash-red",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <Chip tone={tone}>
                  {isBlocked ? <X className="h-3 w-3 text-danger" /> : <Dot tone="safe" />}
                  {isBlocked ? "BLOCKED" : "APPROVED"}
                </Chip>
                <Chip tone="accent">{item.source}</Chip>
                <span className="font-semibold text-foreground">{item.eventType}</span>
                {item.amount !== undefined && <span>{item.amount.toFixed(4)} USDC</span>}
                <Chip tone={item.severity === "CRITICAL" ? "danger" : item.severity === "HIGH" ? "warn" : "accent"}>
                  {item.severity}
                </Chip>
                <span className="ml-auto text-muted-foreground">
                  {ago(item.timestamp, now)} · {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div className="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
                {item.merchant && (
                  <div>
                    Merchant: <span className="text-foreground">{item.merchant}</span>
                  </div>
                )}
                {item.reason && (
                  <div>
                    Verdict Detail: <span className={isBlocked ? "text-danger" : "text-foreground"}>{item.reason}</span>
                  </div>
                )}
                {item.expectedPayTo && (
                  <div>
                    Expected PayTo: <Addr className="text-foreground" text={short(item.expectedPayTo, 8, 6)} />
                  </div>
                )}
                {item.receivedPayTo && (
                  <div>
                    Received PayTo:{" "}
                    <Addr
                      className={item.receivedPayTo !== item.expectedPayTo ? "text-danger" : "text-foreground"}
                      text={short(item.receivedPayTo, 8, 6)}
                    />
                  </div>
                )}
              </div>

              {isExpanded && item.raw && (
                <div className="mt-3 border-t border-border pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Event Payload Forensics</div>
                  <Json data={item.raw} />
                </div>
              )}
            </article>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded border border-dashed py-16 text-center font-mono text-xs text-muted-foreground">
            {!services.collector && !demo ? (
              <div className="space-y-2">
                <AlertTriangle className="mx-auto h-8 w-8 text-warn" />
                <p className="text-warn font-semibold">Collector service offline on port 4050</p>
                <p>Start Collector with `npm run collector` or switch to DEMO mode in header</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Activity className="mx-auto h-8 w-8 text-muted-foreground animate-pulse" />
                <p>Awaiting live security decisions from PayGuard AI services...</p>
                <p>Trigger an attack in the Red/Blue Lab to observe live event generation</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
