# Quota & Usage Visibility: OpenRouter, Codex/ChatGPT, and Google Antigravity

## 1. Executive Summary

Autonomous AI coding agents consume significant token volume and inference budget across planning, implementation, tool execution, and iterative review loops. To satisfy Orchlet's primary optimization goals:
- **Low inference/subscription cost**
- **Intelligent use of available quotas**
- **Transparent routing decisions**

Orchlet implements a unified, proactive usage and health monitoring architecture. This document analyzes the quota protocols and telemetry schemas of **OpenRouter**, **Codex / ChatGPT Subscription**, and **Google Antigravity / Gemini**, and presents Orchlet's normalized abstraction model.

---

## 2. Provider Quota Protocols & Schemas

### 2.1 OpenRouter
- **Model**: Credit balance / prepaid wallet with optional per-key spending limits.
- **Key Inspection (`GET https://openrouter.ai/api/v1/auth/key`)**:
  - `limit`: Spending cap in USD for this key (`null` if unlimited).
  - `limit_remaining`: Spendable USD balance remaining before key throttling.
  - `usage`: Lifetime cumulative spend in USD.
  - `usage_daily`, `usage_weekly`, `usage_monthly`: Partitioned spend metrics.
  - `rate_limit`: Windowed request cap (e.g. 1,000 req / 10s).
- **Post-Generation Reconciliation (`GET https://openrouter.ai/api/v1/generation?id=<id>`)**:
  - Provides exact audit numbers: `total_cost`, `tokens_prompt`, `tokens_completion`, `tokens_cached`, and `cache_discount`.
- **Throttling & Backoff**:
  - OpenRouter returns `HTTP 429` with `x-ratelimit-remaining: 0` and `x-ratelimit-reset` (epoch ms).

### 2.2 OpenAI / Codex ChatGPT Subscriptions (Plus, Pro, Team, Enterprise)
- **Model**: Dual-window sliding allowance rather than pay-as-you-go token accounting.
- **Telemetry Schema (`account/rateLimits/read` & event messages)**:
  - **Primary Window (Burst)**: 5-hour rolling window (300 minutes). Prevents runaway burst exhaustion while coding.
  - **Secondary Window (Weekly)**: 7-day rolling window (10,080 minutes). Bounds total multi-day reasoning budget.
  - `used_percent`: Normalized percentage (`0.0` to `100.0`).
  - `resets_at`: Epoch timestamp when window rolls over or resets.
  - `reset_credits`: Instant limit reset coupons (if granted by enterprise/plus tier).

### 2.3 Google Antigravity / Gemini
- **Model**: "Work Done" compute burn accounting across unified Gemini Pro and Flash pools.
- **Quota Windows**:
  - **Sprint Window**: Rolling 5-hour high-throughput capacity.
  - **Baseline Ceiling**: 7-day rolling capacity.
- **Signal Ingestion**:
  - CLI telemetry via `agy /usage` and session context commands.
  - gRPC error inspection: `8 RESOURCE_EXHAUSTED` (`HTTP 429`) with `google.rpc.QuotaFailure` distinguishing between:
    - *RPM/TPM Short Throttling*: Accompanied by short `retryDelay` in `google.rpc.RetryInfo`. Handled via backoff.
    - *Sprint Quota Exhaustion*: High-tier model quota depleted; triggers automatic failover from `gemini-pro` to `gemini-flash` or external provider.

---

## 3. Normalized Health States & Transition Calculus

To drive autonomous routing decisions across heterogeneous providers without leaky abstractions, Orchlet maps all provider signals into five canonical **Health States**:

```
[ ABUNDANT ]  ──(usage >= 30%)──>  [ HEALTHY ]  ──(usage >= 65%)──>  [ CONSTRAINED ]
     ^                                  |                                   |
     │                                  │ (usage >= 85%)                    │ (usage >= 85%)
     │                                  v                                   v
[ EXHAUSTED ] <──(HTTP 429 / 100%)── [ CRITICAL ] <────────────────────────┘
```

| Health State | Quota / Window Utilization | Routing Engine Behavior |
| :--- | :--- | :--- |
| **`abundant`** | `max(windows) < 30%` | Maximum parallelism; high-concurrency subagents, extensive exploratory planning, deep repo context indexing. |
| **`healthy`** | `30% <= max(windows) < 65%` | Standard operational profile; balanced model tiers. |
| **`constrained`** | `65% <= max(windows) < 85%` | Compact context windows; serialize subagent execution; suppress speculative background tasks. |
| **`critical`** | `85% <= max(windows) < 100%` | Reserve provider for interactive developer turns; route subtasks to cheaper or secondary accounts. |
| **`exhausted`** | `100%` or active `429` | Failover to alternate provider or sleep until `resets_at`. |

---

## 4. Unified TypeScript Interface (`@orchlet/usage`)

```typescript
export interface QuotaWindow {
  id: "primary" | "secondary" | string;
  kind: "session" | "weekly" | "monthly" | "credit_balance";
  windowMinutes?: number;
  usedPercent: number;          // 0.0 - 100.0
  resetsAt?: Date | null;
  resetRemainingMs: number;
}

export interface UsageSnapshot {
  providerId: string;
  providerType: "openrouter" | "codex" | "antigravity" | "custom";
  healthState: "abundant" | "healthy" | "constrained" | "critical" | "exhausted";
  healthReason?: string;
  windows: QuotaWindow[];
  balanceUsd?: number;
  limitRemainingUsd?: number;
  updatedAt: Date;
}

export interface UsageProvider {
  readonly providerId: string;
  getSnapshot(forceRefresh?: boolean): Promise<UsageSnapshot>;
  recordCall(usage: { promptTokens: number; completionTokens: number; costUsd?: number }): void;
  parseError(error: unknown): { isThrottled: boolean; retryDelayMs?: number } | null;
  subscribe(callback: (snapshot: UsageSnapshot) => void): () => void;
}
```
