import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { getCollectorAuditLog, getLedger } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Addr, Btn, Card, Chip, Json, PageTitle, StatusChip, short } from "@/components/ws/ui";
import type { CollectorEvent, SecurityDecision } from "@/lib/types";

const PAGE_SIZE = 15;

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — PayGuard AI" },
      { name: "description", content: "Searchable, verifiable cryptographic audit log of all payment decisions." },
      { property: "og:title", content: "Audit Log — PayGuard AI" },
      { property: "og:description", content: "Verifiable security decision ledger from Collector :4050." },
    ],
  }),
  component: Audit,
});

function Audit() {
  const { demo, services } = useStore();
  const [events, setEvents] = useState<CollectorEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Demo fallback decisions
  const [demoDecisions, setDemoDecisions] = useState<SecurityDecision[]>([]);

  const fetchAuditLog = async () => {
    setLoading(true);
    try {
      if (demo) {
        const d = await getLedger(true);
        setDemoDecisions(d);
        setTotal(d.length);
        return;
      }

      const res = await getCollectorAuditLog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }, false);
      if (res && Array.isArray(res.events)) {
        setEvents(res.events);
        setTotal(res.total ?? res.events.length);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLog();
  }, [demo, page]);

  // Client search filter
  const q = search.toLowerCase().trim();
  const filteredEvents = events.filter((e) => {
    if (!q) return true;
    const body = `${e.eventId} ${e.source} ${e.eventType} ${e.attackId ?? ""} ${e.runId ?? ""} ${e.message} ${JSON.stringify(e.data)}`.toLowerCase();
    return body.includes(q);
  });

  const filteredDemo = demoDecisions.filter((d) => {
    if (!q) return true;
    return `${d.id} ${d.merchant} ${d.status} ${d.reason ?? ""}`.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportCsv = () => {
    if (demo) {
      const head = "timestamp,merchant,amount,decision,reason,intent_token";
      const body = filteredDemo.map((d) =>
        [new Date(d.timestamp).toISOString(), d.merchant, d.amount, d.status, d.reason ?? "", d.intent_token].join(","),
      );
      const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
      Object.assign(document.createElement("a"), { href: url, download: "payguard-demo-audit.csv" }).click();
      URL.revokeObjectURL(url);
      return;
    }

    const head = "eventId,timestamp,source,eventType,severity,runId,attackId,message,data";
    const body = filteredEvents.map((e) =>
      [
        e.eventId,
        e.timestamp,
        e.source,
        e.eventType,
        e.severity,
        e.runId ?? "",
        e.attackId ?? "",
        `"${(e.message ?? "").replace(/"/g, '""')}"`,
        `"${JSON.stringify(e.data ?? {}).replace(/"/g, '""')}"`,
      ].join(","),
    );
    const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "payguard-audit-log.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Audit Log" sub="append-only cryptographic audit stream // Collector GET /audit-log" />
        <div className="flex items-center gap-2 mb-4">
          {demo ? (
            <Chip tone="warn">DEMO AUDIT LOG</Chip>
          ) : (
            <Chip tone={services.collector ? "safe" : "danger"}>
              COLLECTOR {services.collector ? "AUDIT ONLINE" : "OFFLINE"} (:4050)
            </Chip>
          )}
        </div>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded border bg-background px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search eventId, source, eventType, runId, payload..."
              className="w-full bg-transparent py-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Btn tone="ghost" onClick={fetchAuditLog} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Btn>
          <Btn onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Btn>
        </div>

        {demo ? (
          // Demo mode display table
          <table className="w-full font-mono text-[11px]">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">Timestamp</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>Intent Token</th>
              </tr>
            </thead>
            <tbody>
              {filteredDemo.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((d) => (
                <tr key={d.id} className="border-b hover:bg-panel">
                  <td className="py-2 text-muted-foreground">{new Date(d.timestamp).toLocaleTimeString()}</td>
                  <td className="font-semibold">{d.merchant}</td>
                  <td>${d.amount.toFixed(3)}</td>
                  <td>
                    <StatusChip status={d.status} />
                  </td>
                  <td className={d.status === "BLOCKED" ? "text-danger" : "text-muted-foreground"}>{d.reason ?? "VERIFIED"}</td>
                  <td>
                    <Addr className="text-muted-foreground" text={short(d.intent_token, 8, 4)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // Real Live Collector audit log table
          <table className="w-full font-mono text-[11px]">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">Timestamp</th>
                <th>Source</th>
                <th>Event Type</th>
                <th>Severity</th>
                <th>Run / Attack ID</th>
                <th>Message & Summary</th>
                <th className="text-right">Forensics</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((e) => {
                const isBlocked = e.eventType.includes("BLOCK") || e.severity === "CRITICAL" || e.severity === "HIGH";
                const isOpen = openId === e.eventId;

                return (
                  <Fragment key={e.eventId}>
                    <tr
                      onClick={() => setOpenId(isOpen ? null : e.eventId)}
                      className="cursor-pointer border-b hover:bg-panel transition"
                    >
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </td>
                      <td>
                        <Chip tone={e.source === "BLUE" ? "accent" : e.source === "RED" ? "danger" : "safe"}>
                          {e.source}
                        </Chip>
                      </td>
                      <td className="font-semibold text-foreground">{e.eventType}</td>
                      <td>
                        <Chip tone={isBlocked ? "danger" : "safe"} className="text-[10px]">
                          {e.severity}
                        </Chip>
                      </td>
                      <td className="text-muted-foreground">
                        {e.attackId ?? (e.runId ? short(e.runId, 10, 4) : "—")}
                      </td>
                      <td className="truncate max-w-[300px] text-muted-foreground" title={e.message}>
                        {e.message || JSON.stringify(e.data)}
                      </td>
                      <td className="text-right text-accent">{isOpen ? "Hide ▲" : "View ▼"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="bg-panel/60 p-3">
                          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-accent">
                            <span>Event ID: {e.eventId}</span>
                            <span>Received: {new Date(e.receivedAt).toISOString()}</span>
                          </div>
                          <Json data={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    {loading ? "Loading live audit events..." : "No events recorded in Collector audit database yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>Total records: {total}</span>
          <div className="flex items-center gap-2">
            <Btn tone="ghost" className="py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Prev
            </Btn>
            <span>
              {page + 1} / {totalPages}
            </span>
            <Btn tone="ghost" className="py-1" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              Next
            </Btn>
          </div>
        </div>
      </Card>
    </>
  );
}
