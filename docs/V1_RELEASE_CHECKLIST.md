# Orchlet V1 Release & Verification Checklist

This checklist documents the truth-tested capabilities, operational verification, and security boundaries of the Orchlet V1 release. Every status marked **VERIFIED** is backed by empirical test logs and artifacts in `docs/validation/`.

---

## 1. Core Primary Objectives Verification Matrix

| Objective | Requirement | Status | Verification Evidence / Mechanism |
|---|---|---|---|
| **1. GitHub Actions CI** | Green on clean clones with no pre-built `dist/` artifacts. Zero paid API spend. | **VERIFIED GREEN** | GitHub Actions workflow `.github/workflows/ci.yml` builds, typechecks, lints, and executes 39 offline tests across all packages. Run `34048498920`. |
| **2. Real OpenCode Agent Execution** | OpenCode CLI invoked in isolated worktree, modifies code, respects model routing. | **VERIFIED** | Live smoke test passed in 15.3s (`google/gemini-2.5-flash`). Empirical evidence recorded in [`docs/validation/2026-09-06-opencode-smoke.md`](validation/2026-09-06-opencode-smoke.md). |
| **3. Adversarial AI Reviewer & Fail-Closed Semantics** | Separately routed review model audits git diff. Fails closed in `REAL` mode on review error or provider failure. Never silently falls back to static review. | **VERIFIED** | Live negative review & repair loop verified with `google/gemini-2.5-flash` in [`docs/validation/2026-09-06-ai-review-negative.md`](validation/2026-09-06-ai-review-negative.md). Fail-closed semantics tested in `reviewer-fail-closed.test.ts`. |
| **4. Repair Loop & Blocker Resolution** | P0/P1 findings or test failures block commits; capped repair loop (max 3) provisions targeted fixes. | **VERIFIED** | Real-world P1 defect caught by Gemini reviewer, automatically repaired by OpenCode, and re-approved in [`docs/validation/2026-09-06-ai-review-negative.md`](validation/2026-09-06-ai-review-negative.md). |
| **5. Test Suite Verification Gate** | Automated verification runs and strictly gates success. Empty diff blocks commit. | **VERIFIED** | Enforced prior to `git commit`. Non-empty diff check and 100% passing test execution confirmed. |
| **6. Verified Git Commit** | Genuine git commit created on dedicated work branch (`orchlet/task-<id>`). | **VERIFIED** | Verified SHA `cf232e8088ee8718e8a0410983d6f814a3854f3e` generated on sandbox repo during live daemon HTTP run. |
| **7. Real GitHub PR Integration** | Opens PR in user-controlled repository with real commit, babysits CI, settles as `READY_TO_MERGE`. | **VERIFIED** | Live production daemon HTTP run opened PR #3 on [`liltaket/orchlet-sandbox`](https://github.com/liltaket/orchlet-sandbox/pull/3), observed CI pass, and settled `READY_TO_MERGE`. Recorded in [`docs/validation/2026-09-06-production-daemon-pr.md`](validation/2026-09-06-production-daemon-pr.md). |
| **8. Real Remote Repository Identity** | Discovers owner and repo from `git remote get-url origin` instead of placeholders. | **VERIFIED** | Unit tested in `remote.test.ts` across HTTPS, SSH, and port-based remote URLs. Confirmed live with `liltaket/orchlet-sandbox`. |
| **9. Self-Hosted Docker Packaging** | Multi-stage Docker image includes Node 22, Git, GitHub CLI (`gh`), and `opencode-ai`. | **PACKAGED / SPECIFIED** (Runtime `BLOCKED_BY_ENVIRONMENT`) | `Dockerfile` and `docker-compose.yml` specified with loopback binding, `/repos` volume, and healthcheck. Container run blocked by host environment (Windows service stopped, non-elevated). Recorded in [`docs/validation/2026-09-06-docker-smoke.md`](validation/2026-09-06-docker-smoke.md). |
| **10. Truthful Feature Status & Security Model** | Documents distinguish working production features from experimental adapters, with clear security model. | **VERIFIED** | Audited in `README.md` and [`docs/SECURITY_MODEL.md`](SECURITY_MODEL.md). |

