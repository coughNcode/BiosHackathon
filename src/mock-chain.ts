import "dotenv/config";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { emitEvent, buildEvent } from "./event-emitter.js";

/**
 * Mock Chain — independent settlement ledger for PayGuard AI.
 *
 * Runs on port 4040 as a SEPARATE Express app.
 * This is the INDEPENDENT SOURCE OF TRUTH for fund transfers.
 * It does NOT share state with the Blue Agent.
 *
 * All balances use BigInt internally but are serialized as string in
 * API responses since BigInt is not JSON-serializable.
 *
 * All responses include `"mockChain": true` to clearly label mock data.
 */

const MOCK_CHAIN_PORT = Number(process.env.MOCK_CHAIN_PORT || 4040);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-key";

const DEMO_BALANCES: Record<string, bigint> = {
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": BigInt("1000000"),  // 1.00 USDC
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": BigInt("500000"),   // 0.50 USDC
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": BigInt("2000000"),  // 2.00 USDC (agent/payer)
};

let balances: Record<string, bigint> = {};

interface Transaction {
  txId: string;
  from: string;
  to: string;
  amount: string;
  network: string;
  status: "settled" | "pending" | "failed";
  runId: string | null;
  timestamp: string;
  error: string | null;
}

const transactions: Transaction[] = [];

function resetBalances(): void {
  balances = {};
  for (const [addr, amount] of Object.entries(DEMO_BALANCES)) {
    balances[addr.toLowerCase()] = amount;
  }
}

resetBalances();

const app = express();
app.use(express.json());

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGINS || "https://*.lovable.app,http://localhost:5173,http://localhost:3000,http://localhost:8080,http://127.0.0.1:8080")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = allowedOrigins.some((o) =>
        o.includes("*") ? origin.endsWith(o.replace("*.", "").replace("*", "")) : origin === o,
      );
      cb(null, allowed);
    },
    credentials: false,
  }),
);

// ── GET /health ──────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mock-chain",
    port: MOCK_CHAIN_PORT,
    timestamp: new Date().toISOString(),
    mockChain: true,
  });
});

// ── GET /ledger ──────────────────────────────────────────────────────────

app.get("/ledger", (_req, res) => {
  const entries = Object.entries(balances).map(([address, balance]) => ({
    address,
    balance: balance.toString(),
  }));
  res.json({ balances: entries, mockChain: true });
});

// ── GET /transactions ────────────────────────────────────────────────────

app.get("/transactions", (req, res) => {
  let filtered = [...transactions];
  const status = req.query.status as string | undefined;
  const address = req.query.address as string | undefined;

  if (status) {
    filtered = filtered.filter((tx) => tx.status === status);
  }
  if (address) {
    const addr = address.toLowerCase();
    filtered = filtered.filter((tx) => tx.from === addr || tx.to === addr);
  }

  res.json({ transactions: filtered, mockChain: true });
});

// ── GET /transfers ───────────────────────────────────────────────────────

app.get("/transfers", (req, res) => {
  const runId = req.query.runId as string | undefined;
  if (!runId) {
    const settled = transactions.filter((tx) => tx.status === "settled");
    res.json({
      transferred: settled.length > 0,
      txHash: settled[0]?.txId ?? null,
      transactions: settled,
      mockChain: true,
    });
    return;
  }

  const tx = transactions.find((t) => t.runId === runId && t.status === "settled");
  res.json({
    transferred: !!tx,
    txHash: tx ? tx.txId : null,
    transaction: tx ?? null,
    mockChain: true,
  });
});

// ── POST /transactions/execute ───────────────────────────────────────────

