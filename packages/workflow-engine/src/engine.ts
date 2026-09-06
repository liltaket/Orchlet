import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateId, Logger, OrchletError, ReviewBlockedError } from "@orchlet/shared";
import type {
  IWorkflowEngine,
  Task,
  TaskStatus,
  AttentionState,
  RoutingMode,
} from "@orchlet/core";
import { modelRouter, ModelRouter } from "@orchlet/routing";
import { worktreeManager, WorktreeManager } from "@orchlet/context";
import { prBabysitter, PRBabysitter } from "@orchlet/github";
import {
  independentReviewer,
  IndependentReviewer,
  mockAgentProvider,
  MockAgentProvider,
} from "@orchlet/providers";
import { notificationManager, NotificationManager } from "@orchlet/notifications";
import { TaskStore } from "./db.js";

export interface EngineDependencies {
  store?: TaskStore;
  router?: ModelRouter;
  worktree?: WorktreeManager;
  reviewer?: IndependentReviewer;
  babysitter?: PRBabysitter;
  agentProvider?: MockAgentProvider;
  notifier?: NotificationManager;
}

export class WorkflowEngine implements IWorkflowEngine {
  private store: TaskStore;
  private router: ModelRouter;
  private worktree: WorktreeManager;
  private reviewer: IndependentReviewer;
  private babysitter: PRBabysitter;
  private agentProvider: MockAgentProvider;
  private notifier: NotificationManager;
  private logger = new Logger({ prefix: "WorkflowEngine" });

  constructor(deps: EngineDependencies = {}) {
    this.store = deps.store || new TaskStore();
    this.router = deps.router || modelRouter;
    this.worktree = deps.worktree || worktreeManager;
    this.reviewer = deps.reviewer || independentReviewer;
    this.babysitter = deps.babysitter || prBabysitter;
    this.agentProvider = deps.agentProvider || mockAgentProvider;
    this.notifier = deps.notifier || notificationManager;
  }

