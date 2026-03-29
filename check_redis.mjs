import { config } from "dotenv";
import Redis from "ioredis";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const url = process.env.REDIS_URL;
if (!url) {
  console.log("REDIS_URL missing");
  process.exit(0);
}

const redis = new Redis(url, { tls: { rejectUnauthorized: false } });

try {
  const info = await redis.info("keyspace");
  const dbLines = info.split("\n").filter((line) => line.startsWith("db"));
  console.log(dbLines.length ? dbLines.join("\n") : "No keyspace data");

  let cursor = "0";
  const keys = [];
  do {
    const [nextCursor, chunk] = await redis.scan(cursor, "MATCH", "*", "COUNT", 100);
    cursor = nextCursor;
    keys.push(...chunk);
  } while (cursor !== "0" && keys.length < 200);

  console.log(`Total sampled keys: ${keys.length}`);
  console.log(keys.slice(0, 30).join("\n") || "No keys found");
} catch (error) {
  console.error("Redis check error:", error.message);
} finally {
  await redis.quit();
}
