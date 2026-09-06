import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";
import { TaskStore } from "../src/db.js";
import { openCodeHarness } from "@orchlet/providers";

const execFileAsync = promisify(execFile);

const isLive = process.env.TEST_LIVE === "true";

describe.skipIf(!isLive)("Real Sandbox GitHub PR End-to-End Flow", () => {
  it(
    "executes full real workflow on liltaket/orchlet-sandbox: worktree -> opencode agent -> test verification -> AI review -> commit -> push -> PR create -> babysit -> READY_TO_MERGE",
    async () => {
      const sandboxRepo = process.env.SANDBOX_REPO || path.join(os.homedir(), "orchlet-sandbox");

      // Verify repo exists and has remote origin
      const { stdout: remoteUrl } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: sandboxRepo,
      });
      expect(remoteUrl.trim()).toContain("orchlet-sandbox");

      // Ensure local main is clean and up to date
      await execFileAsync("git", ["checkout", "main"], { cwd: sandboxRepo });
      await execFileAsync("git", ["pull", "origin", "main"], { cwd: sandboxRepo }).catch(() => {});

      const store = new TaskStore(":memory:");
      const engine = new WorkflowEngine({
        store,
        agentExecutor: openCodeHarness,
      });

      const intent = "Add slugify string utility in src/slugify.js with tests in test/slugify.test.js";

      const task = await engine.createTask(intent, sandboxRepo, {
        routingMode: "AUTO",
        executionMode: "REAL",
      });

      expect(task.id).toBeDefined();
      expect(task.executionMode).toBe("REAL");

      const startTime = Date.now();
      const completedTask = await engine.startTask(task.id);
      const durationMs = Date.now() - startTime;

      // Assertions on the completed task state
      expect(["READY_TO_MERGE", "COMPLETED"]).toContain(completedTask.status);
      expect(completedTask.attentionState).toBe("SETTLED");
      expect(completedTask.commitSha).toBeDefined();
      expect(completedTask.commitSha?.length).toBeGreaterThan(10);
      expect(completedTask.prNumber).toBeDefined();
      expect(completedTask.prNumber).toBeGreaterThan(0);
      expect(completedTask.prUrl).toContain("https://github.com/liltaket/orchlet-sandbox/pull/");

      // Verification checks must have passed
      expect(completedTask.verificationResults?.length).toBeGreaterThan(0);
      expect(completedTask.verificationResults?.every((v) => v.passed)).toBe(true);

      // Independent AI review must have passed
      expect(completedTask.latestReview).toBeDefined();
      expect(completedTask.latestReview?.verdict).toBe("APPROVED");
      expect(completedTask.latestReview?.findings.filter((f) => f.severity === "P0" || f.severity === "P1")).toHaveLength(0);

      // Fetch the actual GitHub PR details via gh CLI to confirm GitHub truth
      const { stdout: prDetailsJson } = await execFileAsync("gh", [
        "pr",
        "view",
        completedTask.prNumber!.toString(),
        "--repo",
        "liltaket/orchlet-sandbox",
        "--json",
        "number,title,url,state,headRefName,baseRefName,statusCheckRollup,mergeable",
      ]);
      const prDetails = JSON.parse(prDetailsJson);

      expect(prDetails.number).toBe(completedTask.prNumber);
      expect(prDetails.state).toBe("OPEN");
      expect(prDetails.headRefName).toBe(completedTask.workBranch);
      expect(prDetails.baseRefName).toBe("main");

      // Save structured validation artifact
      const validationRecord = {
        timestamp: new Date().toISOString(),
        durationMs,
        task: completedTask,
        githubPr: prDetails,
      };

      const outDir = path.resolve(process.cwd(), "docs/validation");
      await fs.mkdir(outDir, { recursive: true });

      await fs.writeFile(
        path.join(outDir, "2026-09-06-github-pr-smoke.json"),
        JSON.stringify(validationRecord, null, 2),
        "utf-8"
      );

      const markdownSummary = `# Real Sandbox GitHub PR Smoke Test Validation Record

- **Timestamp**: ${validationRecord.timestamp}
- **Duration**: ${(durationMs / 1000).toFixed(1)}s
- **Repository**: [liltaket/orchlet-sandbox](https://github.com/liltaket/orchlet-sandbox)
- **Task ID**: \`${completedTask.id}\`
- **Execution Mode**: \`${completedTask.executionMode}\`
- **Final Status**: \`${completedTask.status}\` (Attention: \`${completedTask.attentionState}\`)
- **PR URL**: [${prDetails.url}](${prDetails.url}) (PR #${completedTask.prNumber})
- **Work Branch**: \`${completedTask.workBranch}\` -> \`main\`
- **Commit SHA**: \`${completedTask.commitSha}\`

## Automated Verification Runner
${completedTask.verificationResults?.map((v) => `- Command: \`${v.command}\` (exit code: ${v.exitCode}, duration: ${v.durationMs}ms) - **${v.passed ? "PASSED" : "FAILED"}**`).join("\n")}

## Independent AI Reviewer
- **Reviewer Model**: \`${completedTask.latestReview?.reviewerModel}\`
- **Provider**: \`${completedTask.latestReview?.providerUsed}\`
- **Verdict**: \`${completedTask.latestReview?.verdict}\`
- **Blockers (P0/P1)**: 0
- **Summary**: ${completedTask.latestReview?.summary}

## GitHub PR State
- **State**: \`${prDetails.state}\`
- **Mergeable**: \`${prDetails.mergeable}\`
- **Checks Rollup**: \`${JSON.stringify(prDetails.statusCheckRollup || [])}\`
`;

      await fs.writeFile(path.join(outDir, "2026-09-06-github-pr-smoke.md"), markdownSummary, "utf-8");
      console.log(`Saved GitHub PR smoke validation to docs/validation/2026-09-06-github-pr-smoke.md`);
    },
    240000 // 4 minutes timeout for live agent + tests + review + push + PR + CI
  );
});
