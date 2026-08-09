# Cloud Migration — Phase Tracker

Branch: `cloud-migration`
Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

> Target: static web (nginx) + Go WebSocket/API relay behind an ALB with
> path-based routing. Infrastructure as Code via Terraform. CI/CD via GitHub
> Actions (ECR + ECS). Shared room state in ElastiCache Redis. DNS at Cloudflare.

## Target topology

```
Cloudflare (DNS/edge TLS) ──▶ ACM/ALB (443)
                                │ path rules
                                ├─ /        → TG: web   (nginx static SPA)
                                ├─ /ws*     → TG: relay (Go WebSocket)
                                └─ /api*    → TG: relay (Go REST)
                                              ├─ ElastiCache Redis (room state; no public)
                                              ├─ SSM/Secrets (redis URL, tokens)
                                              └─ CloudWatch Logs (both tasks)
```

## Decision log

| # | Decision | Choice |
|---|----------|--------|
| 1 | Repo layout | Monorepo on branch `cloud-migration` |
| 2 | `/api*` scope | Build song/sample API now (JSON metadata/config); large audio stays static |
| 3 | Realtime playmode | Relay infra + room plumbing only; client stubbed |
| 4 | DNS | Custom domain at Cloudflare; ACM cert for ALB TLS |
| 5 | ECR repos | `livestage-web`, `livestage-relay` |

## Phases

### Phase 0 — Repo restructure
- [x] Create branch `cloud-migration`
- [x] Add `apps/web` (move existing Vite app via `git mv`)
- [x] Add `apps/relay` (new Go service skeleton)
- [x] Add `infra/terraform` (IaC modules + env)
- [x] Add `.github/workflows` (CI/CD)
- [x] Root `package.json` → npm workspaces
- [x] Verify web still builds/serves locally after move

### Phase 1 — Web container (`apps/web`)
- [x] `Dockerfile` multi-stage (node build → nginx)
- [x] `nginx.conf` (static, gzip, SPA fallback, security headers)
- [ ] Local `docker build` test (needs Docker; verify later)

### Phase 2 — Go relay (`apps/relay`)
- [x] Go module + server skeleton, single port, path dispatch
- [x] `/ws*`: room create/join/leave, host-authority config
- [x] Redis pub/sub broadcast + room state snapshot
- [x] Message envelope + heartbeat/ping-pong + deadlines
- [x] Graceful shutdown / WS drain on SIGTERM
- [x] Reconnect/rejoin with state resync
- [x] `/api*`: songs + config endpoints, token auth (flag)
- [x] `/healthz` + `/readyz` (Redis check)
- [x] `Dockerfile` multi-stage (golang → distroless/static)
- [x] Local run + unit tests pass (miniredis)

### Phase 3 — Terraform (`infra/terraform`)
- [x] State backend bootstrap (S3 + DynamoDB lock)
- [x] VPC (public/private subnets, NAT, IGW, route tables)
- [x] Security groups (ALB→web/relay, relay→Redis)
- [x] ECR repos (`livestage-web`, `livestage-relay`) + lifecycle
- [x] ElastiCache Redis (private, auth_token via SSM)
- [x] ECS cluster + web/relay task defs + services (rolling)
- [x] ALB + ACM (DNS validation) + path-based routing
- [x] IAM (task execution, task role, GitHub OIDC)
- [x] CloudWatch log groups + alarms
- [x] SSM params (redis URL, tokens)
- [x] `terraform validate` passes
- [x] Restructure into per-environment dirs (`environments/livestage` + `environments/dev`),
      shared modules stay in `modules/`, flat root config removed
- [x] Bootstrap region fixed (`eu-west-1` → `eu-central-1`) to match backend

### Phase 4 — CI/CD (GitHub Actions)
- [x] `build-deploy.yml` (OIDC, buildx, push ECR, ECS update, wait stability)
- [x] `lint.yml` (web lint; go vet/test/build)
- [x] Path-aware builds (skip unchanged app)

### Phase 5 — Documentation
- [x] `docs/cloud.md` (topology, health/readiness contract)
- [x] WebSocket reconnect behavior after ECS task replacement
- [x] Zero-downtime rollout + scaling notes
- [x] DNS cutover steps via Cloudflare

### Phase 6 — Client (minimal)
- [x] `useRealtimeRoom` stub hook (feature-flagged) + reconnect/backoff
- [x] Vite dev proxy for `/ws` + `/api` → relay (`apps/web/vite.config.js`,
      `VITE_RELAY_PROXY_TARGET`, default `http://localhost:8080`)
- [x] `apps/web/.env.example` with `VITE_ENABLE_REALTIME=true`
- [x] Root `docker-compose.yml` (Redis + relay) for local backend
- [x] `/api/songs` now serves the full catalog (mirrors
      `apps/web/public/songs/index.json`); client prefers it and falls back to static
- [x] `/api/songs` pagination + filtering: `?search=&difficulty=&page=&limit=`
      (default returns everything; client normalises `{items,total,page,...}`)
- [x] Minimal room UI at `/rooms` (`components/realtime/RealtimeRoom.jsx`):
      create/join, member list, host config push, broadcast; `useRealtimeRoom`
      surfaces `broadcast` messages

## Notes / blockers
- **Redis URL seed order**: `redis_url` SSM param must be set to the ElastiCache
  endpoint after the first `terraform apply` (bootstrap docs in `docs/cloud.md`).
- **GitHub Actions vars** to configure: `GITHUB_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY_WEB`,
  `ECR_REPOSITORY_RELAY`, `ECS_CLUSTER`, `ECS_WEB_SERVICE`, `ECS_RELAY_SERVICE`.
- `docker build` of both images not run locally (no Docker in this environment);
  CI covers it.
- ACM validation records + apex DNS are managed at Cloudflare via the provider.

## Validation done (LocalStack, community image 3.8.1)
- ✅ Applied **VPC, SG, SSM, CloudWatch** against LocalStack — 38 resources created,
  verified via `aws` (subnets in 3 AZs, ALB/web/relay SGs, 3 SSM SecureString
  params, 2 log groups).
- ✅ **ACM** cert + validation for `synrecordia.site` created against LocalStack.
- 🐛 **Fixed a real bug caught by testing**: `validation_record_fqdns` referenced
  `r.resource_record.name`, but provider v5 exposes flat `resource_record_name`.
- ⚠️ ECR/ECS/ElastiCache/ALB are **Pro-only** on LocalStack free → plan-validated
  only (fail with "not yet implemented or pro feature").
- 🧰 Added `terraform.localstack.tfvars` + `backend.local.tf.example` + documented
  workflow in `docs/cloud.md` for repeatable local testing.
- ✅ Migrated to per-environment dirs: `environments/dev` (local backend + LocalStack
  endpoints) plans/validates cleanly; `environments/livestage` (S3 backend) `validate`s
  cleanly (needs the bootstrap bucket to exist before `init` in real AWS).
- ✅ Re-verified in the per-env layout: applied `module.vpc`, `module.sg`, `module.ssm`,
  `module.cloudwatch` (38 resources) + `module.alb.aws_acm_certificate.main` (cert
  `PENDING_VALIDATION`) against LocalStack via `environments/dev`.

## Cutover sequence
1. Terraform bootstrap state bucket → apply VPC/ECR/Redis/ECS/ALB/ACM/SSM/CW
2. Deploy images via CI → verify ALB + health
3. Add ALB record at Cloudflare + cert validation
4. Flip DNS only after ALB verified; keep Netlify as fallback until cutover
