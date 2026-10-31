/**
 * CORS middleware for Red Team services.
 *
 * Reads CORS_ORIGINS from the environment, supports wildcard subdomains
 * (e.g. `https://*.lovable.app`), and never uses wildcard credentialed CORS.
 */
import type { NextFunction, Request, Response } from "express";
import { RED_CONFIG, parseCorsOrigins } from "./config.js";

const allowedOrigins = parseCorsOrigins(RED_CONFIG.corsOrigins);

function isOriginAllowed(origin: string): boolean {
  return allowedOrigins.some((allowed) => {
    if (typeof allowed === "string") return allowed === origin;
    return allowed.test(origin);
  });
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
  res.setHeader("Access-Control-Expose-Headers", "X-Facilitator-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

