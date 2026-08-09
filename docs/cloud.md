# Cloud Deployment — SynRecordia on AWS

This describes the production topology, health/readiness contract, WebSocket
reconnect behavior, and operational notes for the cloud deployment.

## Terraform layout

Terraform is split per environment under `infra/terraform/environments/`; shared
modules live in `infra/terraform/modules/`.

```
infra/terraform/
├── bootstrap/        # one-time: state bucket + DynamoDB lock table
├── modules/          # shared: vpc, sg, ssm, ecr, redis, iam, ecs, cloudwatch, alb
└── environments/
    ├── livestage/    # real AWS (S3 state backend)
    └── dev/          # LocalStack (local state backend + AWS endpoint override)
```

Each environment has its own `main.tf`, `backend.tf`, `variables.tf`,
`outputs.tf` and a `terraform.tfvars`/`terraform.localstack.tfvars` for values.
Use `terraform.workspace`-free per-env dirs so state backends stay isolated.

## Topology

```
Cloudflare (DNS/edge TLS)
        │
        ▼
  ALB (HTTPS :443, ACM cert)
        │  path-based routing
        ├─ /        → target group: web    (nginx static SPA)
        ├─ /ws/*    → target group: relay  (Go WebSocket)
        └─ /api/*   → target group: relay  (Go REST)
                          │
                          ├─ ElastiCache Redis (shared room state; private subnet)
                          ├─ SSM params (redis URL, redis auth, relay token)
                          └─ CloudWatch Log Groups (/ecs/livestage-web, .../relay)
```

- **Web** (nginx): serves the built SPA + static songs/samples. Stateless.
- **Relay** (Go): hosts WebSocket rooms and the `/api` endpoints. Multiple
  replicas share room state via Redis pub/sub, so ECS can run >1 instance.

## Health / readiness contract

| Endpoint | Used by | Behavior |
|----------|---------|----------|
| `GET /healthz` | container-level liveness (human/ops) | returns `200 {"status":"ok"}` always |
| `GET /readyz`  | ALB target-group health check on the relay TG | `200` only if Redis is reachable; `503` otherwise |

- The **relay target group** health check points at `/readyz` (interval 30s).
- The **web target group** health check points at `/` (expects `200`).
- `deregistration_delay = 60` on the relay TG so in-flight WebSocket messages
  are not cut mid-frame during rolling replacement.

## WebSocket protocol (client view)

Connect: `wss://<host>/ws/<roomId>`

Envelope (JSON):

```jsonc
{ "type": "join" | "leave" | "state" | "config" | "broadcast" | "error" | "ping" | "pong",
  "roomId": "…",
  "data": { … } }
```

- The **first joiner** of a room becomes **host**. Only the host may send
  `config`; the server rejects config from non-hosts.
- On `join`, the server returns the full room `state` snapshot (members +
  config). On every change it re-broadcasts the updated `state`.
- Server pings every 30s; clients reply `pong`. The read deadline is 30s, so a
  dead connection is reaped within ~30s.

## Reconnect behavior after ECS task replacement

When a relay task is replaced (deploy, scale-in, crash) the ALB drains and
closes the old connection. **The client is responsible for reconnecting.**

Client must implement:

1. **On close** (including abrupt `close` without a close frame): schedule a
   reconnect with **exponential backoff + jitter**, e.g. `min(1s * 2^n, 15s)`
   plus random 0–500ms, capped and reset after a successful reconnect.
2. **Reconnect to the same `/ws/<roomId>`** with `{type:"join", ...}`.
3. **Resync**: the server replies with the authoritative `state` snapshot on
   join, so the client rebuilds member list + config from Redis — it does not
   rely on the closed connection's memory.
4. **Host continuity**: if the host's connection is replaced, the room is
   deleted (`host left; room closed`). For MVP there is **no host failover**;
   a client may re-create the room by rejoining as first joiner. A future
   phase can add host-election/transfer.

Because room state lives in Redis (not in the task), a reconnecting client
always gets a consistent view regardless of which replica it lands on.

## Zero-downtime rollout

