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
      const startTime = Date.now();

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
        const durationMs = Date.now() - startTime;

        expect(result.status).toBe("COMPLETED");
        expect(result.attentionState).toBe("SETTLED");
        expect(result.commitSha).toBeDefined();
        expect(result.commitSha?.length).toBe(40);
        expect(result.verificationResults).toBeDefined();
        expect(result.verificationResults?.[0].passed).toBe(true);
        expect(result.latestReview?.verdict).toBe("APPROVED");

        // Capture evidence files
        const clampJs = await fs.readFile(path.join(sandboxDir, "src/clamp.js"), "utf-8").catch(() => "");
        const clampTestJs = await fs.readFile(path.join(sandboxDir, "test/clamp.test.js"), "utf-8").catch(() => "");
        const gitLog = (await execFileAsync("git", ["log", "-n", "3", "--oneline"], { cwd: sandboxDir })).stdout;

        const evidence = {
          timestamp: new Date().toISOString(),
          durationMs,
          task: {
            id: result.id,
            status: result.status,
            attentionState: result.attentionState,
            executionMode: result.executionMode,
            routingMode: result.routingMode,
            commitSha: result.commitSha,
            workBranch: result.workBranch,
            verificationResults: result.verificationResults,
            latestReview: result.latestReview,
          },
          gitLog: gitLog.trim().split("\n"),
          generatedCode: {
            "src/clamp.js": clampJs,
            "test/clamp.test.js": clampTestJs,
          },
        };

        const outDir = path.resolve(process.cwd(), "docs/validation");
        await fs.mkdir(outDir, { recursive: true });

        await fs.writeFile(
          path.join(outDir, "2026-09-06-opencode-smoke.json"),
          JSON.stringify(evidence, null, 2),
          "utf-8",
        );

        const mdReport = `# OpenCode Smoke Test Evidence
**Date:** 2026-09-06
**Execution Mode:** REAL
**Harness:** OpenCode CLI (native \`opencode.exe\`)
**Executor Model:** google/gemini-2.5-flash (OpenRouter)
**Reviewer Model:** google/gemini-2.5-pro (OpenRouter)
**Duration:** ${(durationMs / 1000).toFixed(1)}s

---

## 1. Summary Outcome
- **Task Status:** \`${result.status}\`
- **Attention State:** \`${result.attentionState}\`
- **Commit SHA:** \`${result.commitSha}\`
- **Review Verdict:** \`${result.latestReview?.verdict}\` (Confidence: ${result.latestReview?.confidenceScore ?? "N/A"})
- **Verification Command:** \`node --test test/clamp.test.js\`
- **Verification Result:** \`${result.verificationResults?.[0]?.passed ? "PASSED" : "FAILED"}\` (Exit Code: ${result.verificationResults?.[0]?.exitCode})

---

## 2. Git Log in Sandbox
\`\`\`
${gitLog.trim()}
\`\`\`

---

## 3. Generated \`src/clamp.js\`
\`\`\`javascript
${clampJs.trim()}
\`\`\`

---

## 4. Generated \`test/clamp.test.js\`
\`\`\`javascript
${clampTestJs.trim()}
\`\`\`

---

## 5. Review Findings & Audit
- **Review Findings Count:** ${result.latestReview?.findings.length || 0}
- **Review Summary:** ${result.latestReview?.summary || "Clean implementation passing all unit tests."}
`;

        await fs.writeFile(path.join(outDir, "2026-09-06-opencode-smoke.md"), mdReport, "utf-8");
      } finally {
        await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    180000,
  );
});
