import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";
import { TaskStore } from "../src/db.js";
import { WorktreeManager } from "@orchlet/context";
import { ModelRouter } from "@orchlet/routing";
import { UsageManager } from "@orchlet/usage";
import { IndependentReviewer, MockAgentProvider, VerificationRunner } from "@orchlet/providers";
import { PRBabysitter } from "@orchlet/github";
import { NotificationManager } from "@orchlet/notifications";

const execFileAsync = promisify(execFile);

describe("Live Sandbox Repository Validation", () => {
  it("runs full autonomous workflow on dedicated git sandbox repository", async () => {
    const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-live-sandbox-"));

    // 1. Initialize git sandbox repository
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sandboxDir });
    await execFileAsync("git", ["config", "user.name", "Orchlet Sandbox"], { cwd: sandboxDir });
    await execFileAsync("git", ["config", "user.email", "sandbox@orchlet.dev"], { cwd: sandboxDir });

    // 2. Add AGENTS.md instructions
    await fs.writeFile(
      path.join(sandboxDir, "AGENTS.md"),
      "# Repository Guidelines\n\nAll utilities must be tested and documented.\n",
      "utf-8",
    );

    // 3. Add package.json with test script
    await fs.writeFile(
      path.join(sandboxDir, "package.json"),
      JSON.stringify(
        {
          name: "sandbox-pkg",
          type: "module",
          scripts: {
            test: "node -e \"console.log('Sandbox test suite passed')\"",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // 4. Initial commit
    await execFileAsync("git", ["add", "."], { cwd: sandboxDir });
    await execFileAsync("git", ["commit", "-m", "chore: initialize sandbox repository"], { cwd: sandboxDir });

    const store = new TaskStore(":memory:");
    const usage = new UsageManager();
    const router = new ModelRouter(usage);
    const worktree = new WorktreeManager();
    const reviewer = new IndependentReviewer();
    const babysitter = new PRBabysitter();
    const agentExecutor = new MockAgentProvider();
    const verificationRunner = new VerificationRunner();
    const notifier = new NotificationManager();

    const engine = new WorkflowEngine({
      store,
      router,
      worktree,
      reviewer,
      babysitter,
      agentExecutor,
      verificationRunner,
      notifier,
      config: {
        git: { push: false, openPr: false, autoMerge: false },
      },
    });

    // 5. Dispatch task
    const task = await engine.createTask(
      "Implement helper utilities with tests and verified review",
      sandboxDir,
    );

    expect(task.id).toBeDefined();
    expect(task.status).toBe("PENDING");

    // 6. Execute autonomous lifecycle
    const result = await engine.startTask(task.id);

    // 7. Verify end-to-end outcome
    expect(result.status).toBe("COMPLETED");
    expect(result.attentionState).toBe("SETTLED");

    // Verify verified commit
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha?.length).toBe(40);

    // Verify verification tests ran
    expect(result.verificationResults).toBeDefined();
    expect(result.verificationResults?.length).toBeGreaterThan(0);
    expect(result.verificationResults?.[0].passed).toBe(true);

    // Verify independent review verdict
    expect(result.latestReview).toBeDefined();
    expect(result.latestReview?.verdict).toBe("APPROVED");
    expect(result.latestReview?.findings.length).toBe(0);

    // Verify truthful model usage audit trail
    expect(result.modelUsageAudit).toBeDefined();
    expect(result.modelUsageAudit?.length).toBeGreaterThanOrEqual(2);

    // Verify SQLite durability
    const persisted = store.getTask(task.id);
    expect(persisted).toBeDefined();
    expect(persisted?.commitSha).toBe(result.commitSha);
    expect(persisted?.verificationResults?.length).toBe(result.verificationResults?.length);

    // 8. Clean up
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }, 30000);
});
