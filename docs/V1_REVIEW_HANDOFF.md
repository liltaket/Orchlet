# Orchlet V1 Review Handoff & Architecture Guide

**Document Purpose**: This document is prepared for an independent, strong-model architectural and code review of **Orchlet V1**. It outlines the core system design, empirically verified production capabilities, truth boundaries, threat model, and instructions for running the verification test suite.

---

## 1. Executive Summary

Orchlet is a lightweight, opinionated, self-hosted harness orchestrator designed to run coding agent pipelines (e.g. OpenCode) with:
1. **Durable Task Lifecycle**: Expressed via a deterministic state machine persisted in SQLite.
2. **Strict Fail-Closed Execution**: In `REAL` execution mode, mock fallbacks and silent static reviews are completely forbidden. If an AI reviewer fails or cannot be reached, the pipeline fails closed into `NEEDS_ATTENTION` / `FAILED`.
3. **Dual-Model Separation**: The agent writing the code (the *executor*) and the agent auditing the code (the *critic*) are isolated entities, typically routed to different foundation models.
4. **Adversarial AI Gate & Repair Loop**: Before code is committed, an adversarial AI reviewer inspects the git diff and workspace guidelines (`AGENTS.md`, `CLAUDE.md`, etc.). Any P0/P1 blockers trigger an automated, targeted repair loop against the worktree before code can ever reach git history.
5. **Ephemerally Isolated Worktrees**: Changes are executed in temporary git worktrees (`.orchlet/worktrees/<task-id>`) branched from the target base ref, keeping the primary working directory untouched.
6. **PR Babysitting with Non-Pending Gate Enforcement**: Automated PR creation followed by active polling of CI status checks and external review bots (e.g. GitHub Actions, CodeRabbit). All gates must settle in non-pending states (e.g., `SUCCESS` / `pass`) before the task transitions to `READY_TO_MERGE`.
7. **Budget-Aware Routing**: Dynamic model discovery from OpenRouter with a 24-hour local cache, multi-tier fallback matching, per-task cost forecasting, and hard budget enforcement.

---

## 2. Core Architecture & Component Map

The monorepo is structured under `packages/` and `apps/`:

```
Orchlet/
├── apps/
│   ├── server/           # Fastify control plane daemon (port 4774), REST API, WebSocket streams
│   └── dashboard/        # React + Vite UI for task monitoring, budget visualization, attention states
├── packages/
│   ├── core/             # Canonical domain types, state definitions, interfaces
│   ├── db/               # SQLite persistence layer using node:sqlite (WAL mode, durable transitions)
│   ├── workflow-engine/  # State machine coordinator, worktree lifecycle, pipeline transitions
│   ├── agents/           # Agent harness adapters (dynamic OpenCode CLI runner, process management)
│   ├── providers/        # OpenRouter catalog discovery, AI reviewer, context truncation
│   ├── routing/          # ModelRouter, budget forecasting, tiered model selection
│   ├── usage/            # Persistent rolling budget tracker (~/.orchlet/budget-spend.json)
│   ├── context/          # Audience-separated discovery (AGENTS.md, CLAUDE.md, GEMINI.md)
│   ├── verification/     # Automated verification runner (npm test, vitest, custom scripts)
│   └── github/           # Git operations, remote identity discovery, PR babysitter, gate normalization
└── docs/
    ├── SECURITY_MODEL.md # Detailed security posture, token auth, boundary isolation
    ├── V1_RELEASE_CHECKLIST.md # Empirical matrix of verified capabilities
    └── validation/       # Immutable JSON & Markdown empirical execution logs
```

### State Machine Lifecycle
```
PENDING
  ↓
PLANNING (Optional / Autonomous)
  ↓
PLAN_APPROVED
  ↓
IMPLEMENTING (Dynamic OpenCode harness in isolated git worktree)
  ↓
VERIFYING (Automated test suite execution)
  ↓
REVIEWING (Adversarial AI reviewer audits diff vs. guidelines)
  │
  ├── [P0/P1 Blockers] ──→ REPAIRING ──→ VERIFYING ──→ REVIEWING (max 3 rounds)
  │
  └── [Approved / P2-P3 only]
        ↓
     COMMITTED (Real git commit on orchlet/task-<id>)
        ↓
     PR_BABYSITTING (gh pr create -> poll CI status checks & review bots)
        ↓
     READY_TO_MERGE (All checks passed, non-pending)
        ↓
     COMPLETED (Optional auto-merge or human settlement)
```

---

## 3. Empirically Verified Capabilities

Every capability listed below has been verified against live external APIs and real GitHub repositories. The evidence files are stored in `docs/validation/`:

### A. Real Agent Repair Loop
- **Artifact**: `docs/validation/2026-09-07-agent-repair-loop.md` & `.json`
- **Mechanism**:
  1. OpenCode executor (`z-ai/glm-5.3-flash`) implemented a discount calculation module.
  2. Adversarial AI reviewer (`google/gemini-3.8-flash`) audited the diff against `AGENTS.md` and flagged a P1 missing `RangeError` validation.
  3. OpenCode repairer was invoked with the reviewer's structured feedback and repaired the code in the worktree.
  4. Round 2 review verified 0 blockers and approved the change.
  5. The clean commit was committed to git history (`7d97d4051a92a5315bac69a72c9f0e8ee2a12ea5`).

