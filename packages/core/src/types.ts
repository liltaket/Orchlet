export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "PLAN_APPROVED"
  | "IMPLEMENTING"
  | "TESTING"
  | "REVIEWING"
  | "PR_OPENED"
  | "PR_BABYSITTING"
  | "READY_TO_MERGE"
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

export interface ContextFile {
  filePath: string;
  relativePath: string;
  sourceType: "AGENTS" | "CLAUDE" | "GEMINI" | "COPILOT" | "ORCHLET" | "OTHER";
  content: string;
  sha256: string;
}

export interface ContextBundle {
  files: ContextFile[];
  bundleFingerprint: string;
  audience: "implementer" | "reviewer";
}

export interface TaskPacket {
  taskId: string;
  objective: string;
  contextBundle: ContextBundle;
  planSummary?: string;
  handoffNotes?: string;
  blockingFindings?: ReviewFinding[];
}

export interface AgentRequest {
  taskId: string;
  role: AgentRole;
  userObjective: string;
  taskPacket: TaskPacket;
  worktreePath: string;
  selectedModel: {
    providerId: string;
    modelId: string;
    tier: ModelTier;
  };
  permissions: {
    allowFileSystem: boolean;
    allowBash: boolean;
    allowNetwork?: boolean;
  };
  expectedSchema?: "json" | "plan" | "review" | "freeform";
}

export interface AgentResult {
  success: boolean;
  textResponse?: string;
  structuredData?: Record<string, unknown>;
  changedFiles: string[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costEstimateUsd?: number;
  };
  modelUsed: string;
  providerUsed: string;
  durationMs: number;
  error?: string;
}

export interface VerificationCommand {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface VerificationResult {
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  passed: boolean;
}

export interface GitConfig {
  push?: boolean;
  openPr?: boolean;
  autoMerge?: boolean;
  baseBranch?: string;
  commitAuthor?: {
    name: string;
    email: string;
  };
}

export interface ModelConfigEntry {
  provider: string;
  model: string;
  tier: ModelTier;
  strengths?: string[];
  costWeight?: number;
}

export interface OrchletConfig {
  models?: Record<string, ModelConfigEntry>;
  roleMappings?: Partial<Record<AgentRole, { tier?: ModelTier; model?: string; provider?: string }>>;
  git?: GitConfig;
  verification?: string[];
  activeHarness?: "opencode" | "openrouter" | "mock";
}

export interface ModelUsageRecord {
  role: AgentRole;
  provider: string;
  model: string;
  durationMs: number;
  tokens?: number;
  costUsd?: number;
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
  commitSha?: string;
  plan?: Plan;
  latestReview?: ReviewVerdict;
  verificationResults?: VerificationResult[];
  modelUsageAudit?: ModelUsageRecord[];
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
