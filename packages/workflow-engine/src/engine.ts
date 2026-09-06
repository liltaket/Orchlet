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
  ExecutionMode,
  IContextBuilder,
  IAgentExecutor,
  IVerificationRunner,
  IWorkflowEngine,
  ModelUsageRecord,
  Plan,
  ReviewFinding,
  ReviewVerdict,
  RoutingMode,
  Task,
  TaskStatus,
  VerificationResult,
} from "@orchlet/core";
import { modelRouter, ModelRouter } from "@orchlet/routing";
import { contextPacketBuilder, worktreeManager, WorktreeManager } from "@orchlet/context";
import { prBabysitter, PRBabysitter, getGitHubRepoIdentity } from "@orchlet/github";
import {
  independentReviewer,
  IndependentReviewer,
  mockAgentProvider,
  AgentExecutorRegistry,
  agentExecutorRegistry,
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
  executorRegistry?: AgentExecutorRegistry;
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
  private customAgentExecutor?: IAgentExecutor;
  private executorRegistry: AgentExecutorRegistry;
  private verificationRunner: IVerificationRunner;
  private contextBuilder: IContextBuilder;
  private notifier: NotificationManager;
  private userConfig?: OrchletConfigData;
  private taskListeners: Array<(task: Task) => void> = [];
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

    this.executorRegistry = deps.executorRegistry || agentExecutorRegistry;
    this.customAgentExecutor = deps.agentExecutor || deps.agentProvider;
  }

  subscribe(listener: (task: Task) => void): () => void {
    this.taskListeners.push(listener);
    return () => {
      this.taskListeners = this.taskListeners.filter((l) => l !== listener);
    };
  }

  private notifyTaskUpdate(task: Task): void {
    for (const listener of this.taskListeners) {
      try {
        listener(task);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  async createTask(
    intent: string,
    repoPath: string,
    options: { routingMode?: RoutingMode; executionMode?: ExecutionMode } = {},
  ): Promise<Task> {
    const id = generateId();
    const task: Task = {
      id,
      intent,
      status: "PENDING",
      attentionState: "RUNNING",
      routingMode: options.routingMode || "AUTO",
      executionMode: options.executionMode || (process.env.VITEST && !process.env.TEST_LIVE ? "MOCK" : "REAL"),
      repoPath: path.resolve(repoPath),
      baseBranch: "main",
      workBranch: `orchlet/task-${id}`,
      modelUsageAudit: [],
      verificationResults: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.saveTask(task);
    this.notifyTaskUpdate(task);
    this.notifier.notifyAttention(task.id, task.attentionState, `Task created: "${intent}"`);
    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.store.getTask(taskId);
  }

  listTasks(): Task[] {
    return this.store.listTasks();
  }

  async resumeTask(taskId: string): Promise<Task> {
    const task = await this.getTaskOrThrow(taskId);
    this.logger.info(`Resuming task ${taskId} from status: ${task.status}`);

    if (task.status === "SETTLED" || task.status === "COMPLETED") {
      this.logger.info(`Task ${taskId} is already completed.`);
      return task;
    }

    if (task.status === "FAILED") {
      task.status = "PENDING";
      task.attentionState = "RUNNING";
      task.error = undefined;
      task.updatedAt = new Date().toISOString();
      this.store.saveTask(task);
      this.notifyTaskUpdate(task);
      return this.startTask(taskId);
    }

    return this.startTask(taskId);
  }

  async startTask(taskId: string): Promise<Task> {
    const task = await this.getTaskOrThrow(taskId);
    this.logger.info(`Starting execution for task ${taskId}: "${task.intent}"`);

    // Load runtime configuration
    const config = this.userConfig || (await ConfigManager.loadConfig(task.repoPath));
    task.modelUsageAudit = task.modelUsageAudit || [];
    const activeHarness = config.activeHarness || "opencode";
    const executionMode = task.executionMode || (process.env.VITEST && !process.env.TEST_LIVE ? "MOCK" : "REAL");
    const executor = this.customAgentExecutor ??
      this.executorRegistry.resolve(activeHarness, "executor", executionMode);

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

      // 2. DETERMINISTIC LOCAL PLANNING
      await this.transition(task, "PLANNING", "RUNNING");
      task.plan = this.generateDeterministicPlan(task.intent, task.id);
      await this.transition(task, "PLAN_APPROVED", "RUNNING");

      // 3. PROVISION ISOLATED WORKTREE (Strict Sandboxing)
      const wt = await this.worktree.createWorktree(task.repoPath, task.id, task.baseBranch);
      const worktreePath = wt.worktreePath;
      task.worktreePath = worktreePath;
      task.workBranch = wt.branchName;

      // 4. IMPLEMENTATION & MUTATION VIA AGENT EXECUTOR
      await this.transition(task, "IMPLEMENTING", "RUNNING");
      const execDecision = await this.router.resolveModel("executor", task.routingMode, config);
      this.logger.info(`Implementation routed to: ${execDecision.providerId}/${execDecision.modelId}`);

      implementerPacket.planSummary = task.plan.summary;
      const execResult = await executor.execute({
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

      if (!execResult.success) {
        throw new OrchletError(
          `Agent executor reported failure: ${execResult.error || "unknown execution error"}`,
          "EXECUTION_FAILED",
        );
      }

      this.recordAudit(
        task,
        "executor",
        execResult.providerUsed || execDecision.providerId,
        execResult.modelUsed || execDecision.modelId,
        execResult.durationMs,
        execResult.usage?.totalTokens,
        execResult.usage?.costEstimateUsd,
      );

      // 5. AUTOMATED VERIFICATION / TESTING PHASE
      await this.transition(task, "VERIFYING", "RUNNING");
      const verificationCommands = await this.resolveVerificationCommands(config, worktreePath);
      let verificationResults = await this.verificationRunner.runVerification(
        verificationCommands,
        worktreePath,
      );
      task.verificationResults = verificationResults;

      // 6. INDEPENDENT ADVERSARIAL REVIEW & REMEDIATION LOOP
      await this.transition(task, "REVIEWING", "RUNNING");
      const criticDecision = await this.router.resolveModel("critic", task.routingMode, config);
      this.logger.info(`Review engine routed to: ${criticDecision.providerId}/${criticDecision.modelId}`);

      let diff = await this.worktree.getDiff(worktreePath, task.baseBranch);

      if (!diff || diff.trim().length === 0) {
        throw new OrchletError(
          "Workflow produced an empty git diff. No changes were made in the worktree.",
          "EMPTY_DIFF",
        );
      }

      let reviewerPacket = await this.contextBuilder.buildPacket(
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
        { model: criticDecision.modelId, provider: criticDecision.providerId, executionMode },
      );
      task.latestReview = review;
      this.recordAudit(
        task,
        "critic",
        review.providerUsed || criticDecision.providerId,
        review.reviewerModel,
        120,
        review.tokensUsed?.total,
        review.costEstimate,
      );

      const maxRepairAttempts = 3;
      let repairAttempt = 0;

      // Repair loop triggers if review flagged changes/blockers OR if any tests failed
      while (
        (review.verdict === "CHANGES_REQUESTED" ||
          review.verdict === "BLOCKED" ||
          verificationResults.some((v) => !v.passed)) &&
        repairAttempt < maxRepairAttempts
      ) {
        repairAttempt++;
        await this.transition(task, "REPAIRING", "RUNNING");

        const blockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
        const failedTests = verificationResults.filter((v) => !v.passed);

        // Synthesize findings for failed tests if not already explicitly reported
        for (const ft of failedTests) {
          if (!blockers.some((b) => b.title.includes(ft.command))) {
            blockers.push({
              id: `test_failure_${repairAttempt}`,
              severity: "P0",
              title: `Test Command Failed: ${ft.command}`,
              filePath: "tests",
              description: `Verification failed with exit code ${ft.exitCode}:\n${ft.stderrTail || ft.stdoutTail}`,
            });
          }
        }

        this.logger.warn(
          `Review/verification flagged ${blockers.length} issue(s). Initiating repair cycle ${repairAttempt}/${maxRepairAttempts}...`
        );

        const repairDecision = await this.router.resolveModel("repairer", task.routingMode, config);
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

        const repairExecutor = this.customAgentExecutor ??
          this.executorRegistry.resolve(activeHarness, "repairer", executionMode);

        const repairResult = await repairExecutor.execute({
          taskId: task.id,
          role: "repairer",
          userObjective: `Resolve defects: ${blockers.map((b) => b.title).join("; ")}`,
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
          repairResult.providerUsed || repairDecision.providerId,
          repairResult.modelUsed || repairDecision.modelId,
          repairResult.durationMs,
          repairResult.usage?.totalTokens,
          repairResult.usage?.costEstimateUsd,
        );

        // Re-run test suite after repair
        this.logger.info(`Re-running test suite after repair attempt ${repairAttempt}...`);
        verificationResults = await this.verificationRunner.runVerification(
          verificationCommands,
          worktreePath,
        );
        task.verificationResults = verificationResults;

        // Fresh independent review of updated diff (fresh packet without repair bias)
        diff = await this.worktree.getDiff(worktreePath, task.baseBranch);
        reviewerPacket = await this.contextBuilder.buildPacket(
          task.id,
          task.intent,
          task.repoPath,
          "reviewer",
        );
        review = await this.reviewer.reviewDiff(
          diff,
          task.intent,
          verificationResults,
          reviewerPacket,
          { model: criticDecision.modelId, provider: criticDecision.providerId, executionMode },
        );
        task.latestReview = review;
      }

      // Hard gates after repair attempts:
      // 1. Verification commands must all pass
      const unpassedVerification = (task.verificationResults || []).filter((v) => !v.passed);
      if (unpassedVerification.length > 0) {
        throw new OrchletError(
          `Verification gate failed: ${unpassedVerification.map((v) => `${v.command} (exit ${v.exitCode})`).join(", ")}`,
          "VERIFICATION_FAILED",
        );
      }

      // 2. No P0/P1 blockers may remain
      const remainingBlockers = review.findings.filter((f) => f.severity === "P0" || f.severity === "P1");
      if (remainingBlockers.length > 0) {
        throw new ReviewBlockedError(
          `Independent review blocked merge: ${remainingBlockers.length} P0/P1 finding(s) unresolved after ${maxRepairAttempts} repair attempts.`,
          remainingBlockers,
        );
      }

      // 3. Diff must not be empty
      if (!diff || diff.trim().length === 0) {
        throw new OrchletError("Cannot commit: git diff is empty.", "EMPTY_DIFF");
      }

      // 7. REAL GIT STAGING & COMMIT
      await this.transition(task, "COMMITTED", "RUNNING");
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
        const repoIdentity = await getGitHubRepoIdentity(task.repoPath);
        this.logger.info(`Discovered repository origin: ${repoIdentity.owner}/${repoIdentity.repo}`);

        const pr = await this.babysitter.createPullRequest(task.repoPath, {
          title: `feat: ${task.intent}`,
          body: `## Summary\n${task.intent}\n\n## Verification\n- Plan: ${task.plan?.summary}\n- Reviewer: ${review.reviewerModel}\n- Commit: \`${task.commitSha}\``,
          headBranch: task.workBranch,
          baseBranch: task.baseBranch,
        });
        task.prNumber = pr.prNumber;
        task.prUrl = pr.prUrl;

        await this.transition(task, "PR_BABYSITTING", "WAITING_ON_AGENTS");
        const babysitResult = await this.babysitter.babysitPR(
          repoIdentity.owner,
          repoIdentity.repo,
          task.prNumber,
          {
            autoMerge: gitPolicy.autoMerge,
          },
        );

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
      this.notifyTaskUpdate(task);
      this.notifier.notifyAttention(task.id, "NEEDS_ATTENTION", `Task failed: ${task.error}`);
      throw err;
    }
  }

  private generateDeterministicPlan(intent: string, taskId: string): Plan {
    return {
      id: `plan-${taskId}`,
      title: `Execution Plan: ${intent.slice(0, 60)}`,
      summary: `Deterministic execution plan for objective: "${intent}"`,
      steps: [
        {
          id: "step-1",
          description: "Analyze context instructions and prepare changes in isolated worktree",
          status: "COMPLETED",
        },
        {
          id: "step-2",
          description: "Execute implementation and generate tests",
          status: "IN_PROGRESS",
        },
        {
          id: "step-3",
          description: "Run verification commands and independent review",
          status: "PENDING",
        },
      ],
      architectVerdict: "APPROVED",
      architectNotes: "Deterministic plan accepted for automated execution.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
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
    this.logger.info(
      `Audit recorded [${role}]: ${provider}/${model} (${durationMs}ms, tokens=${tokens ?? "N/A"}, cost=$${costUsd ?? 0})`
    );
  }

  private async transition(task: Task, status: TaskStatus, attention: AttentionState): Promise<void> {
    task.status = status;
    task.attentionState = attention;
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    this.notifyTaskUpdate(task);
    this.store.createCheckpoint(task.id, task.status, task.workBranch, {
      taskStatus: task.status,
      attentionState: task.attentionState,
      commitSha: task.commitSha,
      prNumber: task.prNumber,
    });
    this.logger.debug(`Task ${task.id} -> ${status} (${attention})`);
  }

  private async getTaskOrThrow(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new OrchletError(`Task ${taskId} not found in store`, "TASK_NOT_FOUND");
    }
    return task;
  }
}
