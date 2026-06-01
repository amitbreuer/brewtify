# Brewtify — Large-Scale Architecture

> How this system would be built at company scale (thousands to millions of users).

---

## Overview

At scale, the same requirements (token encryption, playlist settings, caching, scheduling, rate-limit handling) demand fundamentally different solutions: horizontal scaling, fault tolerance, observability, compliance, and cost optimization.

---

## Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │              Load Balancer (ALB)             │
                         │         (TLS termination, rate limiting)     │
                         └────────────────────┬────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
           ┌────────▼───────┐       ┌────────▼───────┐       ┌────────▼───────┐
           │   API Pod 1    │       │   API Pod 2    │       │   API Pod N    │
           │  (Kubernetes)  │       │  (Kubernetes)  │       │  (Kubernetes)  │
           └───────┬────────┘       └───────┬────────┘       └───────┬────────┘
                   │                        │                        │
     ┌─────────────┼────────────────────────┼────────────────────────┼──────────┐
     │             │                        │                        │          │
┌────▼────┐  ┌────▼─────┐  ┌───────────────▼───────────────┐  ┌────▼─────┐    │
│ Postgres │  │  Redis   │  │      Message Queue (SQS)      │  │  Vault   │    │
│ Primary  │  │ Cluster  │  │   (schedule events, retries)  │  │ (secrets)│    │
│  + Read  │  │ (3-node) │  └───────────────┬───────────────┘  └──────────┘    │
│ Replicas │  └──────────┘                  │                                   │
└──────────┘                    ┌───────────▼────────────┐                      │
                                │    Worker Pods (K8s)   │                      │
                                │  - Playlist updaters   │                      │
                                │  - Token refreshers    │                      │
                                │  - Cache warmers       │                      │
                                └────────────────────────┘                      │
                                                                                │
     ┌──────────────────────────────────────────────────────────────────────────┘
     │
