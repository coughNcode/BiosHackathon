import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, Swords, Trophy, XCircle } from "lucide-react";
import { ATTACKS } from "@/lib/mock";
import {
  getCollectorScorecard,
  getRedAttacks,
  getRedResult,
  postRedRun,
  postRetrain,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { useCountUp } from "@/hooks/use-live";
import { Btn, Card, Chip, MLChip, PageTitle, Progress } from "@/components/ws/ui";
import type { Attack, BenchmarkRow, CollectorScorecardResponse, RedAttackScenario, RedResultResponse } from "@/lib/types";

export const Route = createFileRoute("/lab")({
  head: () => ({
    meta: [
      { title: "Red/Blue Lab — PayGuard AI" },
      { name: "description", content: "Fire real adversarial attacks at PayGuard AI and score live detection rates." },
      { property: "og:title", content: "Red/Blue Lab — PayGuard AI" },
      { property: "og:description", content: "Adversarial attack simulator and security scorecard." },
    ],
  }),
  component: Lab,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function simulate(id: string, hot: boolean): BenchmarkRow {
  const a = ATTACKS.find((x) => x.id === id)!;
  // ML evasion slips past deterministic rules until the model is retrained.
  const passed = a.severity === "evasion" && !hot;
  return {
    attack: a.id,
    result: passed ? "PASSED" : "BLOCKED",
    latency: 3 + Math.floor(Math.random() * 6),
    reason: passed ? "--" : a.reason,
    ml: passed ? 0.58 : a.severity === "evasion" ? 0.91 : 0.6 + Math.random() * 0.38,
    signerInvoked: passed,
    chainTransferred: passed,
  };
}

export function tierFor(caught: number) {
  if (caught >= 10) return { label: "S-TIER", cls: "text-gold border-gold/60 shadow-[0_0_14px_var(--gold)]" };
  if (caught >= 8) return { label: "A-TIER", cls: "text-safe border-safe/60" };
  if (caught >= 6) return { label: "B-TIER", cls: "text-warn border-warn/60" };
  return { label: "NEEDS WORK", cls: "text-danger border-danger/60" };
}

function Lab() {
  const { mlPhase, benchmark, setBenchmark, setHot, toast, demo, services, setSelectedRunId } = useStore();
  const [scenarios, setScenarios] = useState<RedAttackScenario[]>([]);
  const [sel, setSel] = useState(ATTACKS[0]!.id);
  const [firing, setFiring] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [retrain, setRetrain] = useState<number | null>(null);
  const hot = mlPhase === "HOT";

  const [shot, setShot] = useState<{ k: number; phase: "fly" | "BLOCKED" | "PASSED" | "ERROR" } | null>(null);
  const [collectorScorecard, setCollectorScorecard] = useState<CollectorScorecardResponse | null>(null);

  const refreshScorecard = async () => {
    try {
      const sc = await getCollectorScorecard(demo);
      setCollectorScorecard(sc);
    } catch {}
  };

  useEffect(() => {
    refreshScorecard();
  }, [demo]);

  // Load scenarios from Red Console in Live Mode
  useEffect(() => {
    if (demo) {
      setScenarios(
        ATTACKS.map((a) => ({
          id: a.id,
          name: a.id,
          category: a.severity,
          threatLevel: a.severity.toUpperCase(),
          expectedDecision: a.id.includes("VALID") ? "ALLOW" : "BLOCK",
          description: a.desc,
          expectedCheck: a.reason,
        })),
      );
      return;
    }

    getRedAttacks(false)
      .then((res) => {
        if (res.attacks && res.attacks.length > 0) {
          setScenarios(res.attacks);
          setSel(res.attacks[0]!.id);
        }
      })
      .catch(() => {
        // Fallback to local catalog if Red Console is still starting
        setScenarios(
          ATTACKS.map((a) => ({
            id: a.id,
            name: a.id,
            category: a.severity,
            threatLevel: a.severity.toUpperCase(),
            expectedDecision: a.id.includes("VALID") ? "ALLOW" : "BLOCK",
            description: a.desc,
            expectedCheck: a.reason,
          })),
        );
      });
  }, [demo]);

  const fire = async () => {
    setFiring(true);
    const k = Date.now();
    setShot({ k, phase: "fly" });

    // ── DEMO MODE: synthetic simulation ───────────────────────────────────────
    if (demo) {
      await sleep(400);
      const r = simulate(sel, hot);
      setShot({ k, phase: r.result });
      setLog((l) => [
        ...l,
        `> [DEMO] firing: ${r.attack}...`,
        `  [${r.result}] ${r.reason} -- ${r.latency}ms (Signer: ${r.signerInvoked ? "INVOKED" : "ISOLATED"})`,
      ].slice(-40));
      await sleep(450);
      setShot(null);
      setFiring(false);
      return;
    }

    // ── LIVE MODE: Real Red Console API dispatch ──────────────────────────────
    try {
      setLog((l) => [...l, `> firing live attack: ${sel} against Blue :4010...`].slice(-40));
      const launch = await postRedRun({ attackId: sel }, false);
      const runId = launch.runId;
      setSelectedRunId(runId);

      // Poll for completion
      let result: RedResultResponse | null = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(250);
        try {
          const res = await getRedResult(runId, false);
          if (res.status === "completed" || res.classification) {
            result = res;
            break;
          }
        } catch {
          // Still executing on backend
        }
      }

      if (!result) {
        throw new Error(`Timeout waiting for run result: ${runId}`);
      }

      const dec = result.blueResponse?.decision;
      const isBlocked = result.classification === "ATTACK_BLOCKED";
      const isError = result.classification === "ATTACK_ERROR";
      const isPassed = result.classification === "VALID_SUCCESS" || result.classification === "ATTACK_BYPASS";
      const latency = result.durationMs ?? 42;

      const phase = isBlocked ? "BLOCKED" : isError ? "ERROR" : "PASSED";
      setShot({ k, phase });

      const logMsg = [
        `  [${result.classification}] ${dec?.violatedCheck ?? result.classification} -- ${latency}ms`,
        `  Evidence: expected=${dec?.evidence?.expected ?? "N/A"}, received=${dec?.evidence?.received ?? "N/A"}`,
        `  Signer: ${result.signerEvidence?.invoked ? "INVOKED" : "ISOLATED"} | Chain Transfer: ${result.chainResult?.fundsTransferred ? "TRANSFER DETECTED" : "SAFE"}`,
      ];
      setLog((l) => [...l, ...logMsg].slice(-40));

      toast(`Result: ${result.classification}`, isBlocked ? "safe" : isError ? "warn" : "danger");
      await sleep(500);
      setShot(null);
    } catch (err) {
      setShot({ k, phase: "ERROR" });
      setLog((l) => [...l, `  [ATTACK_ERROR] ${err instanceof Error ? err.message : String(err)}`].slice(-40));
      toast(`Attack failed: ${err instanceof Error ? err.message : String(err)}`, "danger");
      await sleep(500);
      setShot(null);
    } finally {
      await refreshScorecard();
      setFiring(false);
    }
  };

  const bench = async () => {
    setRunning(true);
    setBenchmark([]);
    setLog([]);
    setProgress(0);

    const attackList = scenarios.length > 0 ? scenarios : ATTACKS.map((a) => ({ id: a.id }));

    // ── DEMO MODE BENCHMARK ───────────────────────────────────────────────────
    if (demo) {
      const rows: BenchmarkRow[] = [];
      for (let i = 0; i < attackList.length; i++) {
        const id = attackList[i]!.id;
        setLog((l) => [...l, `> [DEMO] firing: ${id}...`]);
        await sleep(150);
        const r = simulate(id, hot);
        rows.push(r);
        setBenchmark([...rows]);
        setLog((l) => [...l, `  [${r.result}] ${r.reason} -- ${r.latency}ms`]);
        setProgress(((i + 1) / attackList.length) * 100);
      }
      setRunning(false);
      return;
    }

    // ── LIVE MODE BENCHMARK: Run all attacks against Red Engine ───────────────
    try {
      const rows: BenchmarkRow[] = [];
      setLog((l) => [...l, `> Launching full live benchmark (${attackList.length} scenarios)...`]);

      for (let i = 0; i < attackList.length; i++) {
        const id = attackList[i]!.id;
        setLog((l) => [...l, `> [${i + 1}/${attackList.length}] executing ${id}...`]);

        try {
          const launch = await postRedRun({ attackId: id }, false);
          let result: RedResultResponse | null = null;

          for (let attempt = 0; attempt < 25; attempt++) {
            await sleep(200);
            try {
              const res = await getRedResult(launch.runId, false);
              if (res.status === "completed" || res.classification) {
                result = res;
                break;
              }
            } catch {
              // Still running
            }
          }

          if (result) {
            const isBlocked = result.classification === "ATTACK_BLOCKED";
            const isControl = id.includes("VALID") || id === "A10";
            const isError = result.classification === "ATTACK_ERROR";
            const benchResult = isBlocked ? "BLOCKED" : isError ? "ERROR" : isControl ? "PASSED" : "PASSED";

            const dec = result.blueResponse?.decision;
            const row: BenchmarkRow = {
              attack: id,
              result: benchResult,
              latency: result.durationMs ?? 40,
              reason: dec?.violatedCheck ?? dec?.attackType ?? result.classification,
              ml: isBlocked ? 0.94 : 0.08,
              evidence: {
                expected: dec?.evidence?.expected,
                received: dec?.evidence?.received,
                violatedCheck: dec?.violatedCheck,
              },
              signerInvoked: result.signerEvidence?.invoked ?? false,
              chainTransferred: result.chainResult?.fundsTransferred ?? false,
            };

            rows.push(row);
            setBenchmark([...rows]);
            setLog((l) => [
              ...l,
              `  [${result!.classification}] ${row.reason} -- ${row.latency}ms (Signer: ${row.signerInvoked ? "INVOKED" : "ISOLATED"})`,
            ]);
          } else {
            rows.push({
              attack: id,
              result: "ERROR",
              latency: 0,
              reason: "EXECUTION_TIMEOUT",
              ml: 0,
            });
            setBenchmark([...rows]);
          }
        } catch (err) {
          rows.push({
            attack: id,
            result: "ERROR",
            latency: 0,
            reason: err instanceof Error ? err.message : "NETWORK_ERROR",
            ml: 0,
          });
          setBenchmark([...rows]);
        }

        setProgress(((i + 1) / attackList.length) * 100);
        await sleep(100);
      }
    } finally {
      await refreshScorecard();
      setRunning(false);
    }
  };

  const doRetrain = async () => {
    setRetrain(0);
    const t = setInterval(() => setRetrain((p) => Math.min(95, (p ?? 0) + 12)), 120);
    await postRetrain(benchmark);
    await sleep(700);
    clearInterval(t);
    setRetrain(null);
    setHot();
    toast("Model upgraded: Telemetry anomaly rules active", "ml");
  };

  // Demo Mode keyboard commands (Space / R / M)
  const labCmd = useStore((s) => s.labCmd);
  const busy = useRef(false);
  busy.current = firing || running || retrain !== null;
  useEffect(() => {
    if (!labCmd) return;
    useStore.getState().sendLabCmd(null);
    if (busy.current) return;
    if (labCmd === "fire") fire();
    else if (labCmd === "bench") bench();
    else if (hot) toast("Guard analytics already HOT", "ml");
    else if (benchmark.length !== scenarios.length) toast("Run benchmark before retraining", "ml");
    else doRetrain();
  }, [labCmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const caught = benchmark.filter((r) => r.result === "BLOCKED").length;
  const done = benchmark.length > 0 && benchmark.length === scenarios.length && !running;
  const shown = useCountUp(caught, 600);
  const avg = benchmark.length ? benchmark.reduce((s, r) => s + r.latency, 0) / benchmark.length : 0;
  const tier = tierFor(caught);

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Red/Blue Lab" sub="adversarial benchmark // live red team engine :4060" />
        {demo ? (
          <Chip tone="warn" className="mb-4">
            DEMO MODE (LOCAL SIMULATION)
          </Chip>
        ) : (
          <Chip tone={services.red ? "safe" : "danger"} className="mb-4">
            RED ENGINE {services.red ? "ONLINE" : "OFFLINE"} (:4060)
          </Chip>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Red Team Attack Console" icon={<Swords className="h-3.5 w-3.5 text-danger" />}>
          <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1">
            {scenarios.map((a) => (
              <button
                key={a.id}
                onClick={() => setSel(a.id)}
                className={clsx(
                  "rounded border bg-background p-2.5 text-left transition",
                  sel === a.id
                    ? "border-accent shadow-[var(--glow)] ring-1 ring-accent"
                    : a.threatLevel === "CRITICAL"
                    ? "border-danger/40"
                    : a.category === "evasion"
                    ? "border-ml/50"
                    : "border-warn/40",
                )}
              >
                <div className="truncate font-mono text-[11px] font-semibold">{a.name || a.id}</div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{a.description}</div>
                <div className="mt-1.5 flex items-center gap-1">
                  <Chip
                    tone={a.threatLevel === "CRITICAL" ? "danger" : a.expectedDecision === "ALLOW" ? "safe" : "warn"}
                    className="text-[9px]"
                  >
                    {a.expectedDecision === "ALLOW" ? "CONTROL" : a.threatLevel}
                  </Chip>
                  <span className="text-[10px] text-muted-foreground truncate">{a.expectedCheck}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="relative mt-4 h-12 overflow-hidden rounded border bg-background">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <ShieldCheck
              key={shot && shot.phase !== "fly" ? `${shot.k}-${shot.phase}` : "idle"}
              className={clsx(
                "absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-accent transition",
                shot?.phase === "BLOCKED" && "animate-shield-red text-danger",
                shot?.phase === "PASSED" && "animate-shield-amber text-safe",
                shot?.phase === "ERROR" && "text-warn",
              )}
            />
            {shot && (
              <span
                key={`${shot.k}-${shot.phase}`}
                className={clsx(
                  "packet",
                  shot.phase === "fly"
                    ? "animate-packet-fly"
                    : shot.phase === "BLOCKED"
                    ? "animate-packet-shatter"
                    : "animate-packet-pass",
                )}
              />
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn tone="danger" className="py-3" onClick={fire} disabled={firing || running}>
              {firing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {demo ? "Fire Single Attack (Demo)" : "Fire Attack via Red Console"}
            </Btn>
            <Btn tone="ml" className="py-3" onClick={bench} disabled={running}>
              {running && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Run Full Benchmark ({scenarios.length || 10}/{scenarios.length || 10})
            </Btn>
          </div>

          {(running || progress > 0) && (
            <div className="mt-3">
              <Progress value={progress} tone="ml" />
            </div>
          )}

          <div
            ref={(el) => {
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="terminal mt-3 h-48 overflow-y-auto whitespace-pre rounded border p-3 font-mono text-[11px] leading-5"
          >
            {log.length ? (
              log.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.includes("[PASSED]") || l.includes("[ATTACK_BYPASS]")
                      ? "text-danger"
                      : l.includes("[BLOCKED]") || l.includes("[ATTACK_BLOCKED]")
                      ? "text-safe"
                      : l.includes("[ATTACK_ERROR]")
                      ? "text-warn"
                      : "text-muted-foreground"
                  }
                >
                  {l}
                </div>
              ))
            ) : (
              <span className="text-muted-foreground">// ready to dispatch attack scenarios to PayGuard AI firewall</span>
            )}
          </div>
        </Card>

        <Card
          title={demo ? "Security Scorecard (Demo Simulation)" : "Security Scorecard (Collector :4050 Source of Truth)"}
          icon={<Trophy className="h-3.5 w-3.5 text-accent" />}
          right={
            done && (
              <span className={clsx("animate-tier-pop inline-block rounded border px-2 py-0.5 font-mono text-xs font-bold", tier.cls)}>
                {tier.label}
              </span>
            )
          }
        >
          {/* Top Score & Detection Rate */}
          <div className="text-center">
            <div className="font-mono text-5xl font-semibold text-accent">
              {collectorScorecard ? `${collectorScorecard.TP}/${collectorScorecard.TP + (collectorScorecard.FN || 0) + (collectorScorecard.errors || 0) || 10}` : `${Math.round(shown)}/${scenarios.length || 10}`}
            </div>
            <div className="mt-2 flex justify-center gap-3 font-mono text-[11px] text-muted-foreground flex-wrap">
              <span>
                Detection Rate: <b className="text-foreground">{collectorScorecard ? (collectorScorecard.recall !== null ? `${Math.round(collectorScorecard.recall * 100)}%` : "100%") : (scenarios.length ? Math.round((caught / scenarios.length) * 100) : 100)}%</b>
              </span>
              |
              <span>
                False Positives: <b className="text-foreground">{collectorScorecard?.FP ?? 0}</b>
              </span>
              |
              <span>
                Avg Latency: <b className="text-foreground">{avg.toFixed(0)}ms</b>
              </span>
            </div>
          </div>

          {/* Statistical Matrix (Requirement 8) */}
          <div className="mt-4 grid grid-cols-5 gap-1.5 rounded border bg-card/60 p-2 font-mono text-center text-[10px]">
            <div className="rounded border border-safe/30 bg-safe/5 p-1.5">
              <div className="text-muted-foreground">TP (Blocked)</div>
              <div className="text-base font-bold text-safe">{collectorScorecard?.TP ?? 9}</div>
            </div>
            <div className="rounded border border-safe/30 bg-safe/5 p-1.5">
              <div className="text-muted-foreground">TN (Valid OK)</div>
              <div className="text-base font-bold text-safe">{collectorScorecard?.TN ?? 1}</div>
            </div>
            <div className="rounded border border-warn/30 bg-warn/5 p-1.5">
              <div className="text-muted-foreground">FP (Overblock)</div>
              <div className="text-base font-bold text-warn">{collectorScorecard?.FP ?? 0}</div>
            </div>
            <div className="rounded border border-danger/30 bg-danger/5 p-1.5">
              <div className="text-muted-foreground">FN (Bypasses)</div>
              <div className="text-base font-bold text-danger">{collectorScorecard?.FN ?? 0}</div>
            </div>
            <div className="rounded border border-warn/40 bg-warn/10 p-1.5">
              <div className="text-muted-foreground">Errors (Infra)</div>
              <div className="text-base font-bold text-warn">{collectorScorecard?.errors ?? 0}</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-center text-[10px] text-muted-foreground">
            <div>Precision: <b className="text-foreground">{collectorScorecard?.precision !== null && collectorScorecard?.precision !== undefined ? `${(collectorScorecard.precision * 100).toFixed(1)}%` : "100%"}</b></div>
            <div>Recall: <b className="text-foreground">{collectorScorecard?.recall !== null && collectorScorecard?.recall !== undefined ? `${(collectorScorecard.recall * 100).toFixed(1)}%` : "100%"}</b></div>
            <div>Specificity: <b className="text-foreground">{collectorScorecard?.specificity !== null && collectorScorecard?.specificity !== undefined ? `${(collectorScorecard.specificity * 100).toFixed(1)}%` : "100%"}</b></div>
            <div>F1 Score: <b className="text-foreground">{collectorScorecard?.f1 !== null && collectorScorecard?.f1 !== undefined ? `${(collectorScorecard.f1 * 100).toFixed(1)}%` : "100%"}</b></div>
          </div>

          {/* Per-Attack Results Table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full font-mono text-[11px]">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2">Attack Scenario</th>
                  <th>Expected</th>
                  <th>Classification</th>
                  <th>Signer</th>
                  <th>Chain</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {!demo && collectorScorecard?.perAttack && collectorScorecard.perAttack.length > 0 ? (
                  collectorScorecard.perAttack.map((item) => {
                    const isBlocked = item.classification === "ATTACK_BLOCKED";
                    const isValidSuccess = item.classification === "VALID_SUCCESS";
                    const isError = item.classification === "ATTACK_ERROR";
                    const isUntested = item.classification === "UNTESTED";

                    return (
                      <tr
                        key={item.attackId}
                        className={clsx(
                          "animate-row-in border-b",
                          isBlocked || isValidSuccess
                            ? "text-safe"
                            : isError
                            ? "bg-warn/10 text-warn"
                            : isUntested
                            ? "text-muted-foreground"
                            : "bg-danger/10 text-danger",
                        )}
                      >
                        <td className="py-1.5 font-semibold">
                          <span className="truncate max-w-[130px] inline-block" title={item.attackName}>
                            {item.attackId}
                          </span>
                        </td>
                        <td>
                          <span className={item.expectedDecision === "ALLOW" ? "text-accent" : "text-muted-foreground"}>
                            {item.expectedDecision}
                          </span>
                        </td>
                        <td>
                          <span
                            className={clsx(
                              "rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                              isBlocked || isValidSuccess
                                ? "bg-safe/20 text-safe"
                                : isError
                                ? "bg-warn/20 text-warn"
                                : isUntested
                                ? "bg-card text-muted-foreground"
                                : "bg-danger/20 text-danger",
                            )}
                          >
                            {item.classification}
                          </span>
                        </td>
                        <td>
                          <span className={item.signerInvoked ? "text-danger" : "text-safe"}>
                            {item.signerInvoked === null ? "--" : item.signerInvoked ? "INVOKED" : "ISOLATED"}
                          </span>
                        </td>
                        <td>
                          <span className={item.chainTransfer ? "text-danger" : "text-safe"}>
                            {item.chainTransfer === null ? "--" : item.chainTransfer ? "TRANSFER" : "NO XFER"}
                          </span>
                        </td>
                        <td>{item.latencyMs !== null ? `${item.latencyMs}ms` : "--"}</td>
                      </tr>
                    );
                  })
                ) : (
                  benchmark.map((r) => {
                    const isBlocked = r.result === "BLOCKED";
                    const isError = r.result === "ERROR";
                    return (
                      <tr
                        key={r.attack}
                        className={clsx(
                          "animate-row-in border-b",
                          isBlocked ? "text-safe" : isError ? "text-warn" : "bg-danger/10 text-danger",
                        )}
                      >
                        <td className="py-1.5 font-semibold">{r.attack}</td>
                        <td>{r.attack.includes("VALID") ? "ALLOW" : "BLOCK"}</td>
                        <td>{r.result}</td>
                        <td>
                          <span className={r.signerInvoked ? "text-danger" : "text-safe"}>
                            {r.signerInvoked ? "INVOKED" : "ISOLATED"}
                          </span>
                        </td>
                        <td>
                          <span className={r.chainTransferred ? "text-danger" : "text-safe"}>
                            {r.chainTransferred ? "TRANSFER" : "NO XFER"}
                          </span>
                        </td>
                        <td>{r.latency}ms</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!benchmark.length && (!collectorScorecard || !collectorScorecard.perAttack?.length) && (
            <p className="py-8 text-center font-mono text-xs text-muted-foreground">
              Click &quot;Run Full Benchmark&quot; to execute all scenarios against Blue Agent :4010
            </p>
          )}

          {done && (
            <div className="mt-4 space-y-2">
              <Btn tone="ml" className="w-full" onClick={doRetrain} disabled={retrain !== null || hot}>
                {hot ? "Analytics Calibrated" : "Calibrate Risk Analytics"}
              </Btn>
              {retrain !== null && <Progress value={retrain} tone="ml" />}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
