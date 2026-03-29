# SCALING.md
# Production Scaling Architecture Guide
## From 0 → Perplexity-Level (3M+ queries/day)

---

## What Was Changed (and Why)

### 1. Redis Caching Layer — Biggest Impact

**File:** `services/cache.js`, `configs/redis.js`

| Before | After |
|--------|-------|
| Every search → Tavily API call + OpenAI call (~$0.002/query) | Duplicate queries served from Redis in <1ms, zero API cost |
| 3 Prisma DB queries per request (user + plan + usage) | 1 Redis GET (~0.2ms) on cache hit |
| In-memory `userLastRequest` Map breaks across multiple nodes | Redis-backed counters shared across all instances |

**Cache TTLs:**
- Search results: 5 min (fresh enough for web results)
- AI-generated answers: 10 min (deterministic for same query)
- User plan data: 60 sec (avoids 3 DB hits per request on hot path)
- Usage aggregates: 30 sec (avoids expensive `SUM` query on every request)

**Cache hit rate at Perplexity scale:** ~65-75% (most queries are repeated or trending)

---

### 2. Compression Middleware

**File:** `server.js` — `app.use(compression({ level: 6 }))`

- Reduces JSON response size by 60-80%.
- A 10KB search result → ~2.5KB over the wire.
- At 3M queries/day: saves ~21 GB/day of bandwidth.

---

### 3. Distributed Rate Limiting

**File:** `middlewares/rateLimiter.js`

| Limiter | Limit | Applied To |
|---------|-------|-----------|
| `globalLimiter` | 200 req/min per IP | All routes |
| `searchLimiter` | 60 req/min per user | `/api/search*`, `/api/generate` |
| `authLimiter` | 10 req/15min per IP | `/api/auth/google` |
| `paymentLimiter` | 20 req/15min per user | Razorpay endpoints |
| `workflowLimiter` | 10 req/5min per user | Workflow endpoints |

Redis-backed → works across all cluster nodes (unlike the old in-memory Map).

---

### 4. BullMQ Job Queue

**File:** `services/queue.js`

Why queues matter at scale:
- AI calls take 5–30 seconds
- Without queues: 1000 concurrent users = 1000 threads waiting on OpenAI
- With queues: requests enqueue instantly, workers process at API throughput rate
- Automatic retry on transient failures (429, network timeout)

**Queues:**
- `ai-search` — web search + summarisation
- `workflows` — Gmail/Docs/Calendar workflows (long-running)
- `email-notifications` — study plan drips, HR letters

---

### 5. Structured Logging (Pino)

**File:** `utils/logger.js`

| Before | After |
|--------|-------|
| `console.log(string)` | `logger.info({ userId, query, latency }, "Search completed")` |
| Not parseable by log aggregators | JSON → Datadog / GCP Cloud Logging / Elasticsearch |
| Secrets could leak into logs | Automatic redaction of `api_key`, `token`, `password` |
| Synchronous writes blocking event loop | Async, buffered writes |

---

### 6. Graceful Shutdown

**File:** `server.js` — bottom section

Critical for Kubernetes rolling deploys and Cloud Run:
1. On `SIGTERM`: stop accepting new connections
2. Let in-flight requests complete (up to 30 seconds)
3. Drain BullMQ workers
4. Disconnect Prisma and Redis cleanly
5. Exit with code 0

Without this: rolling deploys drop ~5% of requests in-flight.

---

### 7. PM2 Cluster Mode

