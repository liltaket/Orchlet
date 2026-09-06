import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "@orchlet/workflow-engine";
import { Logger } from "@orchlet/shared";

const execFileAsync = promisify(execFile);
const logger = new Logger({ prefix: "OpenCodeSmoke" });

async function runSmokeTest(): Promise<void> {
  logger.info("=== Starting Orchlet Live OpenCode Smoke Test ===");

  // 1. Verify opencode binary is present
  try {
    const isWin = process.platform === "win32";
    const binName = isWin ? "opencode.cmd" : "opencode";
    const { stdout } = await execFileAsync(binName, ["--version"], { shell: isWin });
    logger.info(`Detected OpenCode CLI version: ${stdout.trim()}`);
  } catch (err: any) {
    logger.error(`OpenCode CLI not found or failed to execute: ${err.message}`);
    logger.error("Install opencode via: npm install -g opencode-ai");
    process.exit(1);
  }

  // 2. Provision temporary sandbox repository
  const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-smoke-opencode-"));
  logger.info(`Provisioned temporary sandbox repository at: ${sandboxDir}`);

  try {
    await execFileAsync("git", ["init", "-b", "main"], { cwd: sandboxDir });
    await execFileAsync("git", ["config", "user.name", "Orchlet Smoke Runner"], { cwd: sandboxDir });
    await execFileAsync("git", ["config", "user.email", "smoke@orchlet.dev"], { cwd: sandboxDir });

    // Seed package.json
    await fs.writeFile(
      path.join(sandboxDir, "package.json"),
      JSON.stringify(
        {
          name: "clamp-utility",
          version: "1.0.0",
          type: "module",
          scripts: {
            test: "node --test test/clamp.test.js",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    // Seed AGENTS.md instructions
    await fs.writeFile(
      path.join(sandboxDir, "AGENTS.md"),
      `# Repository Instructions

- Functions must be exported using ES Modules ('export function ...').
- Tests must use Node.js native test runner ('import { test } from "node:test"; import assert from "node:assert";').
- Every utility function must have comprehensive unit tests covering edge cases.
`,
      "utf-8",
    );

    // Initial commit
    await execFileAsync("git", ["add", "."], { cwd: sandboxDir });
    await execFileAsync("git", ["commit", "-m", "chore: initialize clamp sandbox repo"], { cwd: sandboxDir });

    logger.info("Sandbox repository initialized. Dispatching workflow task to OpenCode...");

    // 3. Initialize engine with OpenCode harness
    const engine = new WorkflowEngine({
      config: {
        activeHarness: "opencode",
        git: { push: false, openPr: false, autoMerge: false },
        verification: ["node --test test/clamp.test.js"],
      },
    });

    const intent =
      "Add clamp(value, min, max) function in src/clamp.js and unit tests in test/clamp.test.js (testing: below min, within range, above max). Ensure node --test test/clamp.test.js passes.";

    const task = await engine.createTask(intent, sandboxDir, { routingMode: "AUTO" });
    logger.info(`Created task: ${task.id}`);

    const completed = await engine.startTask(task.id);

    logger.info("=== Workflow Execution Completed ===");
    logger.info(`Task Status: ${completed.status}`);
    logger.info(`Attention State: ${completed.attentionState}`);
    logger.info(`Commit SHA: ${completed.commitSha}`);
    logger.info(`Review Verdict: ${completed.latestReview?.verdict}`);
    logger.info(`Reviewer Model: ${completed.latestReview?.reviewerModel}`);

    // Assertions
    if (completed.status !== "COMPLETED") {
      throw new Error(`Expected task status to be COMPLETED, got ${completed.status}`);
    }
    if (!completed.commitSha || completed.commitSha.length !== 40) {
      throw new Error(`Expected valid 40-char commit SHA, got ${completed.commitSha}`);
    }
    if (!completed.verificationResults || completed.verificationResults.length === 0) {
      throw new Error("Expected verification results to be recorded");
    }
    if (!completed.verificationResults.every((v) => v.passed)) {
      throw new Error("Verification test suite failed during workflow!");
    }

    logger.info("SUCCESS: Real OpenCode agent modified code, tests passed, diff was verified, and commit was created!");
  } finally {
    // Clean up sandbox
    await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    logger.info("Cleaned up temporary sandbox.");
  }
}

runSmokeTest().catch((err) => {
  logger.error("Smoke test failed:", err);
  process.exit(1);
});