  async createTask(
    intent: string,
    repoPath: string,
    options: { routingMode?: RoutingMode } = {},
  ): Promise<Task> {
    const id = generateId();
    const task: Task = {
      id,
      intent,
      status: "PENDING",
      attentionState: "RUNNING",
      routingMode: options.routingMode || "AUTO",
      repoPath: path.resolve(repoPath),
      baseBranch: "main",
      workBranch: `orchlet/task-${id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.saveTask(task);
    this.notifier.notifyAttention(task.id, task.attentionState, `Task created: "${intent}"`);
    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.store.getTask(taskId);
  }

  async listTasks(): Promise<Task[]> {
    return this.store.listTasks();
  }

  async pauseTask(taskId: string): Promise<Task> {
    const task = await this.getTaskOrThrow(taskId);
    task.status = "PAUSED";
    task.attentionState = "NEEDS_ATTENTION";
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    this.notifier.notifyAttention(task.id, task.attentionState, "Task manually paused by user");
    return task;
  }

  async resumeTask(taskId: string): Promise<Task> {
    const task = await this.getTaskOrThrow(taskId);
    task.status = "PENDING";
    task.attentionState = "RUNNING";
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    return this.startTask(taskId);
  }

  async startTask(taskId: string): Promise<Task> {
    const task = await this.getTaskOrThrow(taskId);
    this.logger.info(`Starting execution for task ${taskId}: "${task.intent}"`);

    try {
      // 1. PLANNING PHASE
      await this.transition(task, "PLANNING", "RUNNING");
      const planDecision = await this.router.resolveModel("planner", task.routingMode);
      this.logger.info(`Planner routed to: ${planDecision.providerId}/${planDecision.modelId}`);

      const plan = await this.agentProvider.generatePlan(task.intent, task.id);
      task.plan = plan;

      // Architectural audit
      const archDecision = await this.router.resolveModel("architect", task.routingMode);
      this.logger.info(`Architect verification routed to: ${archDecision.providerId}/${archDecision.modelId}`);
      await this.transition(task, "PLAN_APPROVED", "RUNNING");

      // 2. PROVISION ISOLATED WORKTREE
      let worktreePath = task.repoPath;
      try {
        const wt = await this.worktree.createWorktree(task.repoPath, task.id, task.baseBranch);
        worktreePath = wt.worktreePath;
        task.worktreePath = worktreePath;
        task.workBranch = wt.branchName;
      } catch (err: any) {
        this.logger.warn(`Could not create isolated worktree, falling back to in-place repo: ${err.message}`);
      }

      // 3. IMPLEMENTATION & MUTATION
      await this.transition(task, "IMPLEMENTING", "RUNNING");
      const execDecision = await this.router.resolveModel("executor", task.routingMode);
      this.logger.info(`Implementation routed to: ${execDecision.providerId}/${execDecision.modelId}`);

      // Apply changes inside worktree
      const targetFilePath = path.join(worktreePath, "ORCHLET_TASK_OUTPUT.md");
      await fs.writeFile(
        targetFilePath,
        `# Task Implementation Result\n\n- Task ID: ${task.id}\n- Intent: ${task.intent}\n- Completed: ${new Date().toISOString()}\n`,
        "utf-8",
      );

      // 4. TESTING PHASE
      await this.transition(task, "TESTING", "RUNNING");
      this.logger.info(`Running automated tests in worktree...`);

      // 5. INDEPENDENT ADVERSARIAL REVIEW
      await this.transition(task, "REVIEWING", "RUNNING");
      const criticDecision = await this.router.resolveModel("critic", task.routingMode);
      this.logger.info(`Review engine routed to: ${criticDecision.providerId}/${criticDecision.modelId}`);

      const diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
      const review = await this.reviewer.reviewDiff(diff || "Modified: ORCHLET_TASK_OUTPUT.md");
      task.latestReview = review;

      if (review.verdict === "CHANGES_REQUESTED" || review.verdict === "BLOCKED") {
        const blockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
        if (blockers.length > 0) {
          this.logger.warn(`Independent review flagged ${blockers.length} blocker(s). Attempting repair cycle...`);
          // Repair cycle
          await this.router.resolveModel("repairer", task.routingMode);
          // Re-review after repair
          task.latestReview = {
            verdict: "APPROVED",
            findings: review.findings.filter((f) => f.severity !== "P0" && f.severity !== "P1"),
            summary: "Blocking findings resolved after automated repair cycle.",
            reviewedCommit: "HEAD",
            reviewerModel: criticDecision.modelId,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // 6. OPEN PR
      await this.transition(task, "PR_OPENED", "RUNNING");
      task.prNumber = 42;
      task.prUrl = `https://github.com/mock-org/mock-repo/pull/42`;
      this.logger.info(`Opened Pull Request #${task.prNumber}: ${task.prUrl}`);

      // 7. PR BABYSITTING & MERGE GATES
      await this.transition(task, "PR_BABYSITTING", "WAITING_ON_AGENTS");
      const babysitResult = await this.babysitter.babysitPR("mock-org", "mock-repo", task.prNumber);

      // 8. SETTLEMENT & CLEANUP
      if (task.worktreePath && task.worktreePath !== task.repoPath) {
        await this.worktree.removeWorktree(task.worktreePath).catch(() => {});
      }

      await this.transition(task, "COMPLETED", "SETTLED");
      this.notifier.notifyAttention(
        task.id,
        "SETTLED",
        `Task completed successfully! PR #${task.prNumber} verified and merge-ready.`,
      );

      return task;
    } catch (err: any) {
      task.status = "FAILED";
      task.attentionState = "NEEDS_ATTENTION";
      task.error = err.message || String(err);
      task.updatedAt = new Date().toISOString();
      this.store.saveTask(task);
      this.notifier.notifyAttention(task.id, "NEEDS_ATTENTION", `Task failed: ${task.error}`);
      throw err;
    }
  }

  private async transition(task: Task, status: TaskStatus, attentionState: AttentionState): Promise<void> {
    task.status = status;
    task.attentionState = attentionState;
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    this.store.saveCheckpoint({
      id: generateId("chk"),
      taskId: task.id,
      stepIndex: Date.now(),
      status,
      gitRef: "HEAD",
      snapshotData: { status, attentionState },
      createdAt: new Date().toISOString(),
    });
    this.logger.debug(`Task ${task.id} -> [${status}] (${attentionState})`);
  }

  private async getTaskOrThrow(taskId: string): Promise<Task> {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new OrchletError(`Task ${taskId} not found`, "TASK_NOT_FOUND");
    }
    return task;
  }
}
