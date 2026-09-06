import type {
  Task,
  TaskStatus,
  Plan,
  PlanStep,
  ReviewVerdict,
  RoutingMode,
  ModelTier,
  AgentRole,
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
  babysitPR(repoOwner: string, repoName: string, prNumber: number): Promise<{
    merged: boolean;
    reason?: string;
  }>;
}
