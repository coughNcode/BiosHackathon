import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Users, Wallet } from "lucide-react";
import { getPolicy } from "@/lib/api";
import { Addr, Btn, Card, Chip, PageTitle, short } from "@/components/ws/ui";

const policyQuery = queryOptions({ queryKey: ["policy"], queryFn: getPolicy });

export const Route = createFileRoute("/policy")({
  head: () => ({
    meta: [
      { title: "Policy — WalletShield" },
      { name: "description", content: "Spending limits and trusted payment providers enforced by the firewall." },
      { property: "og:title", content: "Policy — WalletShield" },
      { property: "og:description", content: "Spending limits and trusted providers." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(policyQuery),
  component: PolicyPage,
});

function PolicyPage() {
  const { data } = useSuspenseQuery(policyQuery);
  const l = data.limits;
  const rows = [
    ["Daily budget", l.daily_budget], ["Per-request max", l.per_request_max],
    ["Per-merchant daily cap", l.per_merchant_daily], ["Approval threshold", l.approval_threshold],
  ] as const;
  return (
    <>
      <PageTitle title="Policy" sub="read-only // GET /policy" />
      <Card title="Spending Limits" icon={<Wallet className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-4 gap-4">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded border bg-background p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="mt-1 font-mono text-xl text-accent">${v.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="mt-4" title="Trusted Providers" icon={<Users className="h-3.5 w-3.5" />}
        right={<span title="Edit config/trusted-providers.json"><Btn tone="ghost" disabled><Plus className="h-3 w-3" />Add Provider</Btn></span>}>
        <table className="w-full font-mono text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b"><th className="py-2">Domain</th><th>Expected Wallet</th><th>Network</th><th>Token</th><th>Max Amount</th><th /></tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.domain} className="border-b last:border-0">
                <td className="py-3">{p.domain}</td><td><Addr text={short(p.wallet, 6)} /></td><td>{p.network}</td><td>{p.token}</td><td>${p.max}</td>
                <td className="text-right"><Chip tone="safe">TRUSTED</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
