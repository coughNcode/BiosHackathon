import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { DEMO_NAV, TALKING_POINTS } from "@/components/ws/Demo";
import {
  getBluePolicy,
  getBlueProviders,
  getCollectorHealth,
  getCollectorMetrics,
  getFuzzerCatalog,
  getHealth,
  getRedAttacks,
  getRedHealth,
  getUCB1State,
} from "@/lib/api";

describe("PayGuard AI Full-Stack Router", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("registers and matches all 8 application routes", () => {
    const routes = [
      "/",
      "/feed",
      "/lab",
      "/ml",
      "/policy",
      "/audit",
      "/inspector",
      "/adaptive",
    ];

    for (const r of routes) {
      const matches = router.matchRoutes(r);
      expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });

  it("contains demo navigation and talking points for all 8 routes", () => {
    expect(DEMO_NAV).toHaveLength(8);
    for (const route of DEMO_NAV) {
      expect(TALKING_POINTS[route]).toBeDefined();
      expect(TALKING_POINTS[route]?.length).toBeGreaterThan(20);
    }
  });
});

describe("PayGuard AI Typed API Client (Demo Mode Isolation)", () => {
  it("returns isolated synthetic policy fixtures in demo mode", async () => {
    const policy = await getBluePolicy(true);
    expect(policy.dailyBudgetUsd).toBeGreaterThan(0);
    expect(policy.perRequestMaxUsd).toBeGreaterThan(0);
  });

  it("returns isolated synthetic provider fixtures in demo mode", async () => {
    const providers = await getBlueProviders(true);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0]?.domain).toBeDefined();
    expect(providers[0]?.payTo).toMatch(/^0x/);
  });

  it("returns isolated health responses in demo mode", async () => {
    const [blue, red, collector] = await Promise.all([
      getHealth(true),
      getRedHealth(true),
      getCollectorHealth(true),
    ]);
    expect(blue.status).toBe("ok");
    expect(red.status).toBe("ok");
    expect(collector.status).toBe("ok");
  });

  it("returns isolated UCB1 bandit state in demo mode", async () => {
    const ucb1Res = await getUCB1State(true);
    expect(ucb1Res.ucb1.arms.length).toBeGreaterThan(0);
    expect(ucb1Res.nextRecommended).toBeDefined();
  });

  it("returns isolated fuzzer catalog in demo mode", async () => {
    const catalog = await getFuzzerCatalog(true);
    expect(catalog.totalMutations).toBeGreaterThan(0);
    expect(catalog.mutations[0]?.mutatedFields.length).toBeGreaterThan(0);
  });
});
