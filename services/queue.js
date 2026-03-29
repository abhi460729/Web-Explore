// services/queue.js
// BullMQ job queues for all heavy/async operations.
//
// Why queues at Perplexity scale?
//   - AI calls take 5-30 seconds. Without queues → HTTP timeout on high load.
//   - Queues absorb traffic bursts: 10,000 requests/min can be enqueued instantly
//     and processed at the rate your API keys / OpenAI tier allow.
//   - Automatic retry on transient failures (rate limits, network timeouts).
//   - Separate worker processes can be added per queue independently.
//
// Queue design:
//   ┌──────────┐    enqueue     ┌──────────────┐    process    ┌──────────────────┐
//   │  Express │ ─────────────▶ │  BullMQ Queue │ ────────────▶ │  Worker (this file) │
//   │ (thin HTTP│               │  (Redis-backed)│               │  (can be separate  │
//   │  layer)  │ ◀─────────────  │               │ ◀────────────  │   process/pod)    │
//   └──────────┘   result SSE   └──────────────┘   job result  └──────────────────┘

import { Queue, Worker, QueueEvents } from "bullmq";
import redisClient, { bullmqConnection } from "../configs/redis.js";
import logger, { queueLogger } from "../utils/logger.js";

// BullMQ needs its own connection options (maxRetriesPerRequest: null)
// Do NOT pass the shared redisClient here
const connection = bullmqConnection;

// ── Queue Definitions ─────────────────────────────────────────────────────

/**
 * AI Search Queue
 * Handles: web search + AI summarisation
 * Workers: scale horizontally by adding more worker pods
 */
export const searchQueue = connection
  ? new Queue("ai-search", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000, age: 3600 },  // keep last 1000 completed for 1h
        removeOnFail: { count: 500 },
      },
    })
  : null;

/**
 * Workflow Queue
 * Handles: Gmail catch-up, competitor research, pitch emails, HR ops
 * These are long-running (30s-5min) – must NOT block HTTP threads
 */
export const workflowQueue = connection
  ? new Queue("workflows", {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        removeOnComplete: { count: 200, age: 7200 },
        removeOnFail: { count: 100 },
        timeout: 5 * 60 * 1000, // 5 min max per workflow job
      },
    })
  : null;

/**
 * Email Notification Queue
 * Handles: study plan daily email drips, HR letter delivery
 */
export const emailQueue = connection
  ? new Queue("email-notifications", {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 500, age: 86400 },
        removeOnFail: { count: 200 },
      },
    })
  : null;

// ── Queue health check ────────────────────────────────────────────────────
export async function getQueueStats() {
  if (!searchQueue) return null;
  try {
    const [waiting, active, failed, completed] = await Promise.all([
      searchQueue.getWaitingCount(),
      searchQueue.getActiveCount(),
      searchQueue.getFailedCount(),
      searchQueue.getCompletedCount(),
    ]);
    return { waiting, active, failed, completed };
  } catch (err) {
    queueLogger.error({ err }, "Queue stats fetch failed");
    return null;
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
export async function closeQueues() {
  const queues = [searchQueue, workflowQueue, emailQueue].filter(Boolean);
  await Promise.allSettled(queues.map((q) => q.close()));
  queueLogger.info("All queues closed gracefully");
}

// ── Log queue events in production ───────────────────────────────────────
if (searchQueue && process.env.NODE_ENV === "production") {
  const searchEvents = new QueueEvents("ai-search", { connection: bullmqConnection });
  searchEvents.on("failed", ({ jobId, failedReason }) => {
    queueLogger.error({ jobId, failedReason }, "Search job failed");
  });
  searchEvents.on("stalled", ({ jobId }) => {
    queueLogger.warn({ jobId }, "Search job stalled");
  });
}

queueLogger.info(
  connection
    ? "BullMQ queues initialised (Redis-backed)"
    : "BullMQ queues DISABLED – Redis unavailable, running synchronously"
);
