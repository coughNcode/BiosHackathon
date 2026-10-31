/**
 * Hostile Merchant — Red Team attack payload server.
 *
 * Port: MERCHANT_PORT (default 4020).
 * Serves x402 payment requirements for each attack scenario. The /mode
 * endpoint switches the default scenario returned by GET /payment-required.
 *
 * All addresses are DEMO TEST-ONLY FIXTURES.
 */
import "dotenv/config";
import express from "express";
import { RED_CONFIG } from "./config.js";
import { corsMiddleware } from "./cors.js";
import {
  SCENARIOS,
  SCENARIO_CATALOG,
  getScenario,
  getCatalogEntry,
  isSimplePayload,
  isTOCTOU,
  isSequential,
} from "./scenarios.js";

export function createMerchantApp() {
  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);

  let currentMode = "A10_VALID";

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "red-merchant", port: RED_CONFIG.merchantPort });
  });

  // ── Scenario Catalog ────────────────────────────────────────────────────────

  app.get("/scenarios", (_req, res) => {
    res.json({
      scenarios: SCENARIO_CATALOG,
      currentMode,
      availableIds: Object.keys(SCENARIOS),
    });
  });

  // ── Payment Required (GET — uses current mode) ─────────────────────────────

  app.get("/payment-required", (req, res) => {
    const rawId = (req.query.scenario as string) ?? currentMode;
    const scenario = getScenario(rawId);

    if (!scenario) {
      res.status(400).json({
        error: "UNKNOWN_SCENARIO",
        hint: `Valid scenario IDs: ${Object.keys(SCENARIOS).join(", ")} or aliases (e.g. VALID, OVERPAY, A01..A10)`,
      });
      return;
    }

    const payload = extractPayload(scenario);
    const catalog = getCatalogEntry(rawId);

    // Return both direct requirement fields (for direct consumption) and wrapped payload
    if (isSimplePayload(scenario)) {
      res.json({
        ...scenario,
        scenarioId: catalog?.id ?? rawId,
        paymentRequirements: payload,
        metadata: catalog ?? null,
        mock: true,
      });
    } else {
      res.json({
        scenarioId: catalog?.id ?? rawId,
        paymentRequirements: payload,
        metadata: catalog ?? null,
        mock: true,
      });
    }
  });

  // ── Payment Required (POST — explicit scenario) ────────────────────────────

  app.post("/payment-required", (req, res) => {
    const { scenario: rawId } = req.body as { scenario?: string };

    if (!rawId) {
      res.status(400).json({
        error: "BAD_REQUEST",
        hint: 'POST { "scenario": "A01_OVERPAY" } or { "scenario": "VALID" }',
      });
      return;
    }

    const scenario = getScenario(rawId);
    if (!scenario) {
      res.status(400).json({
        error: "UNKNOWN_SCENARIO",
        hint: `Valid scenario IDs: ${Object.keys(SCENARIOS).join(", ")} or aliases (e.g. VALID, OVERPAY, A01..A10)`,
      });
      return;
    }

    const payload = extractPayload(scenario);
    const catalog = getCatalogEntry(rawId);

    if (isSimplePayload(scenario)) {
      res.json({
        ...scenario,
        scenarioId: catalog?.id ?? rawId,
        paymentRequirements: payload,
        metadata: catalog ?? null,
        mock: true,
      });
    } else {
      res.json({
        scenarioId: catalog?.id ?? rawId,
        paymentRequirements: payload,
        metadata: catalog ?? null,
        mock: true,
      });
    }
  });

  // ── Mode Switch ─────────────────────────────────────────────────────────────

  app.post("/mode", (req, res) => {
    const { scenario: rawId } = req.body as { scenario?: string };

    if (!rawId) {
      res.status(400).json({
        error: "INVALID_MODE",
        hint: `Valid modes: ${Object.keys(SCENARIOS).join(", ")} or aliases (VALID, OVERPAY)`,
        currentMode,
      });
      return;
    }

    const scenario = getScenario(rawId);
    const catalog = getCatalogEntry(rawId);
    if (!scenario || !catalog) {
      res.status(400).json({
        error: "INVALID_MODE",
        hint: `Valid modes: ${Object.keys(SCENARIOS).join(", ")} or aliases (VALID, OVERPAY)`,
        currentMode,
      });
      return;
    }

    const previousMode = currentMode;
    currentMode = catalog.id;

    res.json({
      previousMode,
      currentMode,
      message: `Merchant mode switched to ${currentMode}`,
    });
  });

  return app;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractPayload(scenario: ReturnType<typeof getScenario>) {
  if (!scenario) return null;

  if (isSimplePayload(scenario)) {
    return scenario;
  }

  if (isTOCTOU(scenario)) {
    return {
      _type: "toctou",
      initialReq: scenario.initialReq,
      mutatedReq: scenario.mutatedReq,
      note: "TOCTOU attack: submit initialReq for approval, then sign with mutatedReq",
    };
  }

  if (isSequential(scenario)) {
    return {
      _type: "sequential",
      req: scenario.req,
      repeatUntilBlocked: scenario.repeatUntilBlocked,
      maxAttempts: scenario.maxAttempts,
      note: "Budget exhaustion: send req repeatedly until Blue blocks",
    };
  }

  return scenario;
}

// ── Start ───────────────────────────────────────────────────────────────────

const isDirectRun = Boolean(process.argv[1] && /merchant\.[jt]s$/i.test(process.argv[1]));

if (isDirectRun) {
  const app = createMerchantApp();
  app.listen(RED_CONFIG.merchantPort, RED_CONFIG.host, () => {
    console.log(`\n🔴 Red Hostile Merchant on http://${RED_CONFIG.host}:${RED_CONFIG.merchantPort}`);
    console.log(`   Scenarios: ${Object.keys(SCENARIOS).length}`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     GET  /scenarios`);
    console.log(`     GET  /payment-required?scenario=<id>`);
    console.log(`     POST /payment-required { scenario: "<id>" }`);
    console.log(`     POST /mode { scenario: "<id>" }\n`);
  });
}

