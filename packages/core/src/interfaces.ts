import type {
  AgentRequest,
  AgentResult,
  ChatCompletionOptions,
  ChatCompletionResult,
  Plan,
  ReviewVerdict,
  RoutingDecision,
  RoutingMode,
  Task,
  TaskPacket,
  VerificationResult,
} from "./types.js";

export interface IWorkflowEngine {
  createTask(intent: string, repoPath: string, options?: { routingMode?: RoutingMode }): Promise<Task>;
  startTask(taskId: string): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Task[];
  resumeTask(taskId: string): Promise<Task>;
}

export interface IContextBuilder {
  buildPacket(
    taskId: string,
    objective: string,
    projectRoot: string,
    audience: "implementer" | "reviewer",
    options?: { planSummary?: string; blockingFindings?: any[] },
  ): Promise<TaskPacket>;
}

export interface IModelRouter {
  resolveModel(role: string, mode?: RoutingMode): Promise<RoutingDecision>;
}

export interface IWorktreeManager {
  createWorktree(repoPath: string, taskId: string, baseBranch?: string): Promise<{ worktreePath: string; branchName: string }>;
  removeWorktree(worktreePath: string): Promise<void>;
  getDiff(worktreePath: string, baseBranch?: string): Promise<string>;
}

export interface ReviewOptions {
  model?: string;
  provider?: string;
}

export interface IReviewEngine {
  reviewDiff(
    diff: string,
    contextPrompt?: string,
    verificationResults?: VerificationResult[],
    packet?: TaskPacket,
    options?: ReviewOptions,
  ): Promise<ReviewVerdict>;
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
  execute(request: AgentRequest): Promise<AgentResult>;
}

export interface IVerificationRunner {
  runVerification(commands: string[], worktreePath: string): Promise<VerificationResult[]>;
}

export interface INotificationManager {
  notifyAttention(taskId: string, state: string, message: string): void;
}
