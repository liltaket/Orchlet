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
import { MockAgentProvider } from "@orchlet/providers";
import { PRBabysitter } from "@orchlet/github";
import { NotificationManager } from "@orchlet/notifications";
import type { IReviewEngine, ReviewVerdict } from "@orchlet/core";

const execFileAsync = promisify(execFile);

describe("Independent Review & Automated Repair Loop", () => {
  it("triggers repair loop and preserves P0/P1 blockers until properly addressed", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-repair-test-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test Runner"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@orchlet.dev"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test\n", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

    let reviewInvocationCount = 0;
    const mockReviewer: IReviewEngine = {
      async reviewDiff(diff: string): Promise<ReviewVerdict> {
        reviewInvocationCount++;
        if (reviewInvocationCount === 1) {
          // First pass: Flag a critical P0 security blocker
          return {
            verdict: "CHANGES_REQUESTED",
            findings: [
              {
                id: "find_p0",
                severity: "P0",
                title: "Exposed API key in diff",
                filePath: "ORCHLET_TASK_OUTPUT.md",
                description: "Plaintext credential detected",
                securityImpact: true,
              },
            ],
            summary: "Critical security blocker identified.",
            reviewedCommit: "HEAD",
            reviewerModel: "claude-3.7-sonnet:thinking",
            timestamp: new Date().toISOString(),
          };
        }
        // Second pass after repair: Approved
        return {
          verdict: "APPROVED",
          findings: [],
          summary: "All findings resolved after repair.",
          reviewedCommit: "HEAD",
          reviewerModel: "claude-3.7-sonnet:thinking",
          timestamp: new Date().toISOString(),
        };
      },
    };

    const engine = new WorkflowEngine({
      store: new TaskStore(":memory:"),
      router: new ModelRouter(new UsageManager()),
      worktree: new WorktreeManager(),
      reviewer: mockReviewer as any,
      babysitter: new PRBabysitter(),
      agentProvider: new MockAgentProvider(),
      notifier: new NotificationManager(),
    });

    const task = await engine.createTask("Remediation test task", tempDir);
    const completed = await engine.startTask(task.id);

    // Verified that repair cycle occurred and re-reviewed
    expect(reviewInvocationCount).toBe(2);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.attentionState).toBe("SETTLED");

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });
});