### B. StatusContext & PR Babysitter Gate Rollup
- **Artifact**: `packages/github/test/gates-normalization.test.ts` & live PR validation
- **Mechanism**:
  - GitHub GraphQL returns status items as either `CheckRun` or legacy `StatusContext`.
  - Normalization maps both types into unified `RollupState` (`SUCCESS`, `FAILURE`, `PENDING`, `ERROR`).
  - PR Babysitter blocks `READY_TO_MERGE` whenever any check (such as CodeRabbit or GitHub Actions) is in a pending or running state.

### C. Budget-Aware Model Routing & Discovery
- **Artifact**: `packages/routing/test/router.test.ts`, `packages/providers/test/catalog-discovery.test.ts`, `packages/usage/test/budget-tracker.test.ts`
- **Mechanism**:
  - Dynamic discovery from OpenRouter API with 24-hour file-backed cache (`~/.orchlet/models-cache.json`).
  - Multi-tier matching: attempts user-configured exact model -> role default -> cost-class match -> fallback.
  - Per-task budget limits: calls forecast to exceed `taskRemainingBudgetUsd` throw `BUDGET_EXHAUSTED`.
  - Transparent audit trail: records every routing rationale with candidate models, cost class, and selection reasons.
  - Rolling spend tracking: persistent daily/monthly ledger in `~/.orchlet/budget-spend.json`.

### D. Production Fastify Daemon HTTP E2E
- **Artifact**: `packages/workflow-engine/test/production-daemon-live.test.ts`
- **Mechanism**:
  - Live Fastify server listens on loopback.
  - Authenticated `POST /api/tasks` creates task with repo validation (`git rev-parse --is-inside-work-tree`).
  - Full autonomous execution through PR creation, CI polling, and `READY_TO_MERGE`.

---

## 4. Strict Truth & Security Boundaries

1. **Fail-Closed AI Review**: If `executionMode === "REAL"` and the AI reviewer call fails (e.g. rate limit, invalid JSON response, network drop), the task transitions to `NEEDS_ATTENTION` with `REVIEW_FAILED`. It will **never** silently fall back to the static reviewer.
2. **Loopback Binding & Token Auth**: The daemon binds strictly to `127.0.0.1` by default. All REST endpoints require a local Bearer token stored in `~/.orchlet/auth_token` (file permissions restricted).
3. **Short-Lived WebSocket Tickets**: Real-time event streaming requires a single-use ticket acquired via authenticated HTTP POST (`/api/auth/ws-ticket`), expiring within 60 seconds.
4. **Git Repository Validation**: Every task submission validates that `repoPath` is a genuine git worktree using `git rev-parse --is-inside-work-tree`, rejecting arbitrary directory injection.
5. **Reviewer Context Truncation**: Large diffs (>60,000 chars) and files (>12,000 chars) are truncated with explicit truncation notices to prevent token overflow and prompt injection attacks.
6. **No Fake Dollars**: Subscription quotas (e.g. GitHub Copilot, Cursor) are tracked separately as quota-based usage and never conflated with dollar expenditures.

---

## 5. Known Limitations & Experimental Boundaries

The following areas are explicitly marked experimental or blocked:
1. **Mid-Flight Process Crash Recovery**: Task state is reliably persisted to SQLite at each step. However, automatic phase-aware pipeline resumption after an abrupt process kill (SIGKILL/power loss) is experimental (`packages/workflow-engine/test/resume-audit.test.ts`).
2. **T3 Local RPC Adapter**: Experimental adapter for local T3 agent configurations.
3. **Autonomous Auto-Merge**: Disabled by default (`autoMerge: false`). Human review is expected before PR merge.
4. **Containerized Execution**: A production Dockerfile and compose specification are provided, but containerized testing requires an active Docker daemon (`BLOCKED_BY_ENVIRONMENT` on non-elevated Windows hosts).

---

## 6. How to Verify Orchlet Locally

### Prerequisites
- Node.js >= 22.0.0
- pnpm >= 9.0.0
- Git installed and configured
- GitHub CLI (`gh`) authenticated

### Offline Verification (Zero Cost, No API Keys Required)
```bash
# Clone and install dependencies
git clone https://github.com/liltaket/Orchlet.git
cd Orchlet
pnpm install

# Run TypeScript compilation across all packages
pnpm run build

# Run linting across all packages
pnpm run lint

# Run entire unit & integration test suite (80+ tests)
pnpm test
```

### Live End-to-End Verification (Requires OPENROUTER_API_KEY)
```bash
# 1. Install OpenCode CLI globally
npm install -g opencode-ai

# 2. Set OpenRouter API Key
export OPENROUTER_API_KEY="your-openrouter-key"

# 3. Run Live OpenCode Smoke Test
pnpm test:live

# 4. Run Live Agent Repair Loop Test
pnpm exec vitest run packages/workflow-engine/test/agent-repair-live.test.ts

# 5. Run Live Production Daemon PR E2E
pnpm test:pr
```
