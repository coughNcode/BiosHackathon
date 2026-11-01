import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Lock, Plus, ShieldCheck, Users, Wallet } from "lucide-react";
import { getPolicy } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Addr, Btn, Card, Chip, PageTitle, short } from "@/components/ws/ui";

const policyQuery = queryOptions({
  queryKey: ["policy"],
  queryFn: () => getPolicy(useStore.getState().demo),
});

export const Route = createFileRoute("/policy")({
  head: () => ({
    meta: [
      { title: "Policy — PayGuard AI" },
      { name: "description", content: "Spending limits and trusted payment providers enforced by PayGuard AI firewall." },
      { property: "og:title", content: "Policy — PayGuard AI" },
      { property: "og:description", content: "Deterministic spending limits and trusted providers." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(policyQuery),
  component: PolicyPage,
});

function PolicyPage() {
  const { data } = useSuspenseQuery(policyQuery);
  const { demo, services } = useStore();
  const l = data.limits;
  const rows = [
    ["Daily budget", l.daily_budget],
    ["Per-request max", l.per_request_max],
    ["Per-merchant daily cap", l.per_merchant_daily],
    ["Approval threshold", l.approval_threshold],
  ] as const;

  return (
    <>
      <div className="flex items-center justify-between">
        <PageTitle title="Policy Engine" sub="read-only policy contract // Blue Agent GET /policy & /providers" />
        <div className="flex items-center gap-2 mb-4">
          {demo ? (
            <Chip tone="warn">SYNTHETIC POLICY (DEMO)</Chip>
          ) : (
            <Chip tone={services.blue ? "safe" : "danger"}>
              BLUE AGENT {services.blue ? "ENFORCING" : "OFFLINE"} (:4010)
            </Chip>
          )}
        </div>
      </div>

      <Card title="Spending Limits & Invariants" icon={<Wallet className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-4 gap-4">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded border bg-background p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="mt-1 font-mono text-xl text-accent">${v.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        className="mt-4"
        title="Trusted Merchant Registry"
        icon={<Users className="h-3.5 w-3.5" />}
        right={
          <span title="Controlled via config/trusted-providers.json">
            <Btn tone="ghost" disabled>
              <Lock className="h-3 w-3 mr-1" />
              Admin Key Protected
            </Btn>
          </span>
        }
      >
        <table className="w-full font-mono text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2">Domain</th>
              <th>Expected Payee Wallet</th>
              <th>Network</th>
              <th>Asset</th>
              <th>Max Allowance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.domain} className="border-b last:border-0 hover:bg-panel">
                <td className="py-3 font-semibold text-foreground">{p.domain}</td>
                <td>
                  <Addr text={short(p.wallet, 8, 6)} />
                </td>
                <td>{p.network}</td>
                <td>{p.token}</td>
                <td className="text-accent">${p.max.toFixed(2)}</td>
                <td className="text-right">
                  <Chip tone="safe">TRUSTED</Chip>
                </td>
              </tr>
            ))}
            {data.providers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  No trusted providers registered. Any payment attempt will be blocked by recipient_guard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
