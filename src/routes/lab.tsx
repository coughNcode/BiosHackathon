import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Swords, Trophy } from "lucide-react";
import { ATTACKS } from "@/lib/mock";
import { postRetrain } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useCountUp } from "@/hooks/use-live";
import { Btn, Card, Chip, MLChip, PageTitle, Progress } from "@/components/ws/ui";
import type { BenchmarkRow } from "@/lib/types";

export const Route = createFileRoute("/lab")({
  head: () => ({
    meta: [
      { title: "Red/Blue Lab — WalletShield" },
      { name: "description", content: "Fire simulated attacks at the firewall and score its detection rate." },
      { property: "og:title", content: "Red/Blue Lab — WalletShield" },
      { property: "og:description", content: "Adversarial attack simulator and security scorecard." },
    ],
  }),
  component: Lab,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function simulate(id: string, hot: boolean): BenchmarkRow {
  const a = ATTACKS.find((x) => x.id === id)!;
  // ML evasion slips past the rules until the model is retrained.
  const passed = a.severity === "evasion" && !hot;
  return {
    attack: a.id,
    result: passed ? "PASSED" : "BLOCKED",
    latency: 3 + Math.floor(Math.random() * 6),
    reason: passed ? "--" : a.reason,
    ml: passed ? 0.58 : a.severity === "evasion" ? 0.91 : 0.6 + Math.random() * 0.38,
  };
}

function logLines(r: BenchmarkRow) {
  return [`> firing: ${r.attack}...`, `  [${r.result}] ${ATTACKS.find((a) => a.id === r.attack)?.reason ?? r.reason} -- ${r.latency}ms`];
}

export function tierFor(caught: number) {
  if (caught >= 10) return { label: "S-TIER", cls: "text-gold border-gold/60 shadow-[0_0_14px_var(--gold)]" };
  if (caught >= 8) return { label: "A-TIER", cls: "text-safe border-safe/60" };
  if (caught >= 6) return { label: "B-TIER", cls: "text-warn border-warn/60" };
  return { label: "NEEDS WORK", cls: "text-danger border-danger/60" };
}

function Lab() {
  const { mlPhase, benchmark, setBenchmark, setHot, toast } = useStore();
  const [sel, setSel] = useState(ATTACKS[0]!.id);
  const [firing, setFiring] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [retrain, setRetrain] = useState<number | null>(null);
  const hot = mlPhase === "HOT";

  const [shot, setShot] = useState<{ k: number; phase: "fly" | "BLOCKED" | "PASSED" } | null>(null);
  const fire = async () => {
    setFiring(true);
    const k = Date.now();
    setShot({ k, phase: "fly" });
    await sleep(400);
    const r = simulate(sel, hot);
    setShot({ k, phase: r.result });
    setLog((l) => [...l, ...logLines(r)].slice(-40));
    await sleep(450);
    setShot(null);
    setFiring(false);
  };

  const bench = async () => {
    setRunning(true);
    setBenchmark([]);
    setLog([]);
    const rows: BenchmarkRow[] = [];
    for (let i = 0; i < ATTACKS.length; i++) {
      setLog((l) => [...l, `> firing: ${ATTACKS[i]!.id}...`]);
      await sleep(150);
      const r = simulate(ATTACKS[i]!.id, hot);
      rows.push(r);
      setBenchmark([...rows]);
      setLog((l) => [...l, logLines(r)[1]!]);
      setProgress(((i + 1) / ATTACKS.length) * 100);
    }
    setRunning(false);
  };

  const doRetrain = async () => {
    setRetrain(0);
    const t = setInterval(() => setRetrain((p) => Math.min(95, (p ?? 0) + 12)), 120);
    await postRetrain(benchmark);
    await sleep(700);
    clearInterval(t);
    setRetrain(null);
    setHot();
    toast("Model upgraded: IsolationForest -> XGBClassifier", "ml");
  };

  // Demo Mode keyboard commands (Space / R / M) arrive through the store.
  const labCmd = useStore((s) => s.labCmd);
  const busy = useRef(false);
  busy.current = firing || running || retrain !== null;
  useEffect(() => {
    if (!labCmd) return;
    useStore.getState().sendLabCmd(null);
    if (busy.current) return;
    if (labCmd === "fire") fire();
    else if (labCmd === "bench") bench();
    else if (hot) toast("ML Guard is already HOT", "ml");
    else if (benchmark.length !== ATTACKS.length) toast("Run the benchmark (R) before retraining", "ml");
    else doRetrain();
  }, [labCmd]); // eslint-disable-line react-hooks/exhaustive-deps

  const caught = benchmark.filter((r) => r.result === "BLOCKED").length;
  const done = benchmark.length === ATTACKS.length && !running;
  const shown = useCountUp(caught, 600);
  const avg = benchmark.length ? benchmark.reduce((s, r) => s + r.latency, 0) / benchmark.length : 0;
  const tier = tierFor(caught);

  return (
    <>
      <PageTitle title="Red/Blue Lab" sub="adversarial benchmark // 10 attack vectors" />
      <div className="grid grid-cols-2 gap-4">
        <Card title="Red Team Attack Simulator" icon={<Swords className="h-3.5 w-3.5 text-danger" />}>
          <div className="grid grid-cols-2 gap-2">
            {ATTACKS.map((a) => (
              <button key={a.id} onClick={() => setSel(a.id)} className={clsx("rounded border bg-background p-2.5 text-left transition", sel === a.id ? "border-accent shadow-[var(--glow)] ring-1 ring-accent" : a.severity === "critical" ? "border-danger/40" : a.severity === "evasion" ? "border-ml/50" : "border-warn/40")}>
                <div className="truncate font-mono text-[11px] font-semibold">{a.id}</div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{a.desc}</div>
                <Chip tone={a.severity === "critical" ? "danger" : a.severity === "evasion" ? "ml" : "warn"} className="mt-1.5 text-[9px]">{a.reason}</Chip>
              </button>
            ))}
          </div>
          <div className="relative mt-4 h-12 overflow-hidden rounded border bg-background">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <ShieldCheck key={shot && shot.phase !== "fly" ? `${shot.k}-${shot.phase}` : "idle"} className={clsx("absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-accent", shot?.phase === "BLOCKED" && "animate-shield-red", shot?.phase === "PASSED" && "animate-shield-amber")} />
            {shot && (
              <span key={`${shot.k}-${shot.phase}`} className={clsx("packet", shot.phase === "fly" ? "animate-packet-fly" : shot.phase === "BLOCKED" ? "animate-packet-shatter" : "animate-packet-pass")} />
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn tone="danger" className="py-3" onClick={fire} disabled={firing || running}>
              {firing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Fire Single Attack
            </Btn>
            <Btn tone="ml" className="py-3" onClick={bench} disabled={running}>Run Full Benchmark (10/10)</Btn>
          </div>
          {(running || progress > 0) && <div className="mt-3"><Progress value={progress} tone="ml" /></div>}
          <div ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }} className="terminal mt-3 h-48 overflow-y-auto whitespace-pre rounded border p-3 font-mono text-[11px] leading-5">
            {log.length ? log.map((l, i) => <div key={i} className={l.includes("[PASSED]") ? "text-danger" : l.includes("[BLOCKED]") ? "text-safe" : "text-muted-foreground"}>{l}</div>) : <span className="text-muted-foreground">// attack log empty</span>}
          </div>
        </Card>
        <Card title="Security Scorecard" icon={<Trophy className="h-3.5 w-3.5 text-accent" />} right={done && <span className={clsx("animate-tier-pop inline-block rounded border px-2 py-0.5 font-mono text-xs font-bold", tier.cls)}>{tier.label}</span>}>
          <div className="text-center">
            <div className="font-mono text-6xl font-semibold text-accent">{Math.round(shown)}/10</div>
            <div className="mt-2 flex justify-center gap-4 font-mono text-[11px] text-muted-foreground">
              <span>Detection Rate: <b className="text-foreground">{caught * 10}%</b></span>|
              <span>False Positives: <b className="text-foreground">0</b></span>|
              <span>Avg Latency: <b className="text-foreground">{avg.toFixed(0)}ms</b></span>
            </div>
          </div>
          <table className="mt-4 w-full font-mono text-[11px]">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b"><th className="py-2">Attack Name</th><th>Result</th><th>Latency</th><th>Block Reason</th><th>ML</th></tr>
            </thead>
            <tbody>
              {benchmark.map((r) => (
                <tr key={r.attack} className={clsx("animate-row-in border-b", r.result === "BLOCKED" ? "text-safe" : "bg-danger/10 text-danger")}>
                  <td className="py-1.5">{r.attack}</td><td>{r.result}</td><td>{r.latency}ms</td><td>{r.reason}</td><td><MLChip score={r.ml} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!benchmark.length && <p className="py-8 text-center font-mono text-xs text-muted-foreground">Run the benchmark to fill the scorecard</p>}
          {done && (
            <div className="mt-4 space-y-2">
              <Btn tone="ml" className="w-full" onClick={doRetrain} disabled={retrain !== null || hot}>{hot ? "ML Guard is HOT" : "Retrain ML Guard"}</Btn>
              {retrain !== null && <Progress value={retrain} tone="ml" />}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
