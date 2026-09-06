# ADR-001: Autonomous Control Plane Architecture & Least-Fragile Integration Strategy

## Status
**ACCEPTED** (2026-09-06)

## Context
Orchlet is designed to be a production-minded, open-source AI coding-agent orchestration control plane. A developer should express high-level intent once, and Orchlet should autonomously plan, implement, test, independently review, open, and babysit a GitHub PR until clean merge.

The primary architectural challenges involve:
1. **Editor/Harness Coupling vs. Independence**: How to support advanced IDEs (such as T3 Code, VS Code, Cursor, OpenCode) without being bound to proprietary internals or requiring forks.
2. **Worktree Isolation vs. In-Place File Contention**: Preventing concurrent agent edits from colliding with each other or the developer's active working tree.
3. **Model Cost & Quota Economics**: How to deliver high-quality autonomous outcomes without burning expensive reasoning quotas on routine tasks or crashing into `429` rate limits.
4. **Independent Review Integrity**: Guaranteeing that reviews are unbiased, rigorous, and automated.
5. **PR Lifecycle Ownership**: Babysitting PRs through CI runs, review comments, and merge gates without requiring external webhook infrastructure.

## Decision

### 1. Standalone Control Plane Daemon with Multi-Transport Ingress
- Orchlet runs as an independent local daemon (`apps/server`) backed by an embedded SQLite database (`better-sqlite3`).
- It exposes a unified Fastify HTTP and WebSocket API for UI dashboards, CLI clients, and external editor bridges.
- **T3 Code Integration**: Orchlet does not fork T3 or inject into its process. T3 integration is realized via:
  - An MCP (Model Context Protocol) tool bridge.
  - A clean T3 HTTP/WebSocket client adapter (`@orchlet/t3-adapter`) that can dispatch turns and subscribe to threads.
  - Standard `SKILL.md` slash command registrations.

### 2. Git Worktree Workspace Sandboxing
- All code modifications are performed in ephemeral Git worktrees located in `.orchlet/worktrees/<task-id>`.
- The developer's primary working directory remains untouched throughout agent planning, execution, and verification.
- Worktrees are pruned atomically upon task completion or rollback.

### 3. Dynamic Tiered Model Routing with `AUTO` Default
- Models are categorized into `fast`, `balanced`, and `strong` tiers.
- The default routing strategy is `AUTO` (maximizing probability of success while minimizing cost).
- Quotas are actively monitored across 5-hour rolling burst windows, weekly pools, and prepaid balances (supporting OpenRouter, OpenAI/Codex, Google Gemini/Antigravity).
- Automatic fallback chains route around constrained or exhausted accounts.

### 4. Independent Adversarial Review with P0–P3 Taxonomy
- Review is executed in an isolated audit session with a distinct model (`strong` tier) and prompt context.
- Reviews evaluate the unified diff and output structured findings categorized into `P0` (blocker), `P1` (critical defect), `P2` (improvement), and `P3` (nit).
- Any `P0` or `P1` finding halts PR creation and triggers an automated fix turn.

### 5. In-Process GitHub Babysitter with Jittered Backoff
- PR babysitting is executed using Octokit with a hybrid auth model (extracting tokens dynamically from `gh auth token`).
- Single consolidated GraphQL queries poll PR status, CI check suites, and review threads.
- Polling uses adaptive jittered exponential backoff (15s to 120s) to conserve API rate limits.
- CI logs are trimmed using line-level annotations and sliding error windows before sending to fixing agents.
- Safe preflight merge gates ensure that only clean, passing, approved, up-to-date branches are merged.

## Consequences

### Positive
- **Zero Fragility**: No dependence on unpublished internal APIs or editor forks. Orchlet functions identically in headless CI, terminal CLI, or integrated with T3.
- **Robust Isolation**: The developer can continue their work while agents code in parallel worktrees without file conflicts.
- **Cost Efficiency**: Expensive reasoning models are reserved strictly for architectural verification and adversarial review.
- **Resilience**: Crashes during execution can be resumed from the exact SQLite checkpoint without duplicating API costs.

### Negative / Trade-offs
- Ephemeral worktrees require local disk space and initial setup time (running `git worktree add`).
- Polling GitHub without webhooks introduces a 15–30 second latency before detecting new CI finishes or comments.