- ECS services use FARGATE rolling deployments
  (`minimumHealthyPercent=100`, `maximumPercent=200`) — new tasks register with
  the target group before old ones are deregistered.
- The relay container gracefully drains: on SIGTERM the HTTP server stops
  accepting new connections and in-flight sockets are closed cleanly.
- Deploys are triggered by pushes to `main` via GitHub Actions
  (`.github/workflows/deploy.yml`), which push to ECR and force a new
  deployment, then `aws ecs wait services-stable`.

## Scaling

- Start with relay `desired_count=2`. Add ECS Service Auto Scaling (target
  CPU/memory or ALB request count) when metrics are available.
- Redis (2-node cluster with auto-failover) is the shared-state source of
  truth; scale the relay horizontally independently of Redis.

## Secrets (SSM Parameter Store)

| Parameter | Purpose |
|-----------|---------|
| `/synrecordia/livestage/redis-url` | ElastiCache primary endpoint host:port |
| `/synrecordia/livestage/redis-auth` | Redis auth token (required for transit+at-rest encryption) |
| `/synrecordia/livestage/relay-token` | Token required on `/api*` calls |

IAM task role grants `ssm:GetParameter` scoped to `/synrecordia/livestage/*`.

## DNS cutover (Cloudflare)

1. `terraform apply` provisions the ALB, ACM cert (DNS-validated) and creates
   the Cloudflare validation CNAME + a `www` CNAME.
2. Confirm the ACM cert becomes `ISSUED` (validation CNAME is live).
3. Point the apex record at the ALB DNS name (or an alias/CNAME via Cloudflare
   proxying). Keep Netlify serving as a fallback until the ALB answers `200`
   on `/` and `/readyz` reports ready.
4. Flip traffic once healthy; monitor the `relay-unhealthy` CloudWatch alarm.

## Bootstrap (one-time)

```sh
# 1) Create state bucket + lock table (infra/terraform/bootstrap/)
cd infra/terraform/bootstrap && terraform init && terraform apply -auto-approve

# 2) Real infra (production/livestage env)
cd infra/terraform/environments/livestage
cp terraform.tfvars.example terraform.tfvars   # fill secrets
terraform init && terraform plan && terraform apply

# 3) After first apply, seed the real Redis endpoint (output `redis_endpoint`)
#    into the SSM param /synrecordia/livestage/redis-url.
```

## Local testing with LocalStack (no real AWS spend)

LocalStack emulates AWS locally. The free (community) image supports **EC2/VPC,
SGs, IAM, S3, SSM, CloudWatch Logs, ACM** — enough to validate most of the infra.
**ECR, ECS/Fargate, ElastiCache, and ALB are Pro-only** and will fail to apply on
the free image (they still pass `terraform validate`/`plan`).

```sh
# 1) Start LocalStack (community image, no token needed)
docker run --rm -d --name localstack -p 4566:4566 \
  -e SERVICES=s3,iam,ec2,ecr,ecs,ssm,logs,cloudwatch,elasticache,elbv2,acm,sts \
  localstack/localstack:3.8.1

# 2) Point Terraform at LocalStack (local backend + dummy secrets + endpoint).
#    The dev/ env is pre-wired for this — just set the endpoint vars.
cd infra/terraform/environments/dev
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=eu-central-1 \
       AWS_ENDPOINT_URL=http://localhost:4566
terraform init -reconfigure
terraform plan  -var-file=terraform.localstack.tfvars \
  -var cloudflare_api_token=dummy -var cloudflare_zone_id=zoneid \
  -target=module.vpc -target=module.sg -target=module.ssm -target=module.cloudwatch
terraform apply -var-file=terraform.localstack.tfvars

# 3) Clean up
terraform destroy -var-file=terraform.localstack.tfvars
docker rm -f localstack
```

Note: the `iam` module's GitHub OIDC `data` lookup and the Cloudflare provider
need real credentials; skip them when testing the rest against LocalStack.

## Local development

```sh
# Web
cd apps/web && npm i && npm run dev

# Relay (needs a Redis at localhost:6379)
cd apps/relay && REDIS_URL=localhost:6379 go run .
```
