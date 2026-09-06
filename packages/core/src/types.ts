export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "PLAN_APPROVED"
  | "IMPLEMENTING"
  | "TESTING"
  | "REVIEWING"
  | "PR_OPENED"
  | "PR_BABYSITTING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED";

export type AttentionState =
  | "RUNNING"
  | "WAITING_ON_AGENTS"
  | "NEEDS_ATTENTION"
  | "SETTLED";

export type RoutingMode = "AUTO" | "CHEAP" | "QUALITY" | "BEST" | "MANUAL";

export type ModelTier = "fast" | "balanced" | "strong";

export type AgentRole = "planner" | "architect" | "executor" | "critic" | "repairer";

export interface PlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  targetFiles?: string[];
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  resultSummary?: string;
}

export interface Plan {
  id: string;
  taskId: string;
  title: string;
  summary: string;
  steps: PlanStep[];
  architectVerdict?: "APPROVED" | "CHANGES_REQUESTED";
  architectNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type FindingSeverity = "P0" | "P1" | "P2" | "P3";

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  filePath: string;
  lineRange?: { start: number; end: number };
  description: string;
  suggestedFix?: string;
  securityImpact?: boolean;
}

export interface ReviewVerdict {
  verdict: "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED";
  findings: ReviewFinding[];
  summary: string;
  reviewedCommit: string;
  reviewerModel: string;
  timestamp: string;
}

export interface Task {
  id: string;
  intent: string;
  status: TaskStatus;
  attentionState: AttentionState;
  routingMode: RoutingMode;
  repoPath: string;
  baseBranch: string;
  workBranch: string;
  worktreePath?: string;
  plan?: Plan;
  latestReview?: ReviewVerdict;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  stepIndex: number;
  status: TaskStatus;
  gitRef: string;
  snapshotData: Record<string, unknown>;
  createdAt: string;
}
