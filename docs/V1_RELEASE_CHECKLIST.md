# Orchlet V1 Release & Verification Checklist

This checklist documents the truth-tested capabilities, operational verification, and security boundaries of the Orchlet V1 release.

---

## 1. Core Primary Objectives Verification Matrix

| Objective | Requirement | Status | Verification Mechanism |
|---|---|---|---|
| **1. GitHub Actions CI** | Green on clean clones with no pre-built `dist/` artifacts. Zero paid API spend. | **VERIFIED GREEN** | GitHub Actions workflow `.github/workflows/ci.yml` builds, typechecks, lints, and tests across all packages. |
| **2. Real OpenCode Agent Execution** | OpenCode CLI invoked in isolated worktree, modifies code, respects model routing. | **VERIFIED** | `OpenCodeHarness` dispatches `opencode run [prompt] --dir <worktree> -m <provider>/<model> --auto --format json`. Opt-in smoke test via `pnpm test:live`. |
| **3. Adversarial AI Reviewer** | Separately routed review model audits git diff against requirements without implementer self-bias. | **VERIFIED** | `IndependentReviewer` executes against git diff and verification logs. Context packet strictly excludes planner and implementer rationalization. |
| **4. Repair Loop & Blocker Resolution** | P0/P1 findings or test failures block commits; capped repair loop (max 3) provisions targeted fixes. | **VERIFIED** | Unit tested in `remediation.test.ts`. Blocks merge until 0 P0/P1 findings remain. |
| **5. Test Suite Verification Gate** | Automated verification runs and strictly gates success. Empty diff blocks commit. | **VERIFIED** | Non-empty diff check and 100% passing test execution enforced prior to `git commit`. |
| **6. Verified Git Commit** | Genuine git commit created on dedicated work branch (`orchlet/task-<id>`). | **VERIFIED** | Verified 40-character SHA generated and stored in SQLite state store. |
| **7. Real GitHub PR Integration** | Opens PR in user-controlled repository with real commit and task summary. | **VERIFIED** | `PRBabysitter.createPullRequest` dispatches real `gh pr create` with discovered remote origin identity. |
| **8. Real Remote Repository Identity** | Discovers owner and repo from `git remote get-url origin` instead of placeholders. | **VERIFIED** | Tested in `remote.test.ts` across HTTPS, SSH, and port-based remote URLs. |
| **9. Self-Hosted Docker Image** | Multi-stage Docker image includes Node 22, Git, GitHub CLI (`gh`), and `opencode-ai`. | **VERIFIED** | `Dockerfile` and `docker-compose.yml` configured with loopback binding, `/repos` volume, and healthcheck. |
| **10. Truthful Feature Status** | README distinguishes working production features from experimental adapters. | **VERIFIED** | Feature status table in `README.md` and documentation audited. |

---

## 2. Working vs. Experimental Capabilities

### Fully Working (Tested & Truthful)
- **Workflow State Engine & SQLite Store**: Complete state machine (`PENDING` -> `PLANNING` -> `PLAN_APPROVED` -> `IMPLEMENTING` -> `VERIFYING` -> `REVIEWING` -> `REPAIRING` -> `COMMITTED` -> `PR_BABYSITTING` -> `READY_TO_MERGE` / `COMPLETED`).
- **Ephemerally Sandboxed Worktrees**: Worktrees created under `.orchlet/worktrees/<task-id>` from base branch and pruned upon settlement.
- **Audience-Separated Context Discovery**: Discovers `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and Copilot files; builds tailored packets for implementer vs reviewer.
- **Truthful Model Usage Accounting**: Model audit trail strictly records actual models executed with duration, tokens, and cost. Fake planner/architect entries eliminated.
- **Model Router & Dynamic Role Overrides**: Supports `roleMappings` overrides and custom model catalog definitions.
- **PR Babysitter Transitions**: Manages CI status checks, review states, `autoMerge: false` default, and `READY_TO_MERGE` terminal state.
- **Fastify Control Plane Daemon**: Protected by local Bearer token authentication, loopback CORS protection, and WebSocket event stream.
- **React Dashboard**: Live status dashboard displaying tasks, attention states, model usage audit trail, and verification outputs.

### Experimental / Optional
- **T3 Local RPC Adapter**: Experimental integration with locally running T3 agent instances (`.t3/config.json`).
- **Autonomous Auto-Merge**: Configurable via `git.autoMerge: true` (defaults to `false` for human oversight).

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
# Build and run containerized daemon
docker compose up -d --build

# Verify health endpoint
curl http://localhost:4774/health
```
