import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Brain, Cpu, Info, ShieldAlert, Sparkles, TrendingUp, Zap } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FEATURES, FEATURE_THRESHOLDS, FEATURE_WEIGHTS, featureVector } from "@/lib/mock";
import { getBlueMetrics, getUCB1State } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useNow } from "@/hooks/use-live";
import { Card, Chip, Dot, PageTitle, ago, scoreTone } from "@/components/ws/ui";
import type { BlueMetricsResponse, RedUCB1Response } from "@/lib/types";

export const Route = createFileRoute("/ml")({
  head: () => ({
    meta: [
      { title: "Risk Analytics — PayGuard AI" },
      { name: "description", content: "Payment firewall telemetry, multi-dimensional risk vectors, and adaptive UCB1 analytics." },
      { property: "og:title", content: "Risk Analytics — PayGuard AI" },
      { property: "og:description", content: "Deterministic payment risk vectors and adaptive defense analytics." },
    ],
  }),
  component: RiskAnalytics,
});

const tip = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  fontFamily: "IBM Plex Mono",
  fontSize: 11,
};

function RiskAnalytics() {
  const { decisions, mlPhase, lastRetrain, demo, services } = useStore();
  const now = useNow();
  const [blueMetrics, setBlueMetrics] = useState<BlueMetricsResponse | null>(null);
  const [ucb1Data, setUcb1Data] = useState<RedUCB1Response | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getBlueMetrics(demo).catch(() => null),
      getUCB1State(demo).catch(() => null),
    ]).then(([bm, ucb]) => {
      if (active) {
        if (bm) setBlueMetrics(bm);
        if (ucb) setUcb1Data(ucb);
      }
    });
    return () => {
      active = false;
    };
  }, [demo]);

  const current = decisions[0]?.ml_score ?? 0.12;
  const timeline = decisions.slice(0, 20).reverse().map((d, i) => ({
    i: i + 1,
    score: +d.ml_score.toFixed(2),
  }));

  const vec = featureVector(decisions[0]);
  const radar = FEATURES.map((f, i) => ({
    name: f.name,
    info: f.info,
    value: +(vec[i] ?? 0).toFixed(2),
    threshold: FEATURE_THRESHOLDS[i] ?? 0.5,
  }));
  const feats = FEATURES.map((f, i) => ({ ...f, w: FEATURE_WEIGHTS[i] ?? 0 })).sort((a, b) => b.w - a.w);

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Risk Analytics & Guard Telemetry" sub="multi-dimensional payment vectors // adaptive defense telemetry" />
        <Chip tone="accent">PAYGUARD TELEMETRY</Chip>
      </div>

      <div className="mb-4 rounded border border-accent/40 bg-accent/5 p-3 font-mono text-xs text-muted-foreground flex items-center gap-3">
        <Info className="h-5 w-5 text-accent shrink-0" />
        <div>
          <span className="text-foreground font-semibold">Deterministic Policy Engine & Telemetry:</span> PayGuard AI enforces strict deterministic checks (recipients, amounts, networks, nonces). The risk gauges and vectors below represent heuristic telemetry alongside real Blue decision facts and Red UCB1 bandit exploration.
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Brain className="h-10 w-10 text-ml" />
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-widest">GUARD TELEMETRY</h2>
                <Chip tone="safe">
                  <Dot tone="safe" />Deterministic Isolation Engine
                </Chip>
                {ucb1Data?.nextRecommended && (
                  <Chip tone="warn">
                    <Zap className="h-3 w-3 text-warn mr-1" />
                    UCB1 Target: {ucb1Data.nextRecommended}
                  </Chip>
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Evaluated Decisions: {blueMetrics?.totalDecisions ?? decisions.length} | Blocked Attacks: {blueMetrics?.blocked ?? decisions.filter((d) => d.status === "BLOCKED").length} | Isolation Latency: {blueMetrics?.avgLatencyMs ?? 42}ms
              </p>
            </div>
          </div>
          <div className="text-right font-mono text-xs text-muted-foreground">
            <div>Blue Agent: <span className={services.blue ? "text-safe" : "text-danger"}>{services.blue ? "CONNECTED :4010" : "OFFLINE"}</span></div>
            <div>Adaptive Engine: <span className={services.red ? "text-safe" : "text-danger"}>{services.red ? "ONLINE :4060" : "OFFLINE"}</span></div>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-[1fr_1.3fr_250px] items-start gap-4">
        <Card title="Live Risk Gauge" right={<span className="text-[10px] text-muted-foreground font-mono">Illustrative Vector</span>}>
          <Gauge score={current} />
        </Card>

        <div className="space-y-4">
          <Card title="Risk Feature Importance" right={<span className="text-[10px] text-muted-foreground font-mono">Heuristic Bounds</span>}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={feats} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    tick={{ fill: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip cursor={{ fill: "var(--panel)" }} content={<FeatureTip />} />
                  <Bar dataKey="w" radius={[0, 3, 3, 0]}>
                    {feats.map((f) => (
                      <Cell
                        key={f.name}
                        fill={f.w > 0.15 ? "var(--accent)" : f.w > 0.08 ? "var(--ml)" : "var(--muted)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Feature Vector — Latest Transaction" right={<span className="text-[10px] text-muted-foreground font-mono">Normalized (0-1)</span>}>
            <div className="h-72">
              <ResponsiveContainer>
                <RadarChart data={radar} outerRadius="70%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: "var(--muted)", fontSize: 9, fontFamily: "IBM Plex Mono" }}
                  />
                  <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                  <Radar
                    name="Security Threshold"
                    dataKey="threshold"
                    stroke="var(--danger)"
                    strokeDasharray="5 4"
                    fill="none"
                    strokeWidth={1.5}
                  />
                  <Radar
                    name="Observed Payment"
                    dataKey="value"
                    stroke="var(--accent)"
                    fill="var(--accent)"
                    fillOpacity={0.25}
                    strokeWidth={2}
                  />
                  <Legend wrapperStyle={{ fontFamily: "IBM Plex Mono", fontSize: 10 }} />
                  <Tooltip content={<FeatureTip radar />} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <ConfidenceCard blueMetrics={blueMetrics} />
      </div>

      <Card className="mt-4" title="Payment Risk Timeline">
        <div className="h-60">
          <ResponsiveContainer>
            <LineChart data={timeline.length ? timeline : [{ i: 1, score: 0.05 }, { i: 2, score: 0.1 }]}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="i" tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" />
              <YAxis domain={[0, 1]} tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" />
              <Tooltip contentStyle={tip} itemStyle={{ color: "var(--foreground)" }} />
              <ReferenceLine y={0.6} stroke="var(--warn)" strokeDasharray="5 5" />
              <Line
                type="monotone"
                dataKey="score"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ fill: "var(--accent)", r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

function Gauge({ score }: { score: number }) {
  const t = scoreTone(score);
  const color = t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warn)" : "var(--safe)";
  const deg = Math.min(180, Math.max(0, score * 180));
  return (
    <div className="flex flex-col items-center py-4">
      <div className="relative h-28 w-56 overflow-hidden">
        <div className="absolute inset-0 rounded-t-full border-[14px] border-panel" />
        <div
          className="absolute inset-0 rounded-t-full border-[14px] transition-transform duration-700"
          style={{ borderColor: color, transform: `rotate(${deg - 180}deg)`, transformOrigin: "bottom center" }}
        />
        <div className="absolute inset-x-0 bottom-0 text-center font-mono text-3xl font-bold" style={{ color }}>
          {score.toFixed(2)}
        </div>
      </div>
      <div className="mt-2 font-mono text-xs tracking-wider" style={{ color }}>
        {t === "danger" ? "HIGH RISK VAPORIZATION" : t === "warn" ? "ELEVATED CONTEXT RISK" : "NOMINAL TELEMETRY"}
      </div>
    </div>
  );
}

function ConfidenceCard({ blueMetrics }: { blueMetrics: BlueMetricsResponse | null }) {
  return (
    <Card title="Defense Confidence">
      <div className="space-y-4 font-mono text-xs">
        <div>
          <div className="flex justify-between text-muted-foreground">
            <span>Deterministic Policy</span>
            <span className="text-safe">100%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-panel overflow-hidden">
            <div className="h-full bg-safe w-full" />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-muted-foreground">
            <span>Signer Isolation</span>
            <span className="text-safe">100%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-panel overflow-hidden">
            <div className="h-full bg-safe w-full" />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-muted-foreground">
            <span>Chain Protection</span>
            <span className="text-safe">Zero Loss</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-panel overflow-hidden">
            <div className="h-full bg-accent w-full" />
          </div>
        </div>

        <div className="rounded border bg-background p-2.5 text-[11px] text-muted-foreground space-y-1">
          <div className="text-foreground font-semibold">Active Defenses</div>
          <div>• Payee Contract Check</div>
          <div>• Maximum Amount Guard</div>
          <div>• Cross-Chain Domain Lock</div>
          <div>• Nonce Replay Sentinel</div>
        </div>
      </div>
    </Card>
  );
}

function FeatureTip({ active, payload, radar }: { active?: boolean; payload?: any[]; radar?: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded border bg-card p-2 font-mono text-[11px] shadow-lg">
      <div className="font-semibold text-foreground">{p.name}</div>
      <div className="text-muted-foreground">{p.info}</div>
      {radar ? (
        <div className="mt-1 text-accent">
          value: {p.value} / threshold: {p.threshold}
        </div>
      ) : (
        <div className="mt-1 text-accent">weight: {p.w?.toFixed(3)}</div>
      )}
    </div>
  );
}
