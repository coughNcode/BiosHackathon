/**
 * Red Team Unified Orchestrator (npm run red).
 *
 * Starts all three Red Team services on Laptop B in a single process:
 *   - Hostile Merchant on port 4020 (MERCHANT_PORT)
 *   - Mock Facilitator on port 4030 (FACILITATOR_PORT)
 *   - Red Console on port 4060 (RED_CONSOLE_PORT)
 *
 * Implements graceful shutdown on SIGINT / SIGTERM.
 */
import type { Server } from "node:http";
import { RED_CONFIG } from "./config.js";
import { createMerchantApp } from "./merchant.js";
import { createFacilitatorApp } from "./facilitator.js";
import { createConsoleApp } from "./console.js";
import { SCENARIO_CATALOG } from "./scenarios.js";

interface RunningService {
  name: string;
  port: number;
  server: Server;
}

export async function startRedServices(): Promise<RunningService[]> {
  console.log("\n=======================================================");
  console.log("  🔴 PayGuard AI — Red Team Attack Environment (Laptop B)");
  console.log("=======================================================");
  console.log(`  Bind Host:      ${RED_CONFIG.host}`);
  console.log(`  Blue Target:    ${RED_CONFIG.blueUrl}`);
  console.log(`  Mock Chain:     ${RED_CONFIG.mockChainUrl}`);
  console.log(`  Collector:      ${RED_CONFIG.collectorUrl}`);
  console.log(`  Scenarios:      ${SCENARIO_CATALOG.length} (A01–A10)`);
  console.log("-------------------------------------------------------\n");

  const merchantApp = createMerchantApp();
  const facilitatorApp = createFacilitatorApp();
  const consoleApp = createConsoleApp();

  const services: RunningService[] = [];

  // Start Merchant
  const merchantServer = await new Promise<Server>((resolve, reject) => {
    const s = merchantApp.listen(RED_CONFIG.merchantPort, RED_CONFIG.host, () => {
      console.log(`  [1/3] Hostile Merchant online at http://${RED_CONFIG.host}:${RED_CONFIG.merchantPort}`);
      resolve(s);
    });
    s.on("error", reject);
  });
  services.push({ name: "Hostile Merchant", port: RED_CONFIG.merchantPort, server: merchantServer });

  // Start Facilitator
  const facilitatorServer = await new Promise<Server>((resolve, reject) => {
    const s = facilitatorApp.listen(RED_CONFIG.facilitatorPort, RED_CONFIG.host, () => {
      console.log(`  [2/3] Mock Facilitator online at http://${RED_CONFIG.host}:${RED_CONFIG.facilitatorPort}`);
      resolve(s);
    });
    s.on("error", reject);
  });
  services.push({ name: "Mock Facilitator", port: RED_CONFIG.facilitatorPort, server: facilitatorServer });

  // Start Red Console
  const consoleServer = await new Promise<Server>((resolve, reject) => {
    const s = consoleApp.listen(RED_CONFIG.consolePort, RED_CONFIG.host, () => {
      console.log(`  [3/3] Red Console online at http://${RED_CONFIG.host}:${RED_CONFIG.consolePort}`);
      resolve(s);
    });
    s.on("error", reject);
  });
  services.push({ name: "Red Console", port: RED_CONFIG.consolePort, server: consoleServer });

  console.log("\n✅ All 3 Red services active and listening.");
  console.log("   Ready to launch attacks against Blue firewall.\n");

  return services;
}

// Check if run directly
const isDirectRun = Boolean(process.argv[1] && /start\.[jt]s$/i.test(process.argv[1]));

if (isDirectRun) {
  startRedServices().then((services) => {
    const shutdown = () => {
      console.log("\n🛑 Shutting down Red Team services...");
      for (const service of services) {
        service.server.close();
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((err) => {
    console.error("❌ Failed to start Red Team services:", err);
    process.exit(1);
  });
}

