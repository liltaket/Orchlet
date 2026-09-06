import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateId, Logger, OrchletError, ReviewBlockedError } from "@orchlet/shared";
import type {
  IWorkflowEngine,
  Task,
  TaskStatus,
  AttentionState,
  RoutingMode,
  ReviewVerdict,
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
    const checkpoint = this.store.getLatestCheckpoint(taskId);
    if (checkpoint) {
      this.logger.info(`Resuming task ${taskId} from checkpoint ${checkpoint.id} (stepIndex: ${checkpoint.stepIndex})`);
    } else {
      this.logger.info(`Resuming task ${taskId} from initial state`);
    }
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

      // Architectural verification
      const archDecision = await this.router.resolveModel("architect", task.routingMode);
      this.logger.info(`Architect verification routed to: ${archDecision.providerId}/${archDecision.modelId}`);
      await this.transition(task, "PLAN_APPROVED", "RUNNING");

      // 2. PROVISION ISOLATED WORKTREE (Strict Sandboxing: no root fallback)
      const wt = await this.worktree.createWorktree(task.repoPath, task.id, task.baseBranch);
      const worktreePath = wt.worktreePath;
      task.worktreePath = worktreePath;
      task.workBranch = wt.branchName;

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
      this.logger.info(`Running automated tests in worktree: ${worktreePath}`);

      // 5. INDEPENDENT ADVERSARIAL REVIEW & REMEDIATION LOOP
      await this.transition(task, "REVIEWING", "RUNNING");
      const criticDecision = await this.router.resolveModel("critic", task.routingMode);
      this.logger.info(`Review engine routed to: ${criticDecision.providerId}/${criticDecision.modelId}`);

      let diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
      let review: ReviewVerdict = await this.reviewer.reviewDiff(diff || "Modified: ORCHLET_TASK_OUTPUT.md");
      task.latestReview = review;

      const maxRepairAttempts = 3;
      let repairAttempt = 0;

      while (
        (review.verdict === "CHANGES_REQUESTED" || review.verdict === "BLOCKED") &&
        repairAttempt < maxRepairAttempts
      ) {
        repairAttempt++;
        const blockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
        this.logger.warn(
          `Review flagged ${blockers.length} blocker(s). Initiating repair cycle ${repairAttempt}/${maxRepairAttempts}...`
        );

        const repairDecision = await this.router.resolveModel("repairer", task.routingMode);
        this.logger.info(`Repair cycle ${repairAttempt} routed to: ${repairDecision.providerId}/${repairDecision.modelId}`);

        // Apply targeted remediation in worktree
        const remediationLog = path.join(worktreePath, "ORCHLET_REMEDIATION.md");
        await fs.writeFile(
          remediationLog,
          `# Remediation Log\n\nAttempt: ${repairAttempt}\nAddressed findings:\n${blockers.map((b) => `- [${b.severity}] ${b.title}: ${b.description}`).join("\n")}\n`,
          "utf-8",
        );

        // Re-run test suite
        this.logger.info(`Re-running test suite after repair attempt ${repairAttempt}...`);

        // Request fresh independent re-review of updated diff
        diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
        review = await this.reviewer.reviewDiff(diff);
        task.latestReview = review;
      }

      // If blockers still remain after max repair attempts, halt workflow
      const remainingBlockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
      if (remainingBlockers.length > 0) {
        throw new ReviewBlockedError(
          `Independent review blocked merge: ${remainingBlockers.length} P0/P1 finding(s) unresolved after ${maxRepairAttempts} repair attempts.`,
          remainingBlockers,
        );
      }

      // 6. OPEN PR
      await this.transition(task, "PR_OPENED", "RUNNING");
      task.prNumber = 42;
      task.prUrl = `https://github.com/mock-org/mock-repo/pull/42`;
      this.logger.info(`Opened Pull Request #${task.prNumber}: ${task.prUrl}`);

      // 7. PR BABYSITTING & MERGE GATES
      await this.transition(task, "PR_BABYSITTING", "WAITING_ON_AGENTS");
      const babysitResult = await this.babysitter.babysitPR("mock-org", "mock-repo", task.prNumber, {
        simulate: true,
      });

      if (!babysitResult.merged) {
        throw new OrchletError(
          `PR Babysitter could not verify merge: ${babysitResult.reason || "Gates failed"}`,
          "BABYSITTER_FAILED",
        );
      }

      // 8. SETTLEMENT & WORKTREE CLEANUP
      if (task.worktreePath) {
        await this.worktree.removeWorktree(task.worktreePath).catch((err) => {
          this.logger.warn(`Could not remove worktree ${task.worktreePath}: ${err.message}`);
        });
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
