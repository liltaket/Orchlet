# Orchlet

> **Autonomous AI Coding-Agent Orchestration Control Plane**  
> Say what you want done once. Orchlet plans, models, executes, tests, independently reviews, opens, and babysits your GitHub PR until clean merge.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js: 22+](https://img.shields.io/badge/Node.js-22%2B-brightgreen.svg)]()
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)]()
[![CI](https://github.com/liltaket/Orchlet/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)

---

## What is Orchlet?

Orchlet is a production-minded, open-source AI coding-agent orchestration control plane. It bridges the gap between single-prompt code generation and end-to-end software delivery by owning the entire task lifecycle:

1. **Deterministic Context Discovery**: Automatically discovers repo-level and directory-level instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`), computing composite SHA-256 fingerprints and tailoring audience-separated context bundles (implementer vs. independent reviewer).
2. **Dynamic Quota-Aware Model Routing (`AUTO`)**: Automatically balances reasoning capability against cost, routing tasks across `fast`, `balanced`, and `strong` model tiers while actively respecting quota limits and health fallback. Configurable via `orchlet.config.json`.
3. **Strict Git Worktree Sandboxing**: Isolates all agent mutations within ephemeral Git worktrees (`.orchlet/worktrees/<task-id>`), preventing file contention with your working directory.
4. **Real Agent Execution Harnesses**: Dispatches real coding agents (via `OpenCodeHarness`, `OpenRouterProvider`, or mock execution) to inspect code, apply mutations, and run tests.
5. **Automated Verification**: Executes configured and detected test suites (`npm test`, linters, custom commands) within the isolated worktree, capturing exit codes, durations, and output logs.
6. **Independent Adversarial AI Review (P0–P3)**: Audits real git diffs with fresh context against objectives and test results. Ranks issues by severity (`P0` blocker to `P3` nit) without implementer self-rationalization bias.
7. **Automated Remediation Loop**: Detects `P0`/`P1` review findings, automatically provisions targeted repair cycles with fix agents, re-verifies tests, and requires fresh independent approval.
8. **Real Git & Merge-Ready Lifecycle**: Stages and creates verified git commits, exposes full model usage audits, and safely manages PR workflows with configurable policies (`push`, `openPr`, `autoMerge`). Distinguishes `READY_TO_MERGE` from `MERGED`.
9. **Durable Crash Recoverability**: Persists every task state, checkpoint, and model audit in embedded SQLite.
10. **Remote-Ready Dashboard & Daemon**: Fastify REST API and WebSocket attention stream with local bearer token authentication and configurable remote connection.

---

## Feature Status Matrix

| Capability | Status | Details |
|---|---|---|
| **SQLite Workflow Engine & Checkpointing** | **Working** / **Experimental** | Durable state machine & task persistence (Working); phase-aware automatic resume (Experimental) |
| **Git Worktree Isolation** | **Working** | Ephemeral worktree sandboxing under `.orchlet/worktrees/` |
| **Instruction Discovery Engine** | **Working** | Discovers `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions with SHA-256 |
| **OpenCode CLI Execution Harness** | **Working** | Executes `opencode run` in isolated worktree with `--auto` and JSON streaming |
| **Model Router & Quota Allocation** | **Working** | Data-driven catalog (`orchlet.config.json`), tier selection, quota failover |
| **Automated Verification Runner** | **Working** | Runs test commands, captures stdout/stderr tails, exit codes, durations |
| **Independent AI Reviewer** | **Working** | OpenRouter-backed structured P0–P3 audit, strict fail-closed semantics in REAL mode (no silent static fallback) |
| **Automated Remediation Repair Loop** | **Working** | Repaired in worktree, re-tested, re-reviewed before commit |
| **Real Git Commits & Branch Management** | **Working** | Generates verified commits on work branch with full model audit log |
| **PR Babysitting & Gate Evaluation** | **Working** | Evaluates CI/review gates, conservative `autoMerge: false` default |
| **Remote Dashboard & WebSocket Stream** | **Working** | React + Vite UI with dynamic daemon URL, single-use 60s ticket auth, real-time events |
| **Docker & Docker Compose Packaging** | **Packaged** | Multi-stage Dockerfile and docker-compose deployment (`BLOCKED_BY_ENVIRONMENT` on non-elevated host) |
| **T3 Adapter Integration** | **Experimental** | Runtime discovery from `.t3` config and RPC turn dispatch |
| **Organization Token Budget Quotas** | **Planned** | Hard monthly token spend limits per team/repo |

---

## Quickstart

### Prerequisites

- **Node.js**: `v22.0.0` or later
- **pnpm**: `v10.0.0` or later
- **Git**: `2.30+`
- **GitHub CLI (`gh`)**: (Optional, for PR opening and babysitting)
- **OpenCode CLI**: (Optional, for local agent harness execution: `npm install -g opencode-ai`)

### 1. Installation & Build

```bash
git clone https://github.com/liltaket/Orchlet.git
cd Orchlet
pnpm install
pnpm run build
```

### 2. Run Tests

```bash
pnpm test
```

### 3. Start the Daemon & Dashboard

```bash
# Start the Fastify control plane daemon (port 4774)
pnpm --filter @orchlet/server start

# In another terminal, start the dashboard development server
pnpm --filter @orchlet/dashboard dev
```

Visit `http://localhost:5173` to open the Orchlet Control Plane Dashboard.

---

## Configuration (`orchlet.config.json`)

Orchlet reads configuration from `orchlet.config.json` in your repository root, `.orchlet/config.json`, or `~/.orchlet/config.json`:

```json
{
  "activeHarness": "opencode",
  "routingMode": "AUTO",
  "verification": ["npm test"],
  "git": {
    "push": false,
    "openPr": false,
    "autoMerge": false,
    "baseBranch": "main"
  },
  "budget": {
    "perTaskUsd": 0.5,
    "dailyUsd": 5.0,
    "monthlyUsd": 50.0,
    "hardStopAtPercent": 100
  },
  "roleMappings": {
    "executor": { "provider": "openrouter", "model": "z-ai/glm-5.3-flash" },
    "critic": { "provider": "openrouter", "model": "google/gemini-3.8-flash" },
    "repairer": { "provider": "openrouter", "model": "z-ai/glm-5.3-flash" }
  },
  "preferredModels": ["z-ai/glm-5.3-flash", "google/gemini-3.8-flash"]
}
```

---

## Docker Deployment

Self-host the Orchlet daemon using Docker Compose:

```bash
docker compose up -d --build
```

---

## Documentation & Architecture

- [**System Architecture Specification**](docs/ARCHITECTURE.md)
- [**Security Model & Self-Hosting Architecture**](docs/SECURITY_MODEL.md)
- [**V1 Release & Verification Checklist**](docs/V1_RELEASE_CHECKLIST.md)
- [**ADR-001: Autonomous Control Plane Architecture & Integration Strategy**](docs/adr/ADR-001-architecture-and-integration.md)
- **Deep-Dive Research Reports**:
  - [T3 Code Runtime, RPC & Protocol Analysis](docs/research/t3.md)
  - [Paseo Architecture & Worktree Isolation](docs/research/paseo.md)
  - [Gajae Code Tiered Routing & Role Allocation](docs/research/gajae.md)
  - [OpenCode Custom Agents & Upward Discovery](docs/research/opencode.md)
  - [Quota & Usage Visibility (OpenRouter, Codex, Gemini)](docs/research/usage.md)
  - [GitHub PR, CI & Review Babysitting Protocols](docs/research/github.md)
  - [Licensing & Clean-Room IP Strategy](docs/research/licensing.md)
  - [Third-Party Notices & Attributions](THIRD_PARTY.md)

---

## License

Orchlet is licensed under the permissive [MIT License](LICENSE).
