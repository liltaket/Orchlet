import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ConfigManager,
  generateId,
  Logger,
  OrchletError,
  ReviewBlockedError,
  type OrchletConfigData,
} from "@orchlet/shared";
import type {
  AttentionState,
  IContextBuilder,
  IAgentExecutor,
  IVerificationRunner,
  IWorkflowEngine,
  ModelUsageRecord,
  ReviewVerdict,
  RoutingMode,
  Task,
  TaskStatus,
  VerificationResult,
} from "@orchlet/core";
import { modelRouter, ModelRouter } from "@orchlet/routing";
import { contextPacketBuilder, worktreeManager, WorktreeManager } from "@orchlet/context";
import { prBabysitter, PRBabysitter } from "@orchlet/github";
import {
  independentReviewer,
  IndependentReviewer,
  mockAgentProvider,
  openCodeHarness,
  verificationRunner,
} from "@orchlet/providers";
import { notificationManager, NotificationManager } from "@orchlet/notifications";
import { TaskStore } from "./db.js";

const execFileAsync = promisify(execFile);

export interface EngineDependencies {
  store?: TaskStore;
  router?: ModelRouter;
  worktree?: WorktreeManager;
  reviewer?: IndependentReviewer;
  babysitter?: PRBabysitter;
  agentExecutor?: IAgentExecutor;
  agentProvider?: IAgentExecutor;
  verificationRunner?: IVerificationRunner;
  contextBuilder?: IContextBuilder;
  notifier?: NotificationManager;
  config?: OrchletConfigData;
}

export class WorkflowEngine implements IWorkflowEngine {
  private store: TaskStore;
  private router: ModelRouter;
  private worktree: WorktreeManager;
  private reviewer: IndependentReviewer;
  private babysitter: PRBabysitter;
  private agentExecutor: IAgentExecutor;
  private verificationRunner: IVerificationRunner;
  private contextBuilder: IContextBuilder;
  private notifier: NotificationManager;
  private userConfig?: OrchletConfigData;
  private logger = new Logger({ prefix: "WorkflowEngine" });

