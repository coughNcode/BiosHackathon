import type { Request, Response, NextFunction } from "express";

/**
 * Parses CORS_ORIGINS environment variable and provides secure origin matching.
 * Default allowed origins: https://*.lovable.app, http://localhost:5173, http://localhost:3000
 * Never uses wildcard credentialed CORS.
 */
export function createCorsMiddleware() {
  const envOrigins = (
    process.env.CORS_ORIGINS ||
    "https://*.lovable.app,http://localhost:5173,http://localhost:3000"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  function isOriginAllowed(origin: string): boolean {
    if (!origin) return true; // Non-browser / same-origin requests

    for (const pattern of envOrigins) {
      if (pattern === origin) return true;

      // Handle wildcard subdomains like https://*.lovable.app
      if (pattern.includes("*")) {
        const regexPattern = "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-zA-Z0-9_-]+") + "$";
        const re = new RegExp(regexPattern);
        if (re.test(origin)) return true;
      }
    }
    return false;
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin) {
      if (isOriginAllowed(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, DELETE, OPTIONS"
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With, X-Admin-Key"
        );
        res.setHeader("Access-Control-Max-Age", "86400");
      } else {
        // Untrusted origin: do not set Access-Control-Allow-Origin
      }
    }

    if (req.method === "OPTIONS") {
      if (origin && !isOriginAllowed(origin)) {
        res.status(403).json({ error: "CORS origin not allowed", code: "CORS_FORBIDDEN" });
        return;
      }
      res.status(204).end();
      return;
    }

    next();
  };
}

