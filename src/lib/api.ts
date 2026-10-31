import { POLICY, seedDecisions } from "./mock";
import type { Policy, SecurityDecision } from "./types";

// Mock mode is on unless VITE_MOCK_API is explicitly "false".
export const MOCK = import.meta.env["VITE_MOCK_API"] !== "false";
const DAEMON = import.meta.env["VITE_DAEMON_URL"] ?? "http://localhost:4032";
const ML = import.meta.env["VITE_ML_URL"] ?? "http://localhost:4033";

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 200 + Math.random() * 200));

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getHealth = () => (MOCK ? delay({ ok: true }) : req<{ ok: boolean }>(`${DAEMON}/health`));
export const getMLHealth = () => (MOCK ? delay({ ok: true }) : req<{ ok: boolean }>(`${ML}/health`));
export const getPolicy = () => (MOCK ? delay<Policy>(POLICY) : req<Policy>(`${DAEMON}/policy`));
export const getLedger = () =>
  MOCK ? delay<SecurityDecision[]>(seedDecisions(64)) : req<SecurityDecision[]>(`${DAEMON}/ledger`);
export const postPolicyCheck = (body: unknown) => (MOCK ? delay({ ok: true }) : req(`${DAEMON}/policy-check`, post(body)));
export const postVerify = (body: unknown) => (MOCK ? delay({ ok: true }) : req(`${DAEMON}/verify`, post(body)));
export const postMLScore = (features: number[]) =>
  MOCK ? delay({ score: Math.random() }) : req<{ score: number }>(`${ML}/ml-score`, post({ features }));
export const postRetrain = (corpus: unknown) =>
  MOCK ? delay({ model: "XGBClassifier" }) : req<{ model: string }>(`${ML}/retrain`, post({ corpus }));