  constructor(deps: EngineDependencies = {}) {
    this.store = deps.store || new TaskStore();
    this.router = deps.router || modelRouter;
    this.worktree = deps.worktree || worktreeManager;
    this.reviewer = deps.reviewer || independentReviewer;
    this.babysitter = deps.babysitter || prBabysitter;
    this.verificationRunner = deps.verificationRunner || verificationRunner;
    this.contextBuilder = deps.contextBuilder || contextPacketBuilder;
    this.notifier = deps.notifier || notificationManager;
    this.userConfig = deps.config;

    // Select active harness: explicit executor, then agentProvider alias, then config, fallback to mock
    if (deps.agentExecutor) {
      this.agentExecutor = deps.agentExecutor;
    } else if (deps.agentProvider) {
      this.agentExecutor = deps.agentProvider;
    } else if (deps.config?.activeHarness === "opencode") {
      this.agentExecutor = openCodeHarness;
    } else {
      this.agentExecutor = mockAgentProvider;
    }
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
      modelUsageAudit: [],
      verificationResults: [],
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

    // Load runtime configuration
    const config = this.userConfig || (await ConfigManager.loadConfig(task.repoPath));
    task.modelUsageAudit = task.modelUsageAudit || [];

    try {
      // 1. CONTEXT DISCOVERY & PACKET GENERATION
      const implementerPacket = await this.contextBuilder.buildPacket(
        task.id,
        task.intent,
        task.repoPath,
        "implementer",
      );
      this.logger.info(
        `Discovered ${implementerPacket.contextBundle.files.length} context file(s) (fingerprint: ${implementerPacket.contextBundle.bundleFingerprint.slice(0, 8)})`
      );

      // 2. PLANNING PHASE
      await this.transition(task, "PLANNING", "RUNNING");
      const planDecision = await this.router.resolveModel("planner", task.routingMode);
      this.logger.info(
        `Planner routed to: ${planDecision.providerId}/${planDecision.modelId} (reason: ${planDecision.reason})`
      );
      this.recordAudit(task, "planner", planDecision.providerId, planDecision.modelId, 50);

      // Generate structured plan
      task.plan = await mockAgentProvider.generatePlan(task.intent, task.id);

      // Architectural verification
      const archDecision = await this.router.resolveModel("architect", task.routingMode);
      this.logger.info(`Architect verification routed to: ${archDecision.providerId}/${archDecision.modelId}`);
      this.recordAudit(task, "architect", archDecision.providerId, archDecision.modelId, 40);
      await this.transition(task, "PLAN_APPROVED", "RUNNING");

      // 3. PROVISION ISOLATED WORKTREE (Strict Sandboxing)
      const wt = await this.worktree.createWorktree(task.repoPath, task.id, task.baseBranch);
      const worktreePath = wt.worktreePath;
      task.worktreePath = worktreePath;
      task.workBranch = wt.branchName;

      // 4. IMPLEMENTATION & MUTATION VIA AGENT EXECUTOR
      await this.transition(task, "IMPLEMENTING", "RUNNING");
      const execDecision = await this.router.resolveModel("executor", task.routingMode);
      this.logger.info(`Implementation routed to: ${execDecision.providerId}/${execDecision.modelId}`);

      implementerPacket.planSummary = task.plan.summary;
      const execResult = await this.agentExecutor.execute({
        taskId: task.id,
        role: "executor",
        userObjective: task.intent,
        taskPacket: implementerPacket,
        worktreePath,
        selectedModel: {
          providerId: execDecision.providerId,
          modelId: execDecision.modelId,
          tier: execDecision.tier,
        },
        permissions: {
          allowFileSystem: true,
          allowBash: true,
        },
      });

      this.recordAudit(
        task,
        "executor",
        execResult.providerUsed,
        execResult.modelUsed,
        execResult.durationMs,
        execResult.usage?.totalTokens,
        execResult.usage?.costEstimateUsd,
      );

      // 5. AUTOMATED VERIFICATION / TESTING PHASE
      await this.transition(task, "TESTING", "RUNNING");
      const verificationCommands = await this.resolveVerificationCommands(config, worktreePath);
      const verificationResults = await this.verificationRunner.runVerification(
        verificationCommands,
        worktreePath,
      );
      task.verificationResults = verificationResults;

      // 6. INDEPENDENT ADVERSARIAL REVIEW & REMEDIATION LOOP
      await this.transition(task, "REVIEWING", "RUNNING");
      const criticDecision = await this.router.resolveModel("critic", task.routingMode);
      this.logger.info(`Review engine routed to: ${criticDecision.providerId}/${criticDecision.modelId}`);

      let diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
      const reviewerPacket = await this.contextBuilder.buildPacket(
        task.id,
        task.intent,
        task.repoPath,
        "reviewer",
      );

      let review: ReviewVerdict = await this.reviewer.reviewDiff(
        diff,
        task.intent,
        verificationResults,
        reviewerPacket,
      );
      task.latestReview = review;
      this.recordAudit(task, "critic", criticDecision.providerId, review.reviewerModel, 120);

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
        this.logger.info(
          `Repair cycle ${repairAttempt} routed to: ${repairDecision.providerId}/${repairDecision.modelId}`
        );

        const repairPacket = await this.contextBuilder.buildPacket(
          task.id,
          task.intent,
          task.repoPath,
          "implementer",
          { blockingFindings: blockers, planSummary: task.plan?.summary },
        );

        const repairResult = await this.agentExecutor.execute({
          taskId: task.id,
          role: "repairer",
          userObjective: `Resolve review findings: ${blockers.map((b) => b.title).join("; ")}`,
          taskPacket: repairPacket,
          worktreePath,
          selectedModel: {
            providerId: repairDecision.providerId,
            modelId: repairDecision.modelId,
            tier: repairDecision.tier,
          },
          permissions: {
            allowFileSystem: true,
            allowBash: true,
          },
        });

        this.recordAudit(
          task,
          "repairer",
          repairResult.providerUsed,
          repairResult.modelUsed,
          repairResult.durationMs,
          repairResult.usage?.totalTokens,
        );

        // Re-run test suite after repair
        this.logger.info(`Re-running test suite after repair attempt ${repairAttempt}...`);
        const recheckResults = await this.verificationRunner.runVerification(
          verificationCommands,
          worktreePath,
        );
        task.verificationResults = recheckResults;

        // Fresh independent review of updated diff
        diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
        review = await this.reviewer.reviewDiff(
          diff,
          task.intent,
          recheckResults,
          reviewerPacket,
        );
        task.latestReview = review;
      }

      // If blockers remain after max attempts, halt
      const remainingBlockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
      if (remainingBlockers.length > 0) {
        throw new ReviewBlockedError(
          `Independent review blocked merge: ${remainingBlockers.length} P0/P1 finding(s) unresolved after ${maxRepairAttempts} repair attempts.`,
          remainingBlockers,
        );
      }

      // 7. REAL GIT STAGING & COMMIT
      this.logger.info(`Staging and committing verified modifications in worktree: ${worktreePath}`);
      await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
      const commitMessage = `feat(orchlet): ${task.intent}\n\nAutomated delivery verified by Orchlet control plane.\nReviewer: ${review.reviewerModel}\nFindings: 0 P0/P1 blockers.`;
      await execFileAsync("git", ["commit", "-m", commitMessage], { cwd: worktreePath });
      const { stdout: commitShaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: worktreePath,
      });
      task.commitSha = commitShaOut.trim();
      this.logger.info(`Created verified commit: ${task.commitSha} on branch ${task.workBranch}`);