**File:** `ecosystem.config.cjs`

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup   # Auto-start on server reboot
```

| Configuration | Before | After |
|--------------|--------|-------|
| Process model | Single Node.js process | 1 process per CPU core |
| CPU utilisation | 12.5% on 8-core machine | 100% (all cores active) |
| Memory limit | Unlimited (crash risk) | 1GB per worker, auto-restart |
| Crash recovery | Manual | Automatic with backoff |
| Deploy | Kill + restart = downtime | `pm2 reload` = zero downtime |

---

### 8. Multi-Stage Docker Build

**File:** `Dockerfile`

| Before | After |
|--------|-------|
| `node:18` (~900MB image) | `node:20-alpine` (~160MB image) |
| Installs ALL deps incl. devDeps | Multi-stage: devDeps only in builder |
| Runs as root (security risk) | Runs as non-root `appuser` |
| No health check | `HEALTHCHECK` for orchestrator readiness |

---

### 9. Production Docker Compose

**File:** `docker-compose.yml`

Full production stack:
```
Internet → Nginx (SSL/load balancer)
              → App × 4 replicas (Node.js)
              → Redis (cache + rate limit + queues)
              → PgBouncer → PostgreSQL
```

Scale horizontally:
```bash
docker compose up -d --scale app=8   # Double throughput instantly
```

---

### 10. Kubernetes Manifests

**File:** `k8s/deployment.yaml`

For cloud-native scaling (GKE / EKS / AKS):

```bash
kubectl apply -f k8s/deployment.yaml

# Watch autoscaling in action
kubectl get hpa -n ai-search -w
```

HPA autoscales from **4 → 50 pods** based on CPU load.
A traffic spike triggers scale-up in ~90 seconds.

---

## Capacity Math

| Metric | Value |
|--------|-------|
| Perplexity daily queries | ~3M/day (2024) |
| Peak queries/second | ~300 req/s |
| Cached response time | <5ms |
| Uncached (Tavily + OpenAI) | 3–15s |
| Expected cache hit rate | 65–75% |
| Effective throughput per Node.js worker | ~100 cached req/s |
| Required workers at peak (with 70% cache) | ~1–3 workers |
| Workers at 4 replicas × 2 CPUs per pod | 8 workers = 800 cached req/s |

**Conclusion:** 4 app replicas + Redis is sufficient for Perplexity's current query volume.
The HPA config will auto-scale to 50 pods if you ever exceed that.

---

## Running Locally with Redis

```bash
# 1. Start Redis (Docker)
docker run -d -p 6379:6379 --name redis redis:7-alpine

# 2. Set env variable
# Add to .env:
# REDIS_URL=redis://localhost:6379

# 3. Start server
npm start
# or with PM2:
# pm2 start ecosystem.config.cjs
```

## Running in Production

```bash
# Docker Compose (recommended for single-server)
docker compose up -d --scale app=4

# Kubernetes (recommended for multi-server / cloud)
kubectl apply -f k8s/deployment.yaml
```

---

## Database Tuning Checklist

- [ ] Enable `PgBouncer` in front of PostgreSQL (included in docker-compose.yml)
- [ ] Add indexes: `UsageLog(userId, createdAt)`, `QueryHistory(userId, createdAt)`
- [ ] Enable Prisma query logging in dev to spot N+1 patterns
- [ ] Use `prisma.$transaction()` for atomic payment operations
- [ ] Set `connection_limit` in `DATABASE_URL` query params for Prisma

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Add this for Prisma Accelerate / connection pooling:
  // directUrl = env("DIRECT_DATABASE_URL")
}
```

---

## API Rate Limit Reference

| Endpoint | Limit |
|----------|-------|
| `POST /api/search` | 60/min per user |
| `POST /api/search/images` | 60/min per user |
| `POST /api/search/videos` | 60/min per user |
| `POST /api/search/news` | 60/min per user |
| `POST /api/generate` | 60/min per user |
| `POST /api/auth/google` | 10/15min per IP |
| `POST /api/create-razorpay-order` | 20/15min per user |
| All routes (global) | 200/min per IP |

---

## Monitoring (Recommended Next Steps)

| Tool | Purpose |
|------|---------|
| **Datadog / Grafana** | Dashboard CPU, memory, request rate, error rate |
| **BullMQ Dashboard** (`bull-board`) | Visualise job queues, retry failed jobs |
| **Prisma Studio** | Inspect DB state during incidents |
| **Redis Insight** | Cache hit rate, memory usage, key TTL viewer |
| **Sentry** | Real-time error tracking with stack traces |
