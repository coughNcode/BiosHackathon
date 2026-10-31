import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { unlinkSync, existsSync } from "node:fs";
import { CollectorDatabase } from "../src/collector/db.js";
import { createCollectorApp } from "../src/collector/server.js";

const TEST_DB = "./data/test-payguard-collector.db";
const TEST_ADMIN_KEY = "test-admin-secret-key-123";

describe("PayGuard AI Event Collector Integration Tests", () => {
  let server: http.Server;
  let baseUrl: string;
  let db: CollectorDatabase;

  beforeAll(async () => {
    process.env.ADMIN_KEY = TEST_ADMIN_KEY;
    process.env.CORS_ORIGINS = "https://*.lovable.app,http://localhost:5173,http://localhost:3000";

    // Clean any old test database
    if (existsSync(TEST_DB)) {
      try { unlinkSync(TEST_DB); } catch {}
    }
    if (existsSync(`${TEST_DB}-wal`)) {
      try { unlinkSync(`${TEST_DB}-wal`); } catch {}
    }
    if (existsSync(`${TEST_DB}-shm`)) {
      try { unlinkSync(`${TEST_DB}-shm`); } catch {}
    }

    db = new CollectorDatabase(TEST_DB);
    const { app } = createCollectorApp(db);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    if (existsSync(TEST_DB)) {
      try { unlinkSync(TEST_DB); } catch {}
    }
  });

  it("GET /health returns 200 with initial counts", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service: string; eventCount: number; runCount: number };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("collector");
    expect(body.eventCount).toBe(0);
    expect(body.runCount).toBe(0);
  });

  it("Empty dataset returns zeros and null ratios (no NaN or errors)", async () => {
    const metricsRes = await fetch(`${baseUrl}/metrics`);
    expect(metricsRes.status).toBe(200);
    const metrics = await metricsRes.json() as any;
    expect(metrics.totalAttacks).toBe(0);
    expect(metrics.attacksBlocked).toBe(0);
    expect(metrics.detectionRate).toBeNull();
    expect(metrics.avgLatencyMs).toBeNull();
    expect(metrics.p95LatencyMs).toBeNull();

    const scRes = await fetch(`${baseUrl}/scorecard`);
    expect(scRes.status).toBe(200);
    const scorecard = await scRes.json() as any;
    expect(scorecard.TP).toBe(0);
    expect(scorecard.FP).toBe(0);
    expect(scorecard.FN).toBe(0);
    expect(scorecard.TN).toBe(0);
    expect(scorecard.precision).toBeNull();
    expect(scorecard.recall).toBeNull();
    expect(scorecard.f1).toBeNull();
  });

  it("POST /events stores valid event in SQLite and sanitizes secrets", async () => {
    const payload = {
      eventId: "evt-test-1",
      timestamp: "2026-10-31T21:00:00.000Z",
      runId: "run-test-1",
      source: "RED",
      eventType: "ATTACK_STARTED",
      severity: "HIGH",
      attackId: "A01",
      message: "Overpayment attack started",
      data: {
        scenario: "A01",
        amountRequested: "1000000",
        privateKey: "0xsupersecretprivatekey", // Must be sanitized
        signingSecret: "shhh-secret",          // Must be sanitized
      },
    };

    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.received).toBe(true);
    expect(body.eventId).toBe("evt-test-1");

    // Verify stored event in DB
    const stored = db.getEventById("evt-test-1");
    expect(stored).not.toBeNull();
    expect(stored?.source).toBe("RED");
    expect(stored?.data.privateKey).toBe("[REDACTED]");
    expect(stored?.data.signingSecret).toBe("[REDACTED]");
    expect(stored?.data.amountRequested).toBe("1000000");
  });

  it("POST /events handles missing eventId by auto-generating a UUID", async () => {
    const payload = {
      timestamp: new Date().toISOString(),
      source: "BLUE",
      eventType: "PAYMENT_BLOCKED",
      message: "Blocked overpayment",
    };

    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.received).toBe(true);
    expect(body.eventId).toMatch(/^evt_/);
  });

  it("POST /events returns 400 for malformed payload and does not store it", async () => {
    const malformed = {
      // Missing timestamp and eventType and message
      source: "RED",
    };

    const countBefore = db.getCounts().eventCount;

    const res = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(malformed),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe("VALIDATION_ERROR");

    const countAfter = db.getCounts().eventCount;
    expect(countAfter).toBe(countBefore);
  });

  it("Handles duplicate event IDs gracefully (idempotent / upsert)", async () => {
    const payload = {
      eventId: "evt-dup-1",
      timestamp: "2026-10-31T21:05:00.000Z",
      source: "BLUE",
      eventType: "PAYMENT_BLOCKED",
      message: "First attempt",
    };

    const res1 = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);

    // Resend with updated message
    const res2 = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, message: "Second attempt (updated)" }),
    });
    expect(res2.status).toBe(200);

    const stored = db.getEventById("evt-dup-1");
    expect(stored?.message).toBe("Second attempt (updated)");
  });

  it("GET /events returns events with correct filtering and pagination", async () => {
    const res = await fetch(`${baseUrl}/events?source=RED&limit=10`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events.every((e: any) => e.source === "RED")).toBe(true);
  });

  it("Run correlation: tracks full lifecycle, latency, and classification", async () => {
    const runId = "corr-run-101";

    // 1. Attack Started
    await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        attackId: "A02",
        source: "RED",
        eventType: "ATTACK_STARTED",
        timestamp: "2026-10-31T21:10:00.000Z",
        message: "Wrong recipient starting",
      }),
    });

    // 2. Blue validation started
    await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        attackId: "A02",
        source: "BLUE",
        eventType: "PAYMENT_VALIDATION_STARTED",
        timestamp: "2026-10-31T21:10:00.005Z",
        message: "Validating recipient",
      }),
    });

    // 3. Blue blocked
    await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        attackId: "A02",
        source: "BLUE",
        eventType: "PAYMENT_BLOCKED",
        timestamp: "2026-10-31T21:10:00.010Z",
        message: "BLOCKED: PAYTO_MISMATCH",
      }),
    });

    // 4. Attack completed
    await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        attackId: "A02",
        source: "RED",
        eventType: "ATTACK_COMPLETED",
        timestamp: "2026-10-31T21:10:00.020Z",
        message: "Attack completed",
      }),
    });

    // Verify GET /runs/:runId
    const runRes = await fetch(`${baseUrl}/runs/${runId}`);
    expect(runRes.status).toBe(200);
    const runData = await runRes.json() as any;
    expect(runData.run.runId).toBe(runId);
    expect(runData.run.attackId).toBe("A02");
    expect(runData.run.blueDecision).toBe("BLOCK");
    expect(runData.run.classification).toBe("ATTACK_BLOCKED");
    expect(runData.run.latencyMs).toBe(5); // 010ms - 005ms
    expect(runData.events.length).toBe(4);
  });

  it("POST /demo/seed and demo mode isolation", async () => {
    // Seed demo
    const seedRes = await fetch(`${baseUrl}/demo/seed`, { method: "POST" });
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json() as any;
    expect(seedBody.seeded).toBe(true);
    expect(seedBody.count).toBeGreaterThan(0);

    // Live endpoint does NOT return demo events
    const liveEventsRes = await fetch(`${baseUrl}/events`);
    const liveEvents = await liveEventsRes.json() as any;
    expect(liveEvents.events.some((e: any) => e.eventId === "demo-evt-001")).toBe(false);

    // Demo endpoint DOES return demo events
    const demoEventsRes = await fetch(`${baseUrl}/events?demo=true`);
    const demoEvents = await demoEventsRes.json() as any;
    expect(demoEvents.events.some((e: any) => e.eventId === "demo-evt-001")).toBe(true);

    // Demo scorecard returns synthetic flag
    const demoScorecardRes = await fetch(`${baseUrl}/scorecard?demo=true`);
    const demoScorecard = await demoScorecardRes.json() as any;
    expect(demoScorecard._synthetic).toBe(true);
    expect(demoScorecard.TP).toBe(9);
    expect(demoScorecard.TN).toBe(1);
  });

  it("POST /evaluation/reset with scope=demo clears ONLY demo events", async () => {
    const liveCountBefore = db.getCounts().eventCount;

    const resetRes = await fetch(`${baseUrl}/evaluation/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "demo" }),
    });

    expect(resetRes.status).toBe(200);
    const counts = db.getCounts();
    expect(counts.demoEventCount).toBe(0);
    expect(counts.eventCount).toBe(liveCountBefore); // Live events untouched!
  });

  it("POST /evaluation/reset with scope=all requires admin key and confirmation", async () => {
    // 1. Without confirm
    const noConfirm = await fetch(`${baseUrl}/evaluation/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_ADMIN_KEY}`,
      },
      body: JSON.stringify({ scope: "all", confirm: false }),
    });
    expect(noConfirm.status).toBe(400);

    // 2. Without valid key
    const badKey = await fetch(`${baseUrl}/evaluation/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-key",
      },
      body: JSON.stringify({ scope: "all", confirm: true }),
    });
    expect(badKey.status).toBe(401);

    // 3. Valid key and confirm
    const validReset = await fetch(`${baseUrl}/evaluation/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_ADMIN_KEY}`,
      },
      body: JSON.stringify({ scope: "all", confirm: true }),
    });
    expect(validReset.status).toBe(200);

    const counts = db.getCounts();
    expect(counts.eventCount).toBe(0);
    expect(counts.runCount).toBe(0);
  });

  it("Collector restart: persisted events survive new DB instance", async () => {
    // Insert event into current instance
    db.insertEvent({
      eventId: "persist-evt-1",
      timestamp: new Date().toISOString(),
      runId: "persist-run-1",
      source: "TEST",
      eventType: "TEST_EVENT",
      severity: "INFO",
      attackId: "A01",
      message: "Persisted event test",
      data: { test: true },
      receivedAt: new Date().toISOString(),
    });

    // Close and reopen database
    db.close();
    const reopenedDb = new CollectorDatabase(TEST_DB);
    const retrieved = reopenedDb.getEventById("persist-evt-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.message).toBe("Persisted event test");
    reopenedDb.close();

    // Reopen for test tear down
    db = new CollectorDatabase(TEST_DB);
  });

  it("CORS: trusted origin receives allow header, untrusted origin is rejected on OPTIONS", async () => {
    // 1. Trusted origin (localhost:5173)
    const trustedRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(trustedRes.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    // 2. Trusted Lovable wildcard origin (https://my-preview.lovable.app)
    const lovableRes = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://my-preview.lovable.app" },
    });
    expect(lovableRes.headers.get("access-control-allow-origin")).toBe("https://my-preview.lovable.app");

    // 3. Untrusted origin on OPTIONS preflight
    const untrustedRes = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: { Origin: "http://malicious-site.com" },
    });
    expect(untrustedRes.status).toBe(403);
  });
});

