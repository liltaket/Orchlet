# OpenCode Architecture, Custom Agents & Instruction Discovery: Research

## 1. Executive Summary

OpenCode (`anomalyco/opencode`, MIT licensed) provides a clean, extensible approach to custom agent definitions, granular tool permissions, and dynamic instruction discovery. This document analyzes OpenCode's upward `AGENTS.md` discovery engine, YAML frontmatter configurations, and child process execution model for integration into Orchlet.

---

## 2. Dynamic Upward `AGENTS.md` Discovery Engine

To prevent upfront token bloat while ensuring relevant project conventions are adhered to, OpenCode implements **nearest-first, on-demand upward discovery**:

1. **Root Scoping**: At session initialization, the orchestrator checks the repository root for top-level `AGENTS.md` (or `CLAUDE.md`).
2. **Subdirectory On-Demand Discovery**: Intermediate instructions (e.g. `packages/workflow-engine/AGENTS.md`) are not loaded globally upfront. When an agent opens or mutates a file within a directory:
   - The engine traverses upward from the target file directory to the repository root.
   - Any intermediate `AGENTS.md` or `ORCHLET.md` files are parsed and injected chronologically in **nearest-first order**.
   - A persistent session cache (`loadedPaths`) guarantees each instruction file is injected **at most once**.

---

## 3. Custom Agent Definitions & Granular Permission Matrix

OpenCode defines agents declaratively using Markdown with YAML frontmatter in `.orchlet/agents/<name>.md`:

```markdown
---
name: security-auditor
description: Specialized auditor checking for prompt injections and secret leaks
mode: subagent
tier: strong
permission:
  edit: deny
  write: deny
  bash: ask
  webfetch: allow
  subagent: deny
---
You are an independent security auditor...
```

### Permission Dimensions
- `edit`: Modifying existing files (`allow` | `ask` | `deny`).
- `write`: Creating new files (`allow` | `ask` | `deny`).
- `bash`: Executing shell commands (`allow` | `ask` | `deny`).
- `webfetch`: Fetching external HTTP URLs (`allow` | `ask` | `deny`).
- `subagent`: Recursively launching child subagents (`allow` | `ask` | `deny`).

### Strict Subagent Isolation
Unlike naive orchestrators where subagents inherit the parent's full administrative privileges, OpenCode enforces **least-privilege scoping**:
- If an agent is spawned with `mode: subagent` and `edit: deny`, any attempt by that agent to invoke write tools is rejected at the tool dispatcher layer, regardless of parent permissions.

---

## 4. Architectural Adaptations for Orchlet

Orchlet adopts:
1. **`@orchlet/context`**: Implements the upward `AGENTS.md` / `ORCHLET.md` nearest-first discovery engine.
2. **Declarative Subagents**: Allows users to drop custom agent specifications into `.orchlet/agents/*.md` with YAML frontmatter.
3. **Execution Runtime**: Supports running OpenCode as a local child process provider via `opencode serve` CLI.
