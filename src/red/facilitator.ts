/**
 * Mock x402 Facilitator — Red Team payment verification & settlement stub.
 *
 * Port: FACILITATOR_PORT (default 4030).
 *
 * Implements the x402 facilitator endpoints (/verify, /settle) with
 * controllable failure modes for testing Blue's resilience. Modes:
 *   normal       — always succeeds
 *   fail_verify  — verification always fails
 *   fail_settle  — settlement always fails
 *   timeout      — delays response by 10 seconds
 *   malformed    — returns invalid JSON structure
 *
 * Protocol version: x402 V1 (matching the existing repo — see audit).
 * Header: X-Facilitator-Type: mock is always set.
 * Settlement transactions are clearly labelled as mock data.
 */
import "dotenv/config";
import express from "express";
import { RED_CONFIG } from "./config.js";
import { corsMiddleware } from "./cors.js";
import { emitEvent } from "./events.js";
import type { FacilitatorMode } from "./types.js";

export function createFacilitatorApp() {
  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);

  // Always identify as mock facilitator
  app.use((_req, res, next) => {
    res.setHeader("X-Facilitator-Type", "mock");
    next();
  });

  let currentMode: FacilitatorMode = "normal";

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "red-facilitator",
      port: RED_CONFIG.facilitatorPort,
      mode: currentMode,
    });
  });

  // ── Supported ───────────────────────────────────────────────────────────────

  app.get("/supported", (_req, res) => {
    res.json({
      x402Version: 1,
      schemes: ["exact"],
      networks: ["base-sepolia"],
    });
  });

  // ── Verify ──────────────────────────────────────────────────────────────────

  app.post("/verify", async (req, res) => {
    switch (currentMode) {
      case "normal":
        res.json({ isValid: true });
        return;

      case "fail_verify":
        res.json({ isValid: false, invalidReason: "verification_failed" });
        return;

      case "timeout":
        await delay(10000);
        res.json({ isValid: true });
        return;

      case "malformed":
        res.status(200).send("THIS IS NOT VALID JSON {{{");
        return;

      case "fail_settle":
        // Verify succeeds even in fail_settle mode
        res.json({ isValid: true });
        return;

      default:
        res.json({ isValid: true });
    }
  });

  // ── Settle ──────────────────────────────────────────────────────────────────

  app.post("/settle", async (req, res) => {
    switch (currentMode) {
      case "normal":
      case "fail_verify":
        // Settlement succeeds — mock transaction hash, clearly labelled as mock.
        res.json({
          success: true,
          transaction: `0xMOCK_${Date.now().toString(16)}`,
          network: "base-sepolia",
          payer: "0xMOCK_PAYER",
          mock: true,
        });
        return;

      case "fail_settle":
        res.json({
          success: false,
          errorReason: "settlement_failed",
          mock: true,
        });
        return;

      case "timeout":
        await delay(10000);
        res.json({
          success: true,
          transaction: `0xMOCK_DELAYED_${Date.now().toString(16)}`,
          network: "base-sepolia",
          payer: "0xMOCK_PAYER",
          mock: true,
        });
        return;

      case "malformed":
        res.status(200).send("NOT_JSON_SETTLE_RESPONSE!!!");
        return;

      default:
        res.json({
          success: true,
          transaction: `0xMOCK_${Date.now().toString(16)}`,
          network: "base-sepolia",
          mock: true,
        });
    }
  });

  // ── Mode Switch ─────────────────────────────────────────────────────────────

  app.post("/mode", async (req, res) => {
    const { mode: newMode } = req.body as { mode?: string };
    const validModes: FacilitatorMode[] = [
      "normal",
      "fail_verify",
      "fail_settle",
      "timeout",
      "malformed",
    ];

    if (!newMode || !validModes.includes(newMode as FacilitatorMode)) {
      res.status(400).json({
        error: "INVALID_MODE",
        hint: `Valid modes: ${validModes.join(", ")}`,
        currentMode,
      });
      return;
    }

    const previousMode = currentMode;
    currentMode = newMode as FacilitatorMode;

    await emitEvent({
      source: "RED",
      eventType: "FACILITATOR_MODE_CHANGED",
      runId: `mode_${Date.now().toString(36)}`,
      data: { previousMode, currentMode },
    });

    res.json({
      previousMode,
      currentMode,
      message: `Facilitator mode switched to ${currentMode}`,
    });
  });

  return app;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Start ───────────────────────────────────────────────────────────────────

const isDirectRun = Boolean(process.argv[1] && /facilitator\.[jt]s$/i.test(process.argv[1]));

if (isDirectRun) {
  const app = createFacilitatorApp();
  app.listen(RED_CONFIG.facilitatorPort, RED_CONFIG.host, () => {
    console.log(`\n🔴 Red Mock Facilitator on http://${RED_CONFIG.host}:${RED_CONFIG.facilitatorPort}`);
    console.log(`   Protocol: x402 V1 (matching existing repo)`);
    console.log(`   Header: X-Facilitator-Type: mock`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     GET  /supported`);
    console.log(`     POST /verify`);
    console.log(`     POST /settle`);
    console.log(`     POST /mode { mode: "normal" | "fail_verify" | ... }\n`);
  });
}

