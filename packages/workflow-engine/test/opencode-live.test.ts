import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";

const execFileAsync = promisify(execFile);
const isLive = Boolean(process.env.TEST_LIVE);

describe.runIf(isLive)("OpenCode Live Agent E2E Integration", () => {
  it(
    "invokes real OpenCode agent, modifies code in worktree, passes tests, and produces verified commit",
    async () => {
      const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-live-opencode-"));

      try {
        await execFileAsync("git", ["init", "-b", "main"], { cwd: sandboxDir });
        await execFileAsync("git", ["config", "user.name", "Orchlet Live Runner"], { cwd: sandboxDir });
        await execFileAsync("git", ["config", "user.email", "live@orchlet.dev"], { cwd: sandboxDir });

        await fs.writeFile(
          path.join(sandboxDir, "package.json"),
          JSON.stringify(
            {
              name: "clamp-pkg",
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

        await fs.writeFile(
          path.join(sandboxDir, "AGENTS.md"),
          "# Instructions\n\nImplement clean utilities with unit tests using Node.js native test runner.\n",
          "utf-8",
        );

        await execFileAsync("git", ["add", "."], { cwd: sandboxDir });
        await execFileAsync("git", ["commit", "-m", "chore: init clamp repo"], { cwd: sandboxDir });

        const engine = new WorkflowEngine({
          config: {
            activeHarness: "opencode",
            git: { push: false, openPr: false, autoMerge: false },
            verification: ["node --test test/clamp.test.js"],
          },
        });

        const intent =
          "Implement clamp(value, min, max) in src/clamp.js and tests in test/clamp.test.js (below min, within range, above max).";

        const task = await engine.createTask(intent, sandboxDir);
        const result = await engine.startTask(task.id);

        expect(result.status).toBe("COMPLETED");
        expect(result.attentionState).toBe("SETTLED");
        expect(result.commitSha).toBeDefined();
        expect(result.commitSha?.length).toBe(40);
        expect(result.verificationResults).toBeDefined();
        expect(result.verificationResults?.[0].passed).toBe(true);
        expect(result.latestReview?.verdict).toBe("APPROVED");
      } finally {
        await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    180000,
  );
});
