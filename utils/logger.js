// utils/logger.js
// Pino-based structured logger. Replaces console.log throughout the app.
// In development, logs pretty-printed. In production, logs JSON (parseable by Datadog, GCP Logging, etc.)

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
    // Standard fields added to every log line
    base: {
      pid: process.pid,
      service: "ai-search-engine",
      version: process.env.npm_package_version || "1.0.0",
    },
    // In production, serialize errors properly
    serializers: {
      err: pino.stdSerializers.err,
      req: (req) => ({
        method: req.method,
        url: req.url,
        userId: req.headers?.["x-user-id"] || "anonymous",
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // Never log secrets
      paths: [
        "req.headers.authorization",
        "*.api_key",
        "*.password",
        "*.secret",
        "*.token",
        "*.access_token",
        "*.refresh_token",
      ],
      censor: "[REDACTED]",
    },
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname,service,version",
        },
      })
    : undefined // production → raw JSON stdout
);

export default logger;

// ── Convenience child loggers per domain ─────────────────────────────────
export const searchLogger = logger.child({ module: "search" });
export const authLogger = logger.child({ module: "auth" });
export const paymentLogger = logger.child({ module: "payment" });
export const cacheLogger = logger.child({ module: "cache" });
export const queueLogger = logger.child({ module: "queue" });
export const workflowLogger = logger.child({ module: "workflow" });
