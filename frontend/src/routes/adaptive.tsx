import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  Compass,
  Cpu,
  Dices,
  Flame,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Swords,
  Target,
  Zap,
} from "lucide-react";
import {
  getFuzzerCatalog,
  getUCB1State,
  postRedRun,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { Addr, Btn, Card, Chip, PageTitle } from "@/components/ws/ui";
import type { RedFuzzerCatalogResponse, RedMutationItem, RedUCB1Arm, RedUCB1Response } from "@/lib/types";

export const Route = createFileRoute("/adaptive")({
  head: () => ({
    meta: [
      { title: "Adaptive Intelligence — PayGuard AI" },
      { name: "description", content: "UCB1 multi-armed bandit attack selector and mutation fuzzing catalog." },
      { property: "og:title", content: "Adaptive Intelligence — PayGuard AI" },
      { property: "og:description", content: "UCB1 adaptive attack strategy exploration and fuzzing vectors." },
    ],
  }),
  component: AdaptiveIntelligence,
});

interface ArmWithDetails {
  attackId: string;
  pulls: number;
  totalReward?: number;
  avgReward?: number;
  ucbScore?: number | null;
  reward?: number;
  score?: number;
}

function AdaptiveIntelligence() {
  const { demo, services, toast } = useStore();
  const [ucb1Data, setUcb1Data] = useState<RedUCB1Response | null>(null);
  const [fuzzerData, setFuzzerData] = useState<RedFuzzerCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fuzzerSearch, setFuzzerSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const loadData = async () => {
    setLoading(true);
    try {
      const [ucb, fuz] = await Promise.all([
        getUCB1State(demo).catch(() => null),
        getFuzzerCatalog(demo).catch(() => null),
      ]);
      if (ucb) setUcb1Data(ucb);
      if (fuz) setFuzzerData(fuz);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [demo]);

  const handlePullArm = async () => {
    setPulling(true);
    try {
      const res = await postRedRun({ useUCB1: true }, demo);
      toast(`UCB1 dispatched: ${res.attackId ?? "adaptive arm"}`, "safe");
      await new Promise((r) => setTimeout(r, 1500));
      await loadData();
    } catch (err) {
      toast(`UCB1 dispatch failed: ${err instanceof Error ? err.message : String(err)}`, "danger");
    } finally {
      setPulling(false);
    }
  };

  const arms = (ucb1Data?.ucb1?.arms ?? []) as ArmWithDetails[];
  const totalPulls = ucb1Data?.ucb1?.totalPulls ?? 0;
  const nextTarget = ucb1Data?.nextRecommended ?? "A01_OVERPAY";
  const mutations = fuzzerData?.mutations ?? [];

  const categories = ["ALL", ...Array.from(new Set(mutations.map((m) => m.category)))];

  const filteredMutations = mutations.filter((m) => {
    if (categoryFilter !== "ALL" && m.category !== categoryFilter) return false;
    if (fuzzerSearch.trim()) {
      const q = fuzzerSearch.toLowerCase();
      return (
        m.mutationId.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.mutatedFields.some((f) => f.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Adaptive Intelligence" sub="UCB1 multi-armed bandit & adversarial mutation engine // Red Engine :4060" />
        <div className="flex items-center gap-2 mb-4">
          {demo ? (
            <Chip tone="warn">SYNTHETIC UCB1 (DEMO)</Chip>
          ) : (
            <Chip tone={services.red ? "safe" : "danger"}>
              RED ENGINE {services.red ? "ONLINE" : "OFFLINE"} (:4060)
            </Chip>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 font-mono">
        <Card title="Total Bandit Pulls">
          <div className="text-3xl font-bold text-accent">{totalPulls}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Exploration & exploitation rounds</div>
        </Card>

        <Card title="Armed Strategies">
          <div className="text-3xl font-bold text-foreground">{arms.length || 9}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Adversarial attack arms</div>
        </Card>

        <Card title="Optimal Recommendation">
          <div className="text-lg font-bold text-warn truncate" title={nextTarget}>
            {nextTarget}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Highest exploration-exploitation bound</div>
        </Card>

        <Card title="Mutation Vectors">
          <div className="text-3xl font-bold text-safe">{fuzzerData?.totalMutations ?? 27}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Deterministic fuzzing permutations</div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-4">
        {/* Bandit Arms Table Card */}
        <Card
          className="col-span-3"
          title="UCB1 Strategy Arms & Observed Rewards"
          icon={<Compass className="h-3.5 w-3.5 text-accent" />}
          right={
            <div className="flex items-center gap-2">
              <Btn tone="ghost" className="py-1" onClick={loadData} disabled={loading}>
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </Btn>
              <Btn tone="ml" className="py-1" onClick={handlePullArm} disabled={pulling}>
                <Play className={`h-3 w-3 mr-1 ${pulling ? "animate-spin" : ""}`} />
                Pull Optimal Arm
              </Btn>
            </div>
          }
        >
          <table className="w-full font-mono text-[11px]">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">Attack Strategy</th>
                <th>Pulls</th>
                <th>Total Reward</th>
                <th>Avg Reward</th>
                <th>UCB1 Score</th>
                <th className="text-right">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => {
                const isOptimal = arm.attackId === nextTarget;
                const scoreDisplay =
                  arm.ucbScore !== null && arm.ucbScore !== undefined
                    ? arm.ucbScore === Infinity
                      ? "∞ (explore)"
                      : Number(arm.ucbScore).toFixed(3)
                    : arm.score !== undefined
                    ? Number(arm.score).toFixed(3)
                    : "—";

                const avgDisplay =
                  arm.avgReward !== undefined
                    ? Number(arm.avgReward).toFixed(3)
                    : arm.reward !== undefined
                    ? Number(arm.reward).toFixed(3)
                    : "0.000";

                return (
                  <tr
                    key={arm.attackId}
                    className={clsx("border-b hover:bg-panel transition", isOptimal && "bg-accent/5 font-semibold")}
                  >
                    <td className="py-2.5 text-foreground">{arm.attackId}</td>
                    <td>{arm.pulls}</td>
                    <td>{arm.totalReward ?? arm.reward ?? 0}</td>
                    <td>{avgDisplay}</td>
                    <td className="text-accent">{scoreDisplay}</td>
                    <td className="text-right">
                      {isOptimal ? (
                        <Chip tone="warn" className="text-[10px]">
                          TARGET
                        </Chip>
                      ) : arm.pulls === 0 ? (
                        <Chip tone="accent" className="text-[10px]">
                          UNEXPLORED
                        </Chip>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">EVALUATED</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {arms.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground font-mono">
                    Awaiting UCB1 bandit arms from Red Engine :4060...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* Bandit Logic Summary */}
        <Card className="col-span-2" title="Bandit Mathematics" icon={<Cpu className="h-3.5 w-3.5 text-accent" />}>
          <div className="space-y-3 font-mono text-xs text-muted-foreground">
            <div className="rounded border bg-background p-3">
              <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">Upper Confidence Bound (UCB1)</div>
              <div className="mt-1 text-sm font-bold text-foreground">
                Q(a) + c × √( ln(N) / N(a) )
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed">
                Balances exploiting successful attack bypasses (Q) with exploring less frequently tested scenarios (N).
              </p>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between border-b pb-1">
                <span>Exploration Constant (c):</span>
                <span className="text-foreground">√2 ≈ 1.414</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>Initial Arm Score:</span>
                <span className="text-safe">∞ (Force Exploration)</span>
              </div>
              <div className="flex justify-between border-b pb-1">
                <span>Reward Metric:</span>
                <span className="text-foreground">1 for Bypass, 0 for Block</span>
              </div>
              <div className="flex justify-between">
                <span>Target Engine:</span>
                <span className="text-accent">Red Team Console :4060</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Mutation Fuzzer Catalog */}
      <Card className="mt-4" title="Deterministic Mutation Fuzzer Catalog" icon={<Dices className="h-3.5 w-3.5 text-accent" />}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded border bg-background px-3 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search mutations by field, ID, or description..."
              value={fuzzerSearch}
              onChange={(e) => setFuzzerSearch(e.target.value)}
              className="w-full bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center gap-1 font-mono text-[11px]">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={clsx(
                  "rounded border px-2 py-1 transition",
                  categoryFilter === cat
                    ? "border-accent bg-accent/10 text-accent font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
          {filteredMutations.map((m) => (
            <div
              key={m.mutationId}
              className="rounded border bg-background p-2.5 font-mono text-xs hover:border-accent/40 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-accent text-[11px]">{m.mutationId}</span>
                  <Chip tone="accent" className="text-[9px] uppercase">
                    {m.category}
                  </Chip>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{m.description}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {m.mutatedFields.map((f) => (
                  <span key={f} className="rounded border bg-card px-1.5 py-0.5 text-[9px] text-foreground">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {filteredMutations.length === 0 && (
            <div className="col-span-3 py-8 text-center font-mono text-xs text-muted-foreground">
              No matching mutation patterns found.
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