┌────▼──────────────────────────────────────────┐
│              Observability Stack               │
│  Datadog / Grafana / PagerDuty / Sentry       │
└───────────────────────────────────────────────┘
```

---

## 1. Token Encryption & Secrets Management

### What we did (solo)
- AES-256-GCM with a single `ENCRYPTION_KEY` env var
- Per-user salt stored alongside the ciphertext

### At scale
| Aspect | Solution |
|--------|----------|
| Key management | Hardware-backed, auditable, auto-rotation |
| Envelope encryption | KMS encrypts a data encryption key (DEK); DEK encrypts tokens. Key rotation = re-encrypt DEKs, not all tokens |
| Key rotation | Automated monthly rotation with dual-key period (old key decrypts, new key encrypts) |
| Access control | IAM policies restrict which services can decrypt; audit logs on every decrypt call |
| Compliance | SOC 2, GDPR — audit trail of every secret access |
| Multi-region | Keys replicated per region; tokens decryptable locally for low latency |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **AWS KMS** | Tight AWS integration, FIPS 140-2 validated | AWS-native infrastructure |
| **HashiCorp Vault** | Multi-cloud, dynamic secrets, fine-grained policies | Multi-cloud or on-prem setups |
| **Google Cloud KMS** | Tight GCP integration, per-key IAM, external key manager support | GCP-native infrastructure |

---

## 2. Playlist Settings & User Data

### What we did (solo)
- Single Neon PostgreSQL instance (free tier)
- Prisma ORM with simple schema

### At scale
| Aspect | Solution |
|--------|----------|
| Database | Managed PostgreSQL with auto-failover |
| Read replicas | 2-5 read replicas for read-heavy queries (playlist listings, preferences) |
| Connection pooling | PgBouncer in front of DB (10K+ connections from multiple API pods) |
| Schema management | Flyway or Prisma Migrate with blue/green deployments (zero-downtime migrations) |
| Sharding | User-based sharding if exceeding single-node limits (>10TB or >100K TPS) |
| Backups | Point-in-time recovery (PITR), daily snapshots, cross-region replication |
| Data partitioning | Partition `playlists` table by `user_id` range; archive old schedules to cold storage |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Amazon Aurora PostgreSQL** | Multi-AZ failover, 5x throughput vs standard PG, auto-scaling replicas | High availability + AWS ecosystem |
| **Neon (scaled tier)** | Serverless auto-scaling, branching for dev/staging, pay-per-compute-second | Variable workloads, cost optimization |
| **Google Cloud SQL** | Managed PG, automatic backups, regional failover, IAM-based access | GCP-native or multi-region needs |

---

## 3. Caching

### What we did (solo)
- Upstash Redis (serverless, 10K commands/day)
- Simple key-value with TTL
- Batch API calls to reduce cache misses

### At scale
| Aspect | Solution |
|--------|----------|
| Cache layer | Clustered Redis with automatic failover |
| Topology | Redis Cluster with 3 shards × 2 replicas = 6 nodes |
| Cache strategy | **Write-through** for user data, **cache-aside** for Spotify API responses |
| Eviction | LRU eviction with maxmemory policy; hot data stays, cold data refetched |
| Multi-level cache | L1: In-memory (per-pod, 100MB, 30s TTL) → L2: Redis → L3: Database |
| Cache warming | Background workers pre-populate cache for active users on deploy |
| Thundering herd | **Request coalescing** — only 1 pod fetches from Spotify; others wait on shared lock |
| Spotify rate limits | Distributed rate limiter in Redis (token bucket algorithm, shared across pods) |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Amazon ElastiCache (Redis)** | Managed cluster mode, auto-failover, encryption at rest | AWS-native, high throughput |
| **Upstash Redis (Pro)** | Serverless global replication, pay-per-request, zero ops | Variable/bursty workloads, multi-region |
| **Momento** | Serverless cache, no cluster management, sub-ms latency, automatic scaling | Zero-ops requirement, rapid scaling |

---

## 4. Scheduled Updates

### What we did (solo)
- Cloud Scheduler → `POST /cron/update` daily at midnight UTC
- `p-queue` with concurrency 5 inside the request handler

### At scale
| Aspect | Solution |
|--------|----------|
| Scheduler | Durable workflows with built-in retry, visibility |
| Message queue | Decouple schedule triggers from execution |
| Workers | Dedicated Kubernetes pods (auto-scaled based on queue depth) |
| Concurrency | 50-200 concurrent playlist updates across worker fleet |
| Retry strategy | Exponential backoff: 1min → 5min → 30min → 1hr; dead-letter queue after 5 failures |
| Time zones | Store user's timezone; schedule updates at 8 AM local time (not midnight UTC for everyone) |
| Batching | Group updates by artist overlap — if 100 users want Artist X's tracks, fetch once |
| Priority queues | Premium users get priority; free users updated in off-peak hours |
| Observability | Dashboard showing: queue depth, success rate, p95 update time, failure reasons |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Temporal.io** | Durable workflows, exactly-once guarantees, built-in retry/visibility, language-native SDKs | Complex multi-step orchestration |
| **AWS SQS + Lambda** | Serverless, infinite scale, dead-letter queues, pay-per-message | Simple fan-out task processing |
| **BullMQ (self-hosted on Redis)** | Node.js native, rich job features (priority, delay, rate limiting), Redis-backed | Node.js stack, moderate scale, cost-conscious |

---

## 5. Rate Limit Management (Spotify API)

### What we did (solo)
- `p-queue` (5 concurrent, 10/sec interval cap)
- Retry with `Retry-After` header (max 3 retries)
- Batch album API to reduce call count
- Redis caching to avoid redundant calls

### At scale
| Aspect | Solution |
|--------|----------|
| Distributed rate limiter | Token bucket in Redis, shared across all pods |
| Request deduplication | If 50 users need Artist X's albums, fetch once and fan out |
| Circuit breaker | Stop calling Spotify if error rate exceeds threshold; fail gracefully |
| Backpressure | Queue incoming requests when nearing rate limit; process in order |
| Multiple Spotify apps | Register multiple app credentials for higher aggregate limits |
| Priority | Interactive user requests take priority over background scheduled updates |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Redis + custom token bucket** | Full control, low latency, works with existing Redis cluster | Custom rate-limit logic needed |
| **Kong Gateway** | Plugin-based rate limiting, circuit breaker, request coalescing at API gateway | Centralized API gateway pattern |
| **Resilience4j / Polly** | In-process circuit breaker + rate limiter, no external dependency | Per-service resilience without extra infra |

---

## 6. User Preferences

### What we did (solo)
- Skipped (planned as DB table with JSON arrays)

### At scale
| Aspect | Solution |
|--------|----------|
| Storage | PostgreSQL JSONB column for flexible schema + typed fields for indexed queries |
| Recommendation engine | Collaborative filtering — "users like you also enjoy..." |
| ML pipeline | Track listening patterns → train preference models → personalized shuffles |
| A/B testing | Feature flags — test new shuffle algorithms on 5% of users |
| Analytics | Event stream → data warehouse → preference insights |
| Real-time updates | Preferences affect next shuffle immediately (invalidate cached playlists) |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Amazon Personalize** | Managed ML recommendations, real-time & batch, no ML expertise needed | Quick recommendation system |
| **LaunchDarkly** | Feature flags, A/B testing, progressive rollouts, audience targeting | Controlled feature experimentation |
| **Apache Kafka + BigQuery** | Event streaming + data warehouse for analytics pipelines | Large-scale behavioral analytics |

---

## 7. Infrastructure & DevOps

### What we did (solo)
- Single Cloud Run service (scale-to-zero, me-west1)
- GitHub Actions deploy on push to main (Workload Identity Federation)

### At scale
| Aspect | Solution |
|--------|----------|
| Container orchestration | Kubernetes with auto-scaling (2-50 pods based on load) |
| CI/CD | Build → test → staging → canary → production (30 min rollout) |
| Infrastructure as Code | All infra defined in code, reviewed in PRs |
| Environments | dev / staging / production (isolated databases, separate Redis clusters) |
| Rollbacks | Automated rollback if error rate exceeds 1% in first 5 minutes |
| Blue/green deploys | Zero-downtime deploys; instant rollback by switching traffic |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **AWS EKS** | Managed Kubernetes, tight AWS integration, Fargate for serverless pods | AWS-native containerized workloads |
| **Terraform** | Multi-cloud IaC, state management, drift detection, module ecosystem | Infrastructure-as-code for any cloud |
| **ArgoCD** | GitOps-native CD, declarative deployments, automatic sync, rollback | Kubernetes-native continuous delivery |

---

## 8. Security & Compliance

### What we did (solo)
- AES-256-GCM encryption
- HTTPS via Cloud Run's automatic TLS

### At scale
| Aspect | Solution |
|--------|----------|
| OAuth token storage | Tokens encrypted at rest AND in transit; field-level encryption in DB |
| API authentication | OAuth 2.0 + JWT for service-to-service; API keys for external integrations |
| Rate limiting | Per-user rate limits (100 req/min) at API gateway level |
| DDoS protection | WAF + shield in front of load balancer |
| Audit logging | Every token decrypt, preference change, playlist update logged with user context |
| GDPR compliance | Data export (`/export`), data deletion (`/delete-account`), consent tracking |
| Penetration testing | Quarterly security audits; bug bounty program |
| Secrets rotation | Automated rotation of all credentials every 30-90 days |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Cloudflare** | DDoS protection, WAF, bot management, edge caching, zero-trust access | Public-facing APIs needing protection |
| **AWS WAF + Shield** | Managed rules, rate limiting, DDoS mitigation, CloudFront integration | AWS-native security perimeter |
| **Snyk** | Dependency vulnerability scanning, container scanning, IaC security | Shift-left security in CI/CD pipeline |

---

## 9. Observability

### What we did (solo)
- Console logs
- Cloud Run built-in log viewer (Cloud Logging)

### At scale
| Aspect | Solution |
|--------|----------|
| Logging | Structured JSON logs → shipped with correlation IDs |
| Metrics | Prometheus-compatible dashboards (request latency, cache hit ratio, queue depth) |
| Tracing | Distributed tracing — trace a request across API → Redis → DB → Spotify |
| Alerting | Alert on: error rate >1%, p95 latency >2s, scheduler failures >5 |
| SLOs | 99.9% uptime, <500ms p95 API latency, <5min playlist update time |

### Recommended services (pick 2–3):
| Service | Strength | When to use |
|---------|----------|-------------|
| **Datadog** | Full-stack APM, logs, metrics, tracing, dashboards, AI-powered alerts | Single pane of glass for all observability |
| **Grafana Cloud + Loki + Tempo** | Open-source stack, cost-effective, Prometheus-native, flexible dashboards | Budget-conscious, already using Prometheus |
| **Sentry** | Error tracking, performance monitoring, session replay, release health | Application-level error tracking + debugging |

---

## Cost Comparison

| Component | Solo (current) | Scale (10K users) | Scale (1M users) |
|-----------|---------------|-------------------|-------------------|
| Compute | $0 (Cloud Run free) | ~$200/mo (3 pods) | ~$5,000/mo (auto-scale) |
| Database | $0 (Neon free) | ~$50/mo (Aurora) | ~$1,500/mo (multi-AZ) |
| Cache | $0 (Upstash free) | ~$50/mo (ElastiCache) | ~$500/mo (cluster) |
| Queue/Scheduler | $0 (Cloud Scheduler) | ~$20/mo (SQS) | ~$100/mo (Temporal Cloud) |
| Secrets | $0 (Secret Manager) | ~$5/mo (Vault) | ~$50/mo (KMS) |
| Observability | $0 (Cloud Logging) | ~$100/mo (Datadog) | ~$2,000/mo |
| **Total** | **$0** | **~$425/mo** | **~$9,150/mo** |

---

## Key Architectural Differences

| Concern | Solo | Company Scale |
|---------|------|---------------|
| Single point of failure | Everywhere | Eliminated (redundancy at every layer) |
| Deployment | GitHub Actions + Cloud Run | Automated CI/CD with canary + rollback |
| Secrets | Cloud Secret Manager | Hardware-backed KMS with rotation |
| Scheduling | Cloud Scheduler + HTTP endpoint | Distributed workflow engine |
| Caching | Single serverless Redis | Multi-level with request coalescing |
| Database | Single instance | Primary + replicas + connection pooling |
| Rate limits | Per-process p-queue | Distributed token bucket + circuit breaker |
| Monitoring | Cloud Logging (JSON) | Full observability stack with SLOs |
| Security | Basic encryption | Defense in depth + compliance |
