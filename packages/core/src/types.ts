export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "PLAN_APPROVED"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "REVIEWING"
  | "REPAIRING"
  | "COMMITTED"
  | "PR_BABYSITTING"
  | "READY_TO_MERGE"
  | "SETTLED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type AttentionState =
  | "RUNNING"
  | "WAITING_ON_AGENTS"
  | "NEEDS_ATTENTION"
  | "SETTLED";

export type RoutingMode = "AUTO" | "CHEAP" | "QUALITY" | "BEST";

export type ExecutionMode = "REAL" | "MOCK";

export type AgentRole =
  | "planner"
  | "architect"
  | "executor"
  | "critic"
  | "repairer"
  | "babysitter";

export type ModelTier = "fast" | "balanced" | "strong";

export const SUPPORTED_REVIEWER_PROVIDERS = ["openrouter"] as const;
export type SupportedReviewerProvider = typeof SUPPORTED_REVIEWER_PROVIDERS[number];

export interface ExecutorCapabilities {
  roles: AgentRole[];
  filesystem: boolean;
  shell: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  modelSelection: boolean;
  providerSelection: boolean;
  isMock: boolean;
}

export interface PlanStep {
  id: string;
  description: string;
  targetFiles?: string[];
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  resultSummary?: string;
}

export interface Plan {
  id: string;
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
  providerUsed?: string;
  tokensUsed?: { prompt: number; completion: number; total: number };
  costEstimate?: number;
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
  roleMappings?: Record<string, { tier?: ModelTier; model?: string; provider?: string }>;
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
  executionMode?: ExecutionMode;
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

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  tier: ModelTier;
  estimatedCostWeight: number;
  reason: string;
  fallbackHops: number;
  candidatesConsidered: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  text: string;
  model: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUsd?: number;
}
