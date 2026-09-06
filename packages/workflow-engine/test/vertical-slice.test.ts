import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";
import { TaskStore } from "../src/db.js";
import { ModelRouter } from "@orchlet/routing";
import { UsageManager } from "@orchlet/usage";
import { WorktreeManager } from "@orchlet/context";
import { IndependentReviewer, MockAgentProvider } from "@orchlet/providers";
import { PRBabysitter } from "@orchlet/github";
import { NotificationManager, type AttentionNotification } from "@orchlet/notifications";

const execFileAsync = promisify(execFile);

describe("WorkflowEngine Vertical Slice V1", () => {
  it("executes complete lifecycle: intent -> plan -> worktree -> mutation -> review -> commit -> settle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-repo-test-"));
    // Initialize temporary git repo with initial commit
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test Runner"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@orchlet.dev"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test Repo\n", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: tempDir });

    const store = new TaskStore(":memory:");
    const usage = new UsageManager();
    const router = new ModelRouter(usage);
    const worktree = new WorktreeManager();
    const reviewer = new IndependentReviewer();
    const babysitter = new PRBabysitter();
    const agentProvider = new MockAgentProvider();
    const notifier = new NotificationManager();

    const attentionEvents: AttentionNotification[] = [];
    notifier.subscribe((e) => attentionEvents.push(e));

    const engine = new WorkflowEngine({
      store,
      router,
      worktree,
      reviewer,
      babysitter,
      agentProvider,
      notifier,
      config: {
        git: { push: false, openPr: false, autoMerge: false },
      },
    });

    // 1. Submit intent
    const task = await engine.createTask(
      "Refactor authentication token verification and add unit tests",
      tempDir,
      { routingMode: "AUTO" },
    );

    expect(task.id).toBeDefined();
    expect(task.status).toBe("PENDING");
    expect(task.attentionState).toBe("RUNNING");

    // 2. Start autonomous execution
    const completedTask = await engine.startTask(task.id);

    // 3. Verify terminal states
    expect(completedTask.status).toBe("COMPLETED");
    expect(completedTask.attentionState).toBe("SETTLED");

    // 4. Verify plan generation and architectural verification
    expect(completedTask.plan).toBeDefined();
    expect(completedTask.plan?.architectVerdict).toBe("APPROVED");
    expect(completedTask.plan?.steps.length).toBeGreaterThan(0);

    // 5. Verify independent review
    expect(completedTask.latestReview).toBeDefined();
    expect(completedTask.latestReview?.verdict).toBe("APPROVED");
    expect(completedTask.latestReview?.reviewerModel).toBeDefined();

    // 6. Verify real Git commit was generated (no fake PR #42 in local-only mode)
    expect(completedTask.commitSha).toBeDefined();
    expect(completedTask.commitSha?.length).toBe(40);
    expect(completedTask.prNumber).toBeUndefined();

    // 7. Verify model usage audit trail: only real models executed are audited (no fake planner entries)
    expect(completedTask.modelUsageAudit).toBeDefined();
    expect(completedTask.modelUsageAudit?.length).toBeGreaterThanOrEqual(2);
    const rolesAudited = completedTask.modelUsageAudit?.map((a) => a.role);
    expect(rolesAudited).toContain("executor");
    expect(rolesAudited).toContain("critic");

    // 8. Verify SQLite checkpointing
    const latestCheckpoint = store.getLatestCheckpoint(task.id);
    expect(latestCheckpoint).toBeDefined();
    expect(latestCheckpoint?.status).toBe("COMPLETED");

    // 9. Verify attention notification events emitted
    const settledEvent = attentionEvents.find((e) => e.state === "SETTLED");
    expect(settledEvent).toBeDefined();
    expect(settledEvent?.state).toBe("SETTLED");
    expect(settledEvent?.message).toContain("Task completed successfully");

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }, 30000);

  it("handles PR creation and gate checks when openPr is enabled", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-pr-test-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test Runner"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@orchlet.dev"], { cwd: tempDir });
    await execFileAsync("git", ["remote", "add", "origin", "https://github.com/orchlet-test/repo.git"], {
      cwd: tempDir,
    });
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test Repo\n", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: tempDir });

    const store = new TaskStore(":memory:");
    const worktree = new WorktreeManager();
    const babysitter = new PRBabysitter();
    vi.spyOn(babysitter, "createPullRequest").mockResolvedValue({
      prNumber: 105,
      prUrl: "https://github.com/orchlet-test/repo/pull/105",
    });
    vi.spyOn(babysitter, "babysitPR").mockResolvedValue({
      merged: true,
      readyToMerge: true,
      reason: "All gates passed.",
    });

    const engine = new WorkflowEngine({
      store,
      worktree,
      babysitter,
      config: {
        git: { push: false, openPr: true, autoMerge: true },
      },
    });

    const task = await engine.createTask("Add health check endpoint", tempDir);
    const completedTask = await engine.startTask(task.id);

    expect(completedTask.status).toBe("COMPLETED");
    expect(completedTask.prNumber).toBe(105);
    expect(completedTask.prUrl).toBe("https://github.com/orchlet-test/repo/pull/105");

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }, 30000);
});
