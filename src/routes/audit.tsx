import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Download, Search } from "lucide-react";
import { getLedger } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Addr, Btn, Card, Json, MLChip, PageTitle, StatusChip, short } from "@/components/ws/ui";

const ledgerQuery = queryOptions({ queryKey: ["ledger"], queryFn: getLedger });
const PAGE = 12;

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log — WalletShield" },
      { name: "description", content: "Searchable, exportable ledger of every firewall security decision." },
      { property: "og:title", content: "Audit Log — WalletShield" },
      { property: "og:description", content: "Searchable ledger of security decisions." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(ledgerQuery),
  component: Audit,
});

function Audit() {
  const { data } = useSuspenseQuery(ledgerQuery);
  const live = useStore((s) => s.decisions);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const all = [...live, ...data].filter((d) => JSON.stringify(d).toLowerCase().includes(q.toLowerCase()));
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const rows = all.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const head = "timestamp,merchant,amount,decision,reason,ml_score,intent_token";
    const body = all.map((d) => [new Date(d.timestamp).toISOString(), d.merchant, d.amount, d.status, d.reason ?? "", d.ml_score, d.intent_token].join(","));
    const url = URL.createObjectURL(new Blob([[head, ...body].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "walletshield-ledger.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageTitle title="Audit Log" sub="GET /ledger // append-only" />
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded border bg-background px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search merchant, reason, hash..." className="w-full bg-transparent py-2 font-mono text-xs outline-none placeholder:text-muted-foreground" />
          </div>
          <Btn onClick={exportCsv}><Download className="h-3.5 w-3.5" />Export CSV</Btn>
        </div>
        <table className="w-full font-mono text-[11px]">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b"><th className="py-2">Timestamp</th><th>Merchant</th><th>Amount</th><th>Decision</th><th>Reason</th><th>ML Score</th><th>IntentToken</th></tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <Fragment key={d.id}>
                <tr onClick={() => setOpen(open === d.id ? null : d.id)} className="cursor-pointer border-b hover:bg-panel">
                  <td className="py-2" suppressHydrationWarning>{new Date(d.timestamp).toLocaleTimeString()}</td><td>{d.merchant}</td><td>${d.amount.toFixed(3)}</td>
                  <td><StatusChip status={d.status} /></td><td className="text-danger">{d.reason ?? ""}</td><td><MLChip score={d.ml_score} /></td>
                  <td><Addr className="text-muted-foreground" text={short(d.intent_token, 8, 4)} /></td>
                </tr>
                {open === d.id && <tr><td colSpan={7} className="py-2"><Json data={d} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-end gap-2 font-mono text-[11px] text-muted-foreground">
          <Btn tone="ghost" className="py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Btn>
          {page + 1} / {pages}
          <Btn tone="ghost" className="py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Btn>
        </div>
      </Card>
    </>
  );
}
