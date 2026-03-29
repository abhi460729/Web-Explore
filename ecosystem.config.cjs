// ecosystem.config.cjs
// PM2 Cluster Mode configuration.
// Run: pm2 start ecosystem.config.cjs
//
// Why cluster mode?
//   Node.js is single-threaded. A 4-core machine runs only at 25% CPU with a single process.
//   PM2 cluster mode forks one process per CPU core, sharing the same port via the OS.
//   On a 32-core production server this = 32x throughput with zero code changes.
//
// Perplexity-scale math:
//   - 3M queries/day = ~35 queries/second average, ~300 queries/second peak
//   - Each Node.js worker can handle ~50-100 req/s for cached responses
//   - 8 cores × 100 req/s = 800 req/s peak capacity on a single machine
//   - Add horizontal scaling (multiple machines) beyond that

const os = require("os");
const cpuCount = os.cpus().length;

module.exports = {
  apps: [
    {
      name: "ai-search-engine",
      script: "server.js",
      instances: cpuCount,          // One worker per CPU core
      exec_mode: "cluster",         // Fork + cluster = shared port, load-balanced
      
      // ── Environment ──────────────────────────────────────────────────────
      env: {
        NODE_ENV: "development",
        PORT: 8080,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
      },

      // ── Memory & Restart Policy ───────────────────────────────────────────
      max_memory_restart: "1G",     // Restart worker if it leaks past 1GB RAM
      restart_delay: 1000,          // Wait 1s before restart (prevent restart storm)
      max_restarts: 10,             // Stop trying after 10 consecutive crashes
      min_uptime: "5s",             // Must stay alive ≥5s to count as a successful start

      // ── Logging ──────────────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,             // Merge logs from all cluster workers

      // ── Zero-downtime Reload ─────────────────────────────────────────────
      // `pm2 reload ai-search-engine` does a rolling restart with zero downtime.
      // Each worker is replaced one at a time after new connections are drained.
      listen_timeout: 8000,
      kill_timeout: 5000,
      wait_ready: false,

      // ── Watch (development only) ──────────────────────────────────────────
      watch: false,                 // Set to true in dev if you want auto-restart on file change
      ignore_watch: ["node_modules", "dist", "logs", ".git"],

      // ── Node.js flags for production performance ──────────────────────────
      node_args: [
        "--max-old-space-size=768",  // Limit heap per worker to 768MB
      ],
    },

    // ── BullMQ Queue Workers (separate processes) ─────────────────────────
    // Scale workers independently from the HTTP server.
    // Uncomment and configure once you move heavy jobs to the queue.
    // {
    //   name: "search-worker",
    //   script: "workers/searchWorker.js",
    //   instances: 2,
    //   exec_mode: "fork",
    //   env_production: { NODE_ENV: "production" },
    //   max_memory_restart: "512M",
    // },
    // {
    //   name: "workflow-worker",
    //   script: "workers/workflowWorker.js",
    //   instances: 1,
    //   exec_mode: "fork",
    //   env_production: { NODE_ENV: "production" },
    //   max_memory_restart: "768M",
    // },
  ],
};
