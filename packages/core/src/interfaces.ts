import type {
  Task,
  ReviewVerdict,
  RoutingMode,
  ModelTier,
  AgentRole,
  AgentRequest,
  AgentResult,
  TaskPacket,
  ReviewFinding,
  VerificationResult,
  OrchletConfig,
} from "./types.js";

export interface IWorkflowEngine {
  createTask(intent: string, repoPath: string, options?: { routingMode?: RoutingMode }): Promise<Task>;
  startTask(taskId: string): Promise<Task>;
  pauseTask(taskId: string): Promise<Task>;
  resumeTask(taskId: string): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Promise<Task[]>;
}

export interface IModelRouter {
  resolveModel(role: AgentRole, mode: RoutingMode): Promise<{
    providerId: string;
    modelId: string;
    tier: ModelTier;
    estimatedCostWeight: number;
    reason?: string;
  }>;
}

export interface IWorktreeManager {
  createWorktree(repoPath: string, taskId: string, baseBranch?: string): Promise<{
    worktreePath: string;
    branchName: string;
  }>;
  removeWorktree(worktreePath: string): Promise<void>;
  getDiff(worktreePath: string, baseBranch?: string): Promise<string>;
}

export interface IReviewEngine {
  reviewDiff(diff: string, contextPrompt?: string): Promise<ReviewVerdict>;
}

export interface IBabysitter {
  babysitPR(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    options?: { maxPollAttempts?: number; simulate?: boolean; autoMerge?: boolean },
  ): Promise<{
    merged: boolean;
    readyToMerge?: boolean;
    reason?: string;
  }>;
}

export interface IAgentExecutor {
  readonly harnessName: string;
  execute(request: AgentRequest): Promise<AgentResult>;
}

export interface IVerificationRunner {
  runVerification(commands: string[], worktreePath: string): Promise<VerificationResult[]>;
}

export interface IContextBuilder {
  buildPacket(
    taskId: string,
    objective: string,
    projectRoot: string,
    audience: "implementer" | "reviewer",
    options?: { planSummary?: string; blockingFindings?: ReviewFinding[] },
  ): Promise<TaskPacket>;
}

export interface IConfigurationManager {
  loadConfig(projectRoot?: string): Promise<OrchletConfig>;
}
