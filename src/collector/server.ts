import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { CollectorDatabase } from "./db.js";
import { createCorsMiddleware } from "./cors.js";
import { EventInputSchema, type CollectorEvent } from "./types.js";
import { correlateEvent } from "./correlation.js";
import { calculateMetrics, calculateScorecard } from "./metrics.js";
import { DEMO_EVENTS, DEMO_SCORECARD } from "../demo-fixtures.js";

const DEFAULT_PORT = 4050;
const DEFAULT_HOST = "0.0.0.0";

export function createCollectorApp(dbInstance?: CollectorDatabase) {
  const db = dbInstance || new CollectorDatabase();
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(createCorsMiddleware());

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    const counts = db.getCounts();
    const port = Number(process.env.COLLECTOR_PORT || DEFAULT_PORT);
    res.json({
      status: "ok",
      service: "collector",
      port,
      eventCount: counts.eventCount,
      runCount: counts.runCount,
    });
  });

  // ── POST /events ───────────────────────────────────────────────────────────
  app.post("/events", (req: Request, res: Response) => {
    const parseResult = EventInputSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: "Validation failed: " + parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const input = parseResult.data;
    const eventId = input.eventId && input.eventId.trim() ? input.eventId : `evt_${randomUUID()}`;
    const receivedAt = new Date().toISOString();

    const eventRecord: CollectorEvent = {
      eventId,
      timestamp: input.timestamp,
      runId: input.runId ?? null,
      source: input.source,
      eventType: input.eventType,
      severity: input.severity,
      attackId: input.attackId ?? null,
      message: input.message,
      data: input.data ?? {},
      receivedAt,
    };

    // Store strictly in events table (never demo_events)
    db.insertEvent(eventRecord);

    // Correlate into runs table
    correlateEvent(db, eventRecord);

    res.status(200).json({
      received: true,
      eventId,
    });
  });

  // ── GET /events ────────────────────────────────────────────────────────────
  app.get("/events", (req: Request, res: Response) => {
    const demo = req.query.demo === "true";
    const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
    const attackId = typeof req.query.attackId === "string" ? req.query.attackId : undefined;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    const eventType = typeof req.query.eventType === "string" ? req.query.eventType : undefined;
    const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit as string, 10)) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10)) : 0;

    const result = db.getEvents({
      runId,
      attackId,
      source,
      eventType,
      severity,
      since,
      limit,
      offset,
      demo,
    });

    res.json({
      events: result.events,
      total: result.total,
      offset,
      limit,
    });
  });

  // ── GET /events/:eventId ───────────────────────────────────────────────────
  app.get("/events/:eventId", (req: Request, res: Response) => {
    const demo = req.query.demo === "true";
    const evt = db.getEventById(req.params.eventId, demo);

    if (!evt) {
      res.status(404).json({ error: "Event not found", code: "NOT_FOUND" });
      return;
    }

    res.json(evt);
  });

  // ── GET /runs ──────────────────────────────────────────────────────────────
  app.get("/runs", (req: Request, res: Response) => {
    const classification = typeof req.query.classification === "string" ? req.query.classification : undefined;
    const attackId = typeof req.query.attackId === "string" ? req.query.attackId : undefined;
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit as string, 10)) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10)) : 0;

    const result = db.getRuns({ classification, attackId, limit, offset });

    res.json({
      runs: result.runs,
      total: result.total,
    });
  });

  // ── GET /runs/:runId ───────────────────────────────────────────────────────
  app.get("/runs/:runId", (req: Request, res: Response) => {
    const run = db.getRunById(req.params.runId);

    if (!run) {
      res.status(404).json({ error: "Run not found", code: "NOT_FOUND" });
      return;
    }

    const { events } = db.getEvents({ runId: req.params.runId, limit: 200 });
    // Sort chronological for run event timeline
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({
      run,
      events,
    });
  });

  // ── GET /metrics ───────────────────────────────────────────────────────────
  app.get("/metrics", (_req: Request, res: Response) => {
    const metrics = calculateMetrics(db);
    res.json(metrics);
  });

  // ── GET /audit-log ─────────────────────────────────────────────────────────
  app.get("/audit-log", (req: Request, res: Response) => {
    const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit as string, 10)) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10)) : 0;

    const result = db.getEvents({ limit, offset, demo: false });

    res.json({
      events: result.events,
      total: result.total,
    });
  });

  // ── GET /scorecard ─────────────────────────────────────────────────────────
  app.get("/scorecard", (req: Request, res: Response) => {
    if (req.query.demo === "true") {
      res.json(DEMO_SCORECARD);
      return;
    }

    const scorecard = calculateScorecard(db);
    res.json(scorecard);
  });

  // ── POST /evaluation/run ───────────────────────────────────────────────────
  app.post("/evaluation/run", (_req: Request, res: Response) => {
    const metrics = calculateMetrics(db);
    res.json({
      status: "recalculated",
      metrics,
    });
  });

  // ── POST /evaluation/reset ─────────────────────────────────────────────────
  app.post("/evaluation/reset", (req: Request, res: Response) => {
    const scope = (req.body?.scope || "demo").toLowerCase();
    const confirm = req.body?.confirm === true;

    if (scope === "all") {
      if (!confirm) {
        res.status(400).json({
          error: "Full reset requires confirm: true in request body",
          code: "CONFIRM_REQUIRED",
        });
        return;
      }

      // Verify admin key
      const expectedAdminKey = process.env.ADMIN_KEY || "dev-admin-key";
      const authHeader = req.headers.authorization || "";
      const adminKeyHeader = req.headers["x-admin-key"] as string | undefined;

      const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedKey = bearerKey || adminKeyHeader;

      if (!providedKey || providedKey !== expectedAdminKey) {
        res.status(401).json({
          error: "Unauthorized: Invalid or missing Admin Key for full reset",
          code: "UNAUTHORIZED",
        });
        return;
      }

      const cleared = db.clearAll();
      res.json({
        cleared: `Cleared ${cleared.eventsCleared} events, ${cleared.runsCleared} runs, ${cleared.demoEventsCleared} demo events`,
        scope: "all",
      });
      return;
    }

    // Default scope: "demo" only
    const count = db.clearDemoEvents();
    res.json({
      cleared: `Cleared ${count} demo events`,
      scope: "demo",
    });
  });

  // ── POST /demo/seed ────────────────────────────────────────────────────────
  app.post("/demo/seed", (_req: Request, res: Response) => {
    const count = db.seedDemoEvents(DEMO_EVENTS);
    res.json({
      seeded: true,
      count,
    });
  });

  // ── 404 & Error Handler ────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, code: "INTERNAL_ERROR" });
  });

  return { app, db };
}

// ── Standalone Server Startup ───────────────────────────────────────────────
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith("server.ts") ||
  process.argv[1].endsWith("server.js") ||
  process.argv[1].includes("collector")
);

if (isDirectRun) {
  const port = Number(process.env.COLLECTOR_PORT || DEFAULT_PORT);
  const host = process.env.HOST || DEFAULT_HOST;
  const { app } = createCollectorApp();

  app.listen(port, host, () => {
    console.log(`\n========================================================`);
    console.log(`🛡️  PayGuard AI Event Collector Service`);
    console.log(`========================================================`);
    console.log(`Port:        ${port}`);
    console.log(`Host:        ${host}`);
    console.log(`Environment: http://${host}:${port}`);
    console.log(`CORS:        ${process.env.CORS_ORIGINS || "https://*.lovable.app, http://localhost:5173, http://localhost:3000"}`);
    console.log(`Database:    ${process.env.DB_FILE || "./data/payguard-collector.db"}`);
    console.log(`Health:      GET http://${host}:${port}/health`);
    console.log(`Metrics:     GET http://${host}:${port}/metrics`);
    console.log(`Scorecard:   GET http://${host}:${port}/scorecard`);
    console.log(`========================================================\n`);
  });
}
