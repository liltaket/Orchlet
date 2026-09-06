export type HealthState =
  | "abundant"
  | "healthy"
  | "constrained"
  | "critical"
  | "exhausted";

export type QuotaWindowType =
  | "sliding_minutes"
  | "sliding_weekly"
  | "daily_fixed"
  | "monthly_fixed"
  | "credit_balance";

export interface QuotaWindow {
  name: string;
  type: QuotaWindowType;
  windowMinutes?: number;
  usedPercent: number;          // 0.0 to 100.0
  usedUnits?: number;
  limitUnits?: number;
  resetsAt: string | null;      // ISO string
  resetRemainingMs: number;
}

export interface UsageSnapshot {
  providerId: string;
  providerType: "openrouter" | "codex_chatgpt" | "antigravity_gemini" | "custom";
  planType?: string;
  healthState: HealthState;
  healthReason?: string;
  windows: QuotaWindow[];
  limitRemainingUsd?: number;
  totalSpentUsd?: number;
  updatedAt: string;
}

export function calculateHealthState(windows: QuotaWindow[], isThrottled = false): HealthState {
  if (isThrottled) return "exhausted";
  if (!windows || windows.length === 0) return "healthy";

  const maxUsed = Math.max(...windows.map((w) => w.usedPercent));
  if (maxUsed >= 100) return "exhausted";
  if (maxUsed >= 85) return "critical";
  if (maxUsed >= 65) return "constrained";
  if (maxUsed >= 30) return "healthy";
  return "abundant";
}
