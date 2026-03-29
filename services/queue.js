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
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { bullmqConnection } from "../configs/redis.js";
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

/**
 * AI Generate Queue
 * Handles: /api/generate prompt completion + follow-up suggestions
 */
export const generateQueue = connection
  ? new Queue("ai-generate", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000, age: 3600 },
        removeOnFail: { count: 500 },
        timeout: 60 * 1000,
      },
    })
  : null;

const GENERATE_JOB_TIMEOUT_MS = Number(process.env.GENERATE_JOB_TIMEOUT_MS || 45_000);
const generateEvents = generateQueue ? new QueueEvents("ai-generate", { connection }) : null;
const runWorkersInProcess = String(process.env.QUEUE_WORKERS_IN_PROCESS || "true").toLowerCase() !== "false";

async function runGenerateTask({ prompt, model }) {
  const { text } = await generateText({
    model: openai(model),
    prompt,
  });

  let suggestions = [];
  try {
    const sugRes = await generateText({
      model: openai(model),
      prompt: `Generate 3 intelligent follow-up questions.\n\nAnswer: ${text}\n\nOnly list the 3 questions, one per line.`,
    });
    suggestions = sugRes.text
      .split(/\n+/)
      .map((q) => q.trim())
      .filter((q) => q && !q.match(/^\d+\./))
      .slice(0, 3);
  } catch (err) {
    queueLogger.warn({ err }, "Suggestion generation failed; continuing without suggestions");
  }

  const tokens = Math.ceil((prompt.length + text.length) / 4) + 300;
  return { text, suggestions, tokens, modelUsed: model };
}

let generateWorker = null;
if (generateQueue && runWorkersInProcess) {
  generateWorker = new Worker(
    "ai-generate",
    async (job) => runGenerateTask(job.data),
    {
      connection,
      concurrency: Number(process.env.GENERATE_WORKER_CONCURRENCY || 4),
    }
  );

  generateWorker.on("failed", (job, err) => {
    queueLogger.error({ jobId: job?.id, err }, "Generate job failed");
  });
}

export async function enqueueGenerateJob({ prompt, model, userId }) {
  if (!generateQueue || !generateEvents) {
    // Redis unavailable or queue disabled: keep endpoint functional synchronously.
    return runGenerateTask({ prompt, model });
  }

  const job = await generateQueue.add(
    "generate",
    { prompt, model, userId },
    { priority: 5 }
  );
  return job.waitUntilFinished(generateEvents, GENERATE_JOB_TIMEOUT_MS);
}

// ── Queue health check ────────────────────────────────────────────────────
export async function getQueueStats() {
  if (!searchQueue) return null;
  try {
    const [
      searchWaiting,
      searchActive,
      searchFailed,
      searchCompleted,
      generateWaiting,
      generateActive,
      generateFailed,
      generateCompleted,
    ] = await Promise.all([
      searchQueue.getWaitingCount(),
      searchQueue.getActiveCount(),
      searchQueue.getFailedCount(),
      searchQueue.getCompletedCount(),
      generateQueue?.getWaitingCount() ?? 0,
      generateQueue?.getActiveCount() ?? 0,
      generateQueue?.getFailedCount() ?? 0,
      generateQueue?.getCompletedCount() ?? 0,
    ]);
    return {
      search: {
        waiting: searchWaiting,
        active: searchActive,
        failed: searchFailed,
        completed: searchCompleted,
      },
      generate: {
        waiting: generateWaiting,
        active: generateActive,
        failed: generateFailed,
        completed: generateCompleted,
      },
    };
  } catch (err) {
    queueLogger.error({ err }, "Queue stats fetch failed");
    return null;
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
export async function closeQueues() {
  const queues = [searchQueue, workflowQueue, emailQueue, generateQueue].filter(Boolean);
  const resources = [...queues, generateEvents, generateWorker].filter(Boolean);
  await Promise.allSettled(resources.map((q) => q.close()));
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
