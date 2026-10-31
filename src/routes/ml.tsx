import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Brain } from "lucide-react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Legend, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FEATURES, FEATURE_THRESHOLDS, FEATURE_WEIGHTS, featureVector } from "@/lib/mock";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/use-live";
import { Card, Chip, Dot, PageTitle, ago, scoreTone } from "@/components/ws/ui";

export const Route = createFileRoute("/ml")({
  head: () => ({
    meta: [
      { title: "ML Guard — WalletShield" },
      { name: "description", content: "Adaptive anomaly model: live risk gauge, feature importance and score timeline." },
      { property: "og:title", content: "ML Guard — WalletShield" },
      { property: "og:description", content: "Adaptive ML anomaly detection for AI payments." },
    ],
  }),
  component: MLGuard,
});

const tip = { background: "var(--card)", border: "1px solid var(--border)", fontFamily: "IBM Plex Mono", fontSize: 11 };

function MLGuard() {
  const { decisions, mlPhase, lastRetrain } = useStore();
  const now = useNow();
  const hot = mlPhase === "HOT";
  const current = decisions[0]?.ml_score ?? 0;
  const timeline = decisions.slice(0, 20).reverse().map((d, i) => ({ i: i + 1, score: +d.ml_score.toFixed(2) }));
  const vec = featureVector(decisions[0]);
  const radar = FEATURES.map((f, i) => ({ name: f.name, info: f.info, value: +(vec[i] ?? 0).toFixed(2), threshold: FEATURE_THRESHOLDS[i] ?? 0.5 }));
  const feats = FEATURES.map((f, i) => ({ ...f, w: FEATURE_WEIGHTS[i] ?? 0 })).sort((a, b) => b.w - a.w);

  return (
    <>
      <PageTitle title="ML Guard" sub="adaptive anomaly detection sidecar :4033" />
      <Card>
        <div className="flex items-center gap-4">
          <Brain className="h-10 w-10 text-ml" />
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold tracking-widest">ML GUARD</h2>
              {hot ? <Chip tone="safe"><Dot tone="safe" />HOT -- XGBClassifier</Chip> : <Chip tone="warn">WARM -- IsolationForest</Chip>}
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Training samples: {hot ? 57 : 47} | Attack recall: 100% | Last retrained: {lastRetrain ? ago(lastRetrain, now) : "2m ago"}
            </p>
          </div>
        </div>
      </Card>
      <div className="mt-4 grid grid-cols-[1fr_1.3fr_250px] items-start gap-4">
        <Card title="Live Risk Gauge"><Gauge score={current} /></Card>
        <div className="space-y-4">
        <Card title="Feature Importance">
          {hot ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={feats} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--panel)" }} content={<FeatureTip />} />
                  <Bar dataKey="w" radius={[0, 3, 3, 0]}>
                    {feats.map((f) => <Cell key={f.name} fill={f.w > 0.15 ? "var(--accent)" : f.w > 0.08 ? "var(--ml)" : "var(--muted)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded border border-dashed text-center font-mono text-xs text-muted-foreground">
              Run the benchmark and retrain to see feature weights
            </div>
          )}
        </Card>
        <Card title="Feature Vector — latest payment">
          <div className="h-72">
            <ResponsiveContainer>
              <RadarChart data={radar} outerRadius="70%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 9, fontFamily: "IBM Plex Mono" }} />
                <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                <Radar name="attack threshold" dataKey="threshold" stroke="var(--danger)" strokeDasharray="5 4" fill="none" strokeWidth={1.5} />
                <Radar name="latest payment" dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
                <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono", fontSize: 10 }} />
                <Tooltip content={<FeatureTip radar />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        </div>
        <ConfidenceCard lastRetrain={lastRetrain} now={now} />
      </div>
      <Card className="mt-4" title="Risk Score Timeline">
        <div className="h-60">
          <ResponsiveContainer>
            <LineChart data={timeline}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="i" tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" />
              <YAxis domain={[0, 1]} tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" />
              <Tooltip contentStyle={tip} itemStyle={{ color: "var(--foreground)" }} />
              <ReferenceLine y={0.6} stroke="var(--warn)" strokeDasharray="5 5" />
              <ReferenceLine y={0.85} stroke="var(--danger)" strokeDasharray="5 5" />
              <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: "var(--accent)" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

type TipProps = { active?: boolean; payload?: { payload: { name: string; info: string; w?: number; value?: number; threshold?: number } }[]; radar?: boolean };
function FeatureTip({ active, payload, radar }: TipProps) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="max-w-60 rounded border bg-card px-3 py-2 shadow-lg">
      <div className="font-mono text-[11px] font-semibold text-accent">{p.name}</div>
      <div className="mt-1 text-xs text-foreground">{p.info}</div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        {radar ? `value ${p.value} · threshold ${p.threshold}` : `weight ${p.w}`}
      </div>
    </div>
  );
}

function ConfidenceCard({ lastRetrain, now }: { lastRetrain: number | null | undefined; now: number }) {
  const attack = 38, legit = 9, total = attack + legit;
  const rows: [string, ReactNode][] = [
    ["Training samples", total],
    ["Attack recall", <span className="text-safe">100%</span>],
    ["False positive rate", <span className="text-safe">0%</span>],
    ["Last retrained", lastRetrain ? ago(lastRetrain, now) : "4 minutes ago"],
  ];
  return (
    <Card title="Model Confidence">
      <div className="space-y-3 font-mono text-[11px]">
        <div>
          <div className="flex justify-between text-muted-foreground"><span>Attack: <b className="text-danger">{attack}</b></span><span>Legit: <b className="text-safe">{legit}</b></span></div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="bg-danger" style={{ width: `${(attack / total) * 100}%` }} />
            <div className="bg-safe" style={{ width: `${(legit / total) * 100}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold text-foreground">{v}</dd></div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function Gauge({ score }: { score: number }) {
  const R = 110, cx = 140, cy = 130;
  const s = Math.max(0, Math.min(1, score));
  const tone = scoreTone(score);
  const color = { safe: "text-safe", warn: "text-warn", danger: "text-danger" }[tone];
  return (
    <div className={`flex flex-col items-center rounded-lg p-4 transition-shadow ${score > 0.85 ? "glow-danger" : score < 0.6 ? "glow-safe" : ""}`}>
      <svg viewBox="0 0 280 145" className="w-full max-w-sm" role="img" aria-label={`Risk score ${score.toFixed(2)}`}>
        <defs>
          <linearGradient id="gauge-grad" gradientUnits="userSpaceOnUse" x1={cx - R} y1="0" x2={cx + R} y2="0">
            <stop offset="0" stopColor="var(--safe)" />
            <stop offset="0.6" stopColor="var(--warn)" />
            <stop offset="1" stopColor="var(--danger)" />
          </linearGradient>
        </defs>
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="var(--border)" strokeWidth="20" strokeLinecap="round" />
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="url(#gauge-grad)" strokeWidth="14" strokeLinecap="round" />
        {[0, 0.6, 0.85, 1].map((t) => {
          const a = Math.PI * (1 - t);
          return <line key={t} x1={cx + Math.cos(a) * (R - 14)} y1={cy - Math.sin(a) * (R - 14)} x2={cx + Math.cos(a) * (R - 22)} y2={cy - Math.sin(a) * (R - 22)} stroke="var(--muted-foreground)" strokeWidth="1.5" />;
        })}
        <g style={{ transform: `rotate(${s * 180}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: "transform 300ms ease-out" }}>
          <polygon points={`${cx - R + 16},${cy} ${cx},${cy - 4} ${cx},${cy + 4}`} fill="var(--foreground)" />
        </g>
        <circle cx={cx} cy={cy} r="6" fill="var(--foreground)" />
      </svg>
      <div className={`font-mono text-[36px] font-bold leading-none ${color}`}>{score.toFixed(2)}</div>
      <div className="mt-2 font-mono text-[11px] text-muted-foreground">risk score of latest payment</div>
    </div>
  );
}
