import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import logger from "../utils/logger.js";
import { closeQueues } from "../services/queue.js";

logger.info("Queue worker process started");

async function shutdown(signal) {
  logger.info({ signal }, "Queue worker shutting down");
  try {
    await closeQueues();
    const { default: redisClient } = await import("../configs/redis.js");
    if (redisClient) {
      await redisClient.quit();
    }
  } catch (err) {
    logger.error({ err }, "Queue worker shutdown error");
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Queue worker unhandled rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Queue worker uncaught exception");
  shutdown("uncaughtException");
});
