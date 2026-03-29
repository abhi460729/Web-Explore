// configs/redis.js
// Central Redis configuration - one connection shared across the app.
// Supports REDIS_URL (for production/cloud) or individual REDIS_HOST/PORT/PASSWORD vars.

import Redis from "ioredis";
import { config } from "dotenv";

// Load env here because this module is imported very early in ESM graph.
config({ path: ".env" });
config({ path: ".env.local", override: true });

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_DB = parseInt(process.env.REDIS_DB || "0", 10);
const REDIS_REQUIRED = String(process.env.REDIS_REQUIRED || "false").toLowerCase() === "true";

const redisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  db: REDIS_DB,
  // Aggressive reconnect strategy for production
  retryStrategy: (times) => {
    if (times > 20) return null; // Stop retrying after 20 attempts
    return Math.min(times * 100, 3000); // Backoff up to 3 seconds
  },
  connectTimeout: 5000,
  commandTimeout: 3000,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  lazyConnect: false,
};

// Upstash uses rediss:// (TLS) – ioredis needs tls option explicitly
const isTLS = REDIS_URL?.startsWith("rediss://");

// Create the shared Redis client
let redisClient;

try {
  // Default behavior: Redis is optional in local/dev unless explicitly configured.
  // This avoids noisy ECONNREFUSED on machines where Redis is not running.
  if (!REDIS_URL && !REDIS_REQUIRED) {
    console.warn("[Redis] REDIS_URL not set - Redis disabled (app will run without cache/queue).");
    redisClient = null;
  } else {
    redisClient = REDIS_URL
      ? new Redis(REDIS_URL, {
          maxRetriesPerRequest: 2,
          commandTimeout: 3000,
          ...(isTLS && { tls: { rejectUnauthorized: false } }),
        })
      : new Redis(redisOptions);
  }

  if (redisClient) {
    redisClient.on("connect", () => {
      console.log("[Redis] Connected");
    });

    redisClient.on("error", (err) => {
      // Log but don't crash - app degrades gracefully without Redis
      console.error("[Redis] Connection error:", err.message);
    });

    redisClient.on("reconnecting", (delay) => {
      console.warn(`[Redis] Reconnecting in ${delay}ms...`);
    });
  }
} catch (err) {
  console.error("[Redis] Failed to create client:", err.message);
  redisClient = null;
}

export default redisClient;
