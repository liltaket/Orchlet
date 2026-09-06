# Orchlet

> **Autonomous AI Coding-Agent Orchestration Control Plane**  
> Say what you want done once. Orchlet plans, models, executes, tests, independently reviews, opens, and babysits your GitHub PR until clean merge.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js: 24+](https://img.shields.io/badge/Node.js-24%2B-brightgreen.svg)]()
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict-blue.svg)]()

---

## What is Orchlet?

Orchlet is a production-minded, open-source AI coding-agent orchestration control plane. It bridges the gap between single-prompt code generation and end-to-end software delivery by owning the entire task lifecycle:

1. **Autonomous Planning & Architecture**: Decomposes high-level goals into executable milestones using read-only architectural verification.
2. **Dynamic Quota-Aware Model Routing (`AUTO`)**: Automatically balances reasoning capability against cost, routing tasks between `fast`, `balanced`, and `strong` model tiers while actively respecting 5-hour rolling burst limits and weekly subscription quota pools.
3. **Strict Git Worktree Sandboxing**: Isolates all agent mutations within ephemeral Git worktrees (`.orchlet/worktrees/<task-id>`), preventing file contention with your working directory.
4. **Independent Adversarial Review (P0–P3 Severity)**: Runs dedicated audit agents with fresh context against the git diff, ranking issues by severity and automatically triggering fix cycles for `P0` blockers and `P1` defects.
5. **Full PR & CI Babysitting**: Opens GitHub PRs, monitors CI check runs with jittered exponential backoff, extracts high-signal error diagnostics, clusters maintainer feedback by file, commits repairs, and safely executes preflight merge gates.
6. **Crash Recoverability**: Persists every turn, command, and checkpoint to an embedded SQLite database. If interrupted, Orchlet resumes from the last clean checkpoint without re-billing tokens.
7. **Harness & Provider Independence**: Seamlessly connects to T3 Code, OpenCode, Codex, Google Gemini / Antigravity, OpenRouter, and Claude without requiring forks.

---

## Documentation & Architecture

- [**System Architecture Specification**](docs/ARCHITECTURE.md)
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