---

## 2. Working vs. Experimental Capabilities

### Fully Working (Empirically Verified)
- **Workflow State Engine & SQLite Store**: Complete state machine (`PENDING` -> `PLANNING` -> `PLAN_APPROVED` -> `IMPLEMENTING` -> `VERIFYING` -> `REVIEWING` -> `REPAIRING` -> `COMMITTED` -> `PR_BABYSITTING` -> `READY_TO_MERGE` / `COMPLETED`). Durable task persistence verified in SQLite.
- **Dynamic Harness Resolution**: Resolves agent executor dynamically per repository configuration (`activeHarness: "opencode"`), strictly rejecting mock fallback in `REAL` execution mode.
- **Adversarial AI Reviewer with Strict Fail-Closed**: OpenRouter-backed structured P0–P3 audit; strictly fails closed in `REAL` execution mode without silent static fallback; provider registry rejects unsupported providers.
- **Ephemerally Sandboxed Worktrees**: Worktrees created under `.orchlet/worktrees/<task-id>` from base branch and pruned upon settlement.
- **Audience-Separated Context Discovery**: Discovers `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and Copilot files; builds tailored packets for implementer vs reviewer.
- **Truthful Model Usage Accounting**: Model audit trail strictly records actual models executed with duration, tokens, and cost. Fake planner/architect entries eliminated.
- **Model Router & Dynamic Role Overrides**: Supports `roleMappings` overrides and custom model catalog definitions.
- **PR Babysitter Transitions**: Manages CI status checks, review states, `autoMerge: false` default, and `READY_TO_MERGE` terminal state.
- **Fastify Control Plane Daemon**: Protected by local Bearer token authentication, single-use 60s WebSocket tickets, legacy query token security gate, loopback CORS protection, and WebSocket event stream.
- **React Dashboard**: Live status dashboard displaying tasks, attention states, model usage audit trail, and verification outputs.

### Experimental / Blocked
- **Phase-Aware Automatic Resume**: Durable state persistence is fully working; phase-aware automatic pipeline resumption after mid-flight process interruption is experimental (audited in `packages/workflow-engine/test/resume-audit.test.ts`).
- **T3 Local RPC Adapter**: Experimental integration with locally running T3 agent instances (`.t3/config.json`).
- **Autonomous Auto-Merge**: Configurable via `git.autoMerge: true` (defaults to `false` for human oversight).
- **Docker Daemon Execution**: Container execution requires active Docker engine (`BLOCKED_BY_ENVIRONMENT` on current non-elevated host).

---

## 3. Operational Runbook

### Running All Tests Locally
```bash
# Standard test suite (zero API spend, runs completely offline)
pnpm test

# Run build across all monorepo packages
pnpm run build

# Run TypeScript typechecks across all packages
pnpm run lint
```

### Running Live OpenCode Smoke Test
To test the real OpenCode CLI modifying real code in a sandbox:
```bash
# Ensure opencode is installed globally
npm install -g opencode-ai

# Set your provider key
export OPENROUTER_API_KEY="your-key"

# Run opt-in smoke test
pnpm test:live
```

### Running Live GitHub PR End-to-End Test
To run the full autonomous cycle opening a live pull request on `liltaket/orchlet-sandbox`:
```bash
pnpm test:pr
```

### Launching the Daemon & Dashboard
```bash
# Terminal 1: Daemon
pnpm --filter @orchlet/server start

# Terminal 2: Dashboard
pnpm --filter @orchlet/dashboard dev
```
Open `http://localhost:5173` to access the control plane. Bearer token is automatically retrieved from `~/.orchlet/auth_token`.

### Running in Docker
```bash
# Build and run containerized daemon (requires running Docker daemon)
docker compose up -d --build

# Verify health endpoint
curl http://localhost:4774/health
```
