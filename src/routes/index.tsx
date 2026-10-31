import { createFileRoute } from "@tanstack/react-router";
import { Brain, ShieldOff, TrendingUp, PieChart as PieIcon, ListChecks } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/use-live";
import { Card, DecisionRow, KPICard, PageTitle, Progress } from "@/components/ws/ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — WalletShield" },
      { name: "description", content: "Live KPIs, recent payment decisions and attack distribution for your AI agent wallet." },
      { property: "og:title", content: "Overview — WalletShield" },
      { property: "og:description", content: "Live KPIs, recent payment decisions and attack distribution." },
    ],
  }),
  component: Overview,
});

const REASONS = ["WRONG_RECIPIENT", "OVERPAYMENT", "INTENT_FINGERPRINT", "EXPIRED", "NETWORK_MISMATCH", "ML_ANOMALY"];
const SHADES = [
  "var(--danger)",
  "color-mix(in oklab, var(--danger) 70%, var(--warn))",
  "color-mix(in oklab, var(--danger) 45%, var(--warn))",
  "var(--warn)",
  "color-mix(in oklab, var(--warn) 60%, var(--background))",
  "color-mix(in oklab, var(--danger) 55%, var(--background))",
];
const BASE = [3, 2, 2, 1, 1, 1];

function Overview() {
  const { decisions, mlPhase } = useStore();
  const now = useNow();
  const blocked = decisions.filter((d) => d.status === "BLOCKED");
  const spent = decisions.filter((d) => d.status === "APPROVED").reduce((s, d) => s + d.amount, 0);
  const dist = REASONS.map((r, i) => ({ name: r, value: (BASE[i] ?? 0) + decisions.filter((d) => d.reason === r).length }));

  return (
    <>
      <PageTitle title="Overview" sub="firewall telemetry // base-sepolia // usdc" />
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Payments Today" value={decisions.length} tone="accent" icon={<TrendingUp className="h-4 w-4" />} />
        <KPICard label="Attacks Blocked" value={blocked.length} tone="danger" icon={<ShieldOff className="h-4 w-4" />} />
        <KPICard label="Budget Used" value={spent} tone="accent" icon={<span className="font-mono text-xs">USDC</span>} format={(n) => `$${n.toFixed(4)}`}>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">of $1.00 daily</div>
          <div className="mt-2"><Progress value={spent * 100} /></div>
        </KPICard>
        <Card>
          <div className="flex items-start justify-between">
            <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">ML Model</span>
            <Brain className="h-4 w-4 text-ml" />
          </div>
          <div className={`mt-3 font-mono text-2xl font-semibold ${mlPhase === "HOT" ? "text-safe" : "text-warn"}`}>
            {mlPhase === "HOT" ? "HOT -- XGBoost" : "WARM"}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-4">
        <Card className="col-span-3" title="Recent Decisions" icon={<ListChecks className="h-3.5 w-3.5" />}>
          {decisions.slice(0, 8).map((d) => <DecisionRow key={d.id} d={d} now={now} />)}
        </Card>
        <Card className="col-span-2" title="Attack Distribution" icon={<PieIcon className="h-3.5 w-3.5" />}>
          <div className="h-56">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={dist} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="var(--card)">
                  {dist.map((_, i) => <Cell key={i} fill={SHADES[i] ?? "var(--danger)"} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontFamily: "IBM Plex Mono", fontSize: 11 }} itemStyle={{ color: "var(--foreground)" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {dist.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between font-mono text-[11px]">
                <span className="flex items-center gap-2 truncate"><span className="h-2 w-2 rounded-sm" style={{ background: SHADES[i] }} />{d.name}</span>
                <span className="text-muted-foreground">{d.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