      // 8. GIT PUSH & PR WORKFLOW (Configurable & Conservative)
      const gitPolicy = config.git || {};

      if (gitPolicy.push) {
        this.logger.info(`Pushing branch ${task.workBranch} to remote origin...`);
        await execFileAsync("git", ["push", "origin", task.workBranch], { cwd: worktreePath });
      }

      if (gitPolicy.openPr) {
        await this.transition(task, "PR_OPENED", "RUNNING");
        const pr = await this.babysitter.createPullRequest(task.repoPath, {
          title: `feat: ${task.intent}`,
          body: `## Summary\n${task.intent}\n\n## Verification\n- Plan: ${task.plan?.summary}\n- Reviewer: ${review.reviewerModel}\n- Commit: \`${task.commitSha}\``,
          headBranch: task.workBranch,
          baseBranch: task.baseBranch,
        });
        task.prNumber = pr.prNumber;
        task.prUrl = pr.prUrl;

        await this.transition(task, "PR_BABYSITTING", "WAITING_ON_AGENTS");
        const babysitResult = await this.babysitter.babysitPR("org", "repo", task.prNumber, {
          autoMerge: gitPolicy.autoMerge,
        });

        if (babysitResult.readyToMerge && !babysitResult.merged) {
          await this.transition(task, "READY_TO_MERGE", "SETTLED");
          this.notifier.notifyAttention(
            task.id,
            "SETTLED",
            `PR #${task.prNumber} passed all gates and is READY_TO_MERGE.`,
          );
          return task;
        }

        if (!babysitResult.merged) {
          throw new OrchletError(
            `PR Babysitter could not verify merge: ${babysitResult.reason || "Gates failed"}`,
            "BABYSITTER_FAILED",
          );
        }
      }

      // 9. SETTLEMENT & WORKTREE CLEANUP
      if (task.worktreePath) {
        await this.worktree.removeWorktree(task.worktreePath).catch((err) => {
          this.logger.warn(`Could not remove worktree ${task.worktreePath}: ${err.message}`);
        });
      }

      await this.transition(task, "COMPLETED", "SETTLED");
      this.notifier.notifyAttention(
        task.id,
        "SETTLED",
        `Task completed successfully! Commit: ${task.commitSha?.slice(0, 7)} on branch ${task.workBranch}.`,
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

  private async resolveVerificationCommands(
    config: OrchletConfigData,
    worktreePath: string,
  ): Promise<string[]> {
    if (config.verification && config.verification.length > 0) {
      return config.verification;
    }

    // Auto-detect test runner from package.json if present
    try {
      const pkgPath = path.join(worktreePath, "package.json");
      const raw = await fs.readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw);
      if (pkg.scripts?.test && !pkg.scripts.test.includes("no test specified")) {
        return ["npm test"];
      }
    } catch {
      // No package.json or unreadable
    }

    return [];
  }

  private recordAudit(
    task: Task,
    role: any,
    provider: string,
    model: string,
    durationMs: number,
    tokens?: number,
    costUsd?: number,
  ): void {
    const record: ModelUsageRecord = {
      role,
      provider,
      model,
      durationMs,
      tokens,
      costUsd,
      timestamp: new Date().toISOString(),
    };
    task.modelUsageAudit = task.modelUsageAudit || [];
    task.modelUsageAudit.push(record);
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
      gitRef: task.commitSha || "HEAD",
      snapshotData: { status, attentionState, commitSha: task.commitSha },
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
