# Gajae Code Model Routing & Role Allocation: Architectural Research

## 1. Executive Summary

Gajae Code (`Yeachan-Heo/gajae-code`) is an open-source (MIT licensed) AI coding agent framework that introduces dynamic **Task Autorouting (Smart Routing)** and specialized subagent role allocation. This document outlines Gajae Code's architecture, model tiers, fallback chains, provider prioritization, and concrete adaptations for Orchlet.

---

## 2. Dynamic Model Tiers: `fast`, `balanced`, `strong`

Rather than hardcoding specific proprietary model names, Gajae Code dynamically derives tier classification from model catalog capabilities, context size, reasoning parameters, and cost weights:

- **`fast` Tier**:
  - High-throughput, sub-second latency, lightweight token cost (e.g. Claude 3.5 Haiku, Qwen 2.5 Coder 32B, GPT-4o-mini).
  - Target workloads: quick summaries, ast/file classification, commit message generation, simple unit test scaffold generation.
- **`balanced` Tier**:
  - Default daily coding engines (e.g. Claude 3.7 Sonnet standard, OpenAI Codex, DeepSeek-V3).
  - Target workloads: implementation, refactoring, multi-file edits, code generation.
- **`strong` Tier**:
  - High compute, deep reasoning effort, and adversarial critique models (e.g. Claude 3.7 Sonnet Thinking high effort, o3-mini high, o1).
  - Target workloads: architectural verification, security critique, complex dependency resolution, consensus arbitration.

---

## 3. Role-Based Subagent Allocation Matrix

Gajae Code strictly adheres to the **Plan-Before-Mutation** architectural pattern. Permissions and compute tiers are tailored specifically per role:

| Subagent Role | Permissions | Responsibilities | Compute Tier |
| :--- | :--- | :--- | :--- |
| **`planner`** | Read-Only | Analyzes requirements, checks workspace layout, decomposes tasks into sequential milestones. | `balanced` (Medium Effort) |
| **`architect`** | Read-Only | Validates structural boundaries, enforces monorepo guidelines, issues verdicts (`CLEAR`, `WATCH`, `BLOCK`). | `strong` (High Effort) |
| **`executor`** | Read/Write (Mutations) | Executes code modifications, applies patches, runs bash/terminal commands. Only role allowed to mutate code. | `balanced` / `fast` |
| **`critic`** | Read-Only | Adversarial review, failure-mode probing, invariant verification (`ralplan`). | `strong` (High / Max Effort) |

---

## 4. Provider Priority, Credential Hierarchy & Fallback Chains

1. **Resolution Hierarchy**:
   - Explicit session override (`--model`, `--api-key`)
   - Local reverse proxy (`models.yml` - LiteLLM, vLLM, Ollama)
   - Direct upstream API keys (Anthropic, OpenAI, OpenRouter)
   - Subscription OAuth tokens (Codex, Claude, Google AI)
2. **Error Classification & Circuit Breaking**:
   - *Retryable Errors*: HTTP 429 (rate limit), HTTP 502/503/504 (gateway drops). Automatically triggers sticky failover to the next candidate in the fallback chain.
   - *Non-Retryable Errors*: HTTP 400 (malformed schema), HTTP 401/403 (invalid auth). Aborts candidate immediately.

---

## 5. Architectural Adaptations for Orchlet

Orchlet directly incorporates Gajae Code's role-based allocation and dynamic tier resolution into `@orchlet/routing`:
- Strict permission gates prevent read-only roles (`planner`, `architect`, `critic`) from mutating files or executing arbitrary bash commands.
- Quota-aware tier selection balances cost and quality by routing the expensive `strong` tier strictly to critical review and architectural checkpoints.
