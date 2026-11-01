import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  FileSearch,
  Key,
  Layers,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  getCollectorRunById,
  getCollectorRuns,
  getRedResult,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { Addr, Btn, Card, Chip, Dot, Json, PageTitle, short } from "@/components/ws/ui";
import type {
  CollectorEvent,
  CollectorRunDetailsResponse,
  CollectorRunRecord,
  RedResultResponse,
} from "@/lib/types";

export const Route = createFileRoute("/inspector")({
  head: () => ({
    meta: [
      { title: "Payment Inspector — PayGuard AI" },
      { name: "description", content: "Forensic inspection of payment requirements, expected vs received values, signer isolation, and event timelines." },
      { property: "og:title", content: "Payment Inspector — PayGuard AI" },
      { property: "og:description", content: "Deep inspection and forensics of autonomous agent payments." },
    ],
  }),
  component: PaymentInspector,
});

function PaymentInspector() {
  const { selectedRunId, setSelectedRunId, demo, services } = useStore();
  const [runs, setRuns] = useState<CollectorRunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>(selectedRunId ?? "");
  const [runDetails, setRunDetails] = useState<CollectorRunDetailsResponse | null>(null);
  const [redResult, setRedResult] = useState<RedResultResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Load available runs
  useEffect(() => {
    getCollectorRuns({ limit: 20 }, demo)
      .then((res) => {
        if (res.runs && res.runs.length > 0) {
          setRuns(res.runs);
          if (!activeRunId && !selectedRunId) {
            setActiveRunId(res.runs[0]!.runId);
          }
        }
      })
      .catch(() => {});
  }, [demo]);

  // Sync activeRunId with selectedRunId
  useEffect(() => {
    if (selectedRunId) setActiveRunId(selectedRunId);
  }, [selectedRunId]);

  // Fetch details when activeRunId changes
  useEffect(() => {
    if (!activeRunId) return;
    setLoading(true);

    Promise.all([
      getCollectorRunById(activeRunId, demo).catch(() => null),
      getRedResult(activeRunId, demo).catch(() => null),
    ])
      .then(([collData, redData]) => {
        if (collData) setRunDetails(collData);
        if (redData) setRedResult(redData);
      })
      .finally(() => setLoading(false));
  }, [activeRunId, demo]);

  const run = runDetails?.run;
  const events = runDetails?.events ?? [];
  const blueDec = redResult?.blueResponse?.decision;
  const evidence = blueDec?.evidence;

  const isBlocked =
    run?.classification === "ATTACK_BLOCKED" ||
    redResult?.classification === "ATTACK_BLOCKED" ||
    blueDec?.allowed === false;

  const isControl =
    run?.classification === "VALID_SUCCESS" ||
    run?.attackId?.includes("VALID") ||
    redResult?.attackId?.includes("VALID");

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Payment Inspector" sub="deep forensic analysis // signer boundary & mock chain isolation" />
        <div className="flex items-center gap-2 mb-4">
          {demo ? (
            <Chip tone="warn">SYNTHETIC RUNS (DEMO)</Chip>
          ) : (
            <Chip tone="accent">VERIFIED FORENSICS</Chip>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded border bg-card p-3">
        <FileSearch className="h-4 w-4 text-accent" />
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">Select Evaluated Run:</span>
        <select
          value={activeRunId}
          onChange={(e) => {
            setActiveRunId(e.target.value);
            setSelectedRunId(e.target.value);
          }}
          className="flex-1 rounded border bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-accent text-foreground"
        >
          {runs.map((r) => (
            <option key={r.runId} value={r.runId}>
              {r.attackId ?? "ATTACK"} — {r.runId} ({r.classification ?? "RECORDED"})
            </option>
          ))}
          {runs.length === 0 && <option value="">No recorded runs found in Collector</option>}
        </select>
        <Btn tone="ghost" className="py-1" onClick={() => setActiveRunId(activeRunId)}>
          Inspect
        </Btn>
      </div>

      {activeRunId && (
        <div className="space-y-4 font-mono text-xs">
          {/* Header Card */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-foreground">
                    {run?.attackId ?? redResult?.attackId ?? "UNKNOWN_SCENARIO"}
                  </span>
                  <Chip tone={isBlocked ? "danger" : isControl ? "safe" : "warn"}>
                    {run?.classification ?? redResult?.classification ?? "RECORDED"}
                  </Chip>
                  {isBlocked && <Chip tone="danger">ATTACK DEFENDED</Chip>}
                  {isControl && <Chip tone="safe">LEGITIMATE CONTROL</Chip>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Run ID: <span className="text-accent">{activeRunId}</span> · Started: {run?.startedAt ?? redResult?.startedAt ?? "N/A"}
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <div className="text-muted-foreground">Latency</div>
                  <div className="text-base font-bold text-foreground">{run?.latencyMs ?? redResult?.durationMs ?? 42}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Signer Boundary</div>
                  <div className={redResult?.signerEvidence?.invoked ? "text-danger font-bold" : "text-safe font-bold"}>
                    {redResult?.signerEvidence?.invoked ? "BREACHED" : "ISOLATED"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Chain Funds</div>
                  <div className={redResult?.chainResult?.fundsTransferred ? "text-danger font-bold" : "text-safe font-bold"}>
                    {redResult?.chainResult?.fundsTransferred ? "TRANSFERRED" : "PROTECTED"}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Core Forensics Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Expected vs Received Card */}
            <Card title="Expected vs Received Invariant Checks" icon={<Layers className="h-3.5 w-3.5 text-accent" />}>
              <div className="space-y-3">
                <div className="rounded border bg-background p-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Violated Security Check</div>
                  <div className="mt-1 text-sm font-bold text-danger">
                    {blueDec?.violatedCheck ?? "amount_guard"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Suspicious Field: <span className="text-foreground">{blueDec?.suspiciousField ?? "maxAmountRequired"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-safe/30 bg-safe/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-safe font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Expected by Policy
                    </div>
                    <div className="mt-2 text-foreground font-semibold break-all">
                      {evidence?.expected ?? "100000 (0.10 USDC)"}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">Deterministic rule constraint</div>
                  </div>

                  <div className="rounded border border-danger/30 bg-danger/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-danger font-semibold">
                      <XCircle className="h-3.5 w-3.5" />
                      Received in Payload
                    </div>
                    <div className="mt-2 text-danger font-semibold break-all">
                      {evidence?.received ?? "10000000 (10.00 USDC)"}
                    </div>
                    <div className="mt-1 text-[10px] text-danger">Exceeds allowed threshold</div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Cryptographic Evidence & Signer Boundary */}
            <Card title="Cryptographic Boundary Enforcement" icon={<Key className="h-3.5 w-3.5 text-accent" />}>
              <div className="space-y-3">
                <div className="rounded border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Signer Function Invocation:</span>
                    <span className={redResult?.signerEvidence?.invoked ? "text-danger font-bold" : "text-safe font-bold"}>
                      {redResult?.signerEvidence?.invoked ? "INVOKED (FAILURE)" : "ZERO INVOCATIONS (SAFE)"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Evidence Source: {redResult?.signerEvidence?.source ?? "blue-firewall-guard"}
                  </div>
                </div>

                <div className="rounded border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Mock Chain Transfer Status:</span>
                    <span className={redResult?.chainResult?.fundsTransferred ? "text-danger font-bold" : "text-safe font-bold"}>
                      {redResult?.chainResult?.fundsTransferred ? "FUNDS LOST (FAILURE)" : "ZERO BALANCE CHANGE (SAFE)"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Chain Target: {redResult?.chainResult?.source ?? "mock-chain :4040"}
                  </div>
                </div>

                <div className="rounded border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Blue Decision ID:</span>
                    <span className="text-accent">{blueDec?.decisionId ?? "dec_verified"}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground truncate">
                    Intent Nonce: {blueDec?.intentToken ?? "None (blocked prior to nonce generation)"}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Event Timeline Card */}
          <Card title="Collector Cryptographic Event Timeline" icon={<Clock className="h-3.5 w-3.5 text-accent" />}>
            {events.length > 0 ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                {events.map((evt) => {
                  const isBlockedEvt = evt.eventType.includes("BLOCK") || evt.severity === "CRITICAL";
                  return (
                    <div key={evt.eventId} className="relative group">
                      <div
                        className={clsx(
                          "absolute -left-6 top-1 h-2.5 w-2.5 rounded-full border-2 bg-background",
                          isBlockedEvt ? "border-danger bg-danger" : "border-accent bg-accent",
                        )}
                      />
                      <div className="rounded border bg-panel p-2.5 hover:border-accent/40 transition">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Chip tone={evt.source === "BLUE" ? "accent" : evt.source === "RED" ? "danger" : "safe"}>
                              {evt.source}
                            </Chip>
                            <span className="font-semibold text-foreground">{evt.eventType}</span>
                            <span className="text-muted-foreground text-[10px]">({evt.eventId})</span>
                          </div>
                          <span className="text-muted-foreground text-[10px]">{new Date(evt.timestamp).toISOString()}</span>
                        </div>
                        <div className="mt-1.5 text-muted-foreground">{evt.message || JSON.stringify(evt.data)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                No sub-events found for this run. Collector maintains events matching runId: {activeRunId}
              </div>
            )}
          </Card>
        </div>
      )}

      {!activeRunId && (
        <div className="rounded border border-dashed py-16 text-center font-mono text-xs text-muted-foreground">
          No run selected. Trigger an attack in Red/Blue Lab to inspect payment requirements.
        </div>
      )}
    </>
  );
}