app.post("/transactions/execute", async (req, res) => {
  const { from, to, amount, network, runId } = req.body ?? {};

  if (!from || !to || !amount || !network) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: from, to, amount, network",
      mockChain: true,
    });
    return;
  }

  const fromAddr = from.toLowerCase();
  const toAddr = to.toLowerCase();
  const txId = `tx_${uuidv4()}`;
  const timestamp = new Date().toISOString();
  const currentRunId = runId ?? null;

  let transferAmount: bigint;
  try {
    transferAmount = BigInt(amount);
  } catch {
    const failedTx: Transaction = {
      txId,
      from: fromAddr,
      to: toAddr,
      amount: String(amount),
      network,
      status: "failed",
      runId: currentRunId,
      timestamp,
      error: "Invalid amount: not a valid integer",
    };
    transactions.push(failedTx);

    emitEvent(buildEvent("CHAIN", "NO_TRANSFER", "HIGH", `Transfer failed: invalid amount`, {
      txId, from: fromAddr, to: toAddr, amount: String(amount), error: failedTx.error,
    }, currentRunId ?? txId)).catch(() => {});

    res.status(400).json({ success: false, txId, error: failedTx.error, mockChain: true });
    return;
  }

  if (transferAmount <= 0n) {
    const failedTx: Transaction = {
      txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(),
      network, status: "failed", runId: currentRunId, timestamp,
      error: "Amount must be positive",
    };
    transactions.push(failedTx);

    emitEvent(buildEvent("CHAIN", "NO_TRANSFER", "HIGH", `Transfer failed: non-positive amount`, {
      txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(), error: failedTx.error,
    }, currentRunId ?? txId)).catch(() => {});

    res.status(400).json({ success: false, txId, error: failedTx.error, mockChain: true });
    return;
  }

  const fromBalance = balances[fromAddr] ?? 0n;
  if (fromBalance < transferAmount) {
    const failedTx: Transaction = {
      txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(),
      network, status: "failed", runId: currentRunId, timestamp,
      error: `Insufficient balance: has ${fromBalance.toString()}, needs ${transferAmount.toString()}`,
    };
    transactions.push(failedTx);

    emitEvent(buildEvent("CHAIN", "NO_TRANSFER", "HIGH", `Transfer failed: insufficient balance`, {
      txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(), error: failedTx.error,
    }, currentRunId ?? txId)).catch(() => {});

    res.status(400).json({ success: false, txId, error: failedTx.error, mockChain: true });
    return;
  }

  // Execute the transfer
  balances[fromAddr] = fromBalance - transferAmount;
  balances[toAddr] = (balances[toAddr] ?? 0n) + transferAmount;

  const settledTx: Transaction = {
    txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(),
    network, status: "settled", runId: currentRunId, timestamp,
    error: null,
  };
  transactions.push(settledTx);

  emitEvent(buildEvent("CHAIN", "FUNDS_TRANSFERRED", "LOW", `Transfer settled: ${transferAmount.toString()} from ${fromAddr} to ${toAddr}`, {
    txId, from: fromAddr, to: toAddr, amount: transferAmount.toString(), network,
    fromBalance: (fromBalance - transferAmount).toString(),
    toBalance: (balances[toAddr]).toString(),
  }, currentRunId ?? txId)).catch(() => {});

  res.json({
    success: true,
    txId,
    from: fromAddr,
    to: toAddr,
    amount: transferAmount.toString(),
    network,
    timestamp,
    mockChain: true,
  });
});

// ── POST /balances/reset ─────────────────────────────────────────────────

app.post("/balances/reset", (req, res) => {
  const auth = req.header("Authorization");
  const key = auth?.startsWith("Bearer ") ? auth.slice(7) : req.header("X-Admin-Key");
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: "UNAUTHORIZED", mockChain: true });
    return;
  }

  if (!req.body?.confirm) {
    res.status(400).json({ error: "BAD_REQUEST", hint: "POST { confirm: true }", mockChain: true });
    return;
  }

  resetBalances();
  transactions.length = 0;
  res.json({ reset: true, balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])), mockChain: true });
});

// ── Start Server ────────────────────────────────────────────────────────

let server: any = null;
if (process.env.NODE_ENV !== "test") {
  server = app.listen(MOCK_CHAIN_PORT, HOST, () => {
    console.log(`\n⛓️  Mock Chain on http://${HOST}:${MOCK_CHAIN_PORT}`);
    console.log(`   Demo balances:`);
    for (const [addr, balance] of Object.entries(balances)) {
      console.log(`     ${addr}: ${balance.toString()} atomic USDC ($${(Number(balance) / 1_000_000).toFixed(2)})`);
    }
  });
}

export { app, server, balances, transactions, resetBalances };
