// middlewares/rateLimiter.js
// Distributed rate limiting backed by Redis.
// Falls back to in-memory store when Redis is unavailable (graceful degradation).
//
// Perplexity-scale target:
//   - Burst: 30 req/min per IP for anonymous endpoints
//   - Per-user search: 60 req/min (FREE), 300 req/min (PRO), 600 req/min (ULTRA)
//   - Auth endpoints: 10 req/min (brute-force protection)

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redisClient from "../configs/redis.js";

// ── Helper: create a RedisStore or fall back to default memory store ──────
function makeStore(prefix) {
  if (!redisClient) {
    // No Redis → memory store (works fine on single node, but won't share across cluster)
    console.warn(`[RateLimit] Redis unavailable – using memory store for "${prefix}"`);
    return undefined;
  }
  return new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

// ── Global IP-based limiter (applied to entire API) ──────────────────────
// 200 requests per minute per IP – very generous, catches only flood attacks
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("global"),
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many requests from this IP. Please wait." },
  skip: (req) => req.path === "/health", // never limit health checks
});

// ── Search endpoint limiter ───────────────────────────────────────────────
// Applied only to /api/search, /api/search/*, /api/generate
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 searches per minute → ~3M/day at full throttle per user
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("search"),
  keyGenerator: (req) => req.headers["x-user-id"] || ipKeyGenerator(req.ip),
  message: {
    error: "Search rate limit exceeded. Please wait before searching again.",
    retryAfter: "60s",
  },
});

// ── Auth endpoint limiter ─────────────────────────────────────────────────
// Strict: 10 login attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("auth"),
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many login attempts. Please wait 15 minutes." },
  skipSuccessfulRequests: true, // Don't count successful logins
});

// ── Payment endpoint limiter ──────────────────────────────────────────────
// 20 payment operations per 15 minutes per user
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("payment"),
  keyGenerator: (req) => req.headers["x-user-id"] || ipKeyGenerator(req.ip),
  message: { error: "Too many payment requests. Please wait." },
});

// ── Workflow limiter ──────────────────────────────────────────────────────
// Heavy operations – 10 per 5 minutes per user
export const workflowLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("workflow"),
  keyGenerator: (req) => req.headers["x-user-id"] || ipKeyGenerator(req.ip),
  message: {
    error: "Workflow rate limit exceeded. Please wait 5 minutes.",
  },
});
