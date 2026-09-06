import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";
import { IndependentReviewer, type IAgentExecutor } from "@orchlet/providers";
import type { AgentRequest, AgentResult } from "@orchlet/core";

const execFileAsync = promisify(execFile);
const isLive = Boolean(process.env.TEST_LIVE);

describe.runIf(isLive)("Real AI Reviewer Negative Defect & Repair Loop Validation", () => {
  it(
    "proves real AI reviewer catches intentional defect, emits P1, repairs defect, and fresh review approves with non-zero tokens",
    async () => {
      const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-negative-review-"));
      const startTime = Date.now();

      try {
        await execFileAsync("git", ["init", "-b", "main"], { cwd: sandboxDir });
        await execFileAsync("git", ["config", "user.name", "Orchlet Live Reviewer"], { cwd: sandboxDir });
        await execFileAsync("git", ["config", "user.email", "reviewer@orchlet.ai"], { cwd: sandboxDir });

        await fs.writeFile(
          path.join(sandboxDir, "package.json"),
          JSON.stringify(
            {
              name: "discount-service",
              version: "1.0.0",
              type: "module",
              scripts: { test: "node --test test/discount.test.js" },
            },
            null,
            2,
          ),
        );

        await fs.writeFile(
          path.join(sandboxDir, "AGENTS.md"),
          "# Instructions\n\nImplement calculateDiscount with robust input validation and complete unit tests.\n",
        );

        await execFileAsync("git", ["add", "."], { cwd: sandboxDir });
        await execFileAsync("git", ["commit", "-m", "chore: init discount repo"], { cwd: sandboxDir });

        let repairCalls = 0;
        let capturedReviews: any[] = [];

        const mockImplementerAndRepairer: IAgentExecutor = {
          harnessName: "flawed-implementer",
          capabilities: {
            roles: ["executor", "repairer"],
            filesystem: true,
            shell: true,
            structuredOutput: true,
            streaming: true,
            modelSelection: true,
            providerSelection: true,
            isMock: false,
          },
          async execute(req: AgentRequest): Promise<AgentResult> {
            await fs.mkdir(path.join(req.worktreePath, "src"), { recursive: true });
            await fs.mkdir(path.join(req.worktreePath, "test"), { recursive: true });

            if (req.role === "executor") {
              // Intentional defect: calculates discount but does NOT throw RangeError when percentage < 0 or > 100
              const flawedCode = `export function calculateDiscount(price, percentage) {
  return price - (price * (percentage / 100));
}
`;
              const initialTest = `import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscount } from "../src/discount.js";

test("calculates standard discount", () => {
  assert.equal(calculateDiscount(100, 20), 80);
});
`;
              await fs.writeFile(path.join(req.worktreePath, "src/discount.js"), flawedCode);
              await fs.writeFile(path.join(req.worktreePath, "test/discount.test.js"), initialTest);

              return {
                success: true,
                changedFiles: ["src/discount.js", "test/discount.test.js"],
                modelUsed: req.selectedModel.modelId,
                providerUsed: req.selectedModel.providerId,
                durationMs: 45,
              };
            }

            if (req.role === "repairer") {
              repairCalls++;
              // Comprehensive fix addressing all validation requirements:
              const fixedCode = `/**
 * Calculates discounted price.
 * @param {number} price
 * @param {number} percentage
 * @returns {number}
 */
export function calculateDiscount(price, percentage) {
  if (typeof price !== "number" || Number.isNaN(price)) {
    throw new TypeError("Price must be a number");
  }
  if (price < 0) {
    throw new RangeError("Price must be non-negative");
  }
  if (typeof percentage !== "number" || Number.isNaN(percentage)) {
    throw new TypeError("Percentage must be a number");
  }
  if (percentage < 0 || percentage > 100) {
    throw new RangeError("Percentage must be between 0 and 100");
  }
  return price - (price * (percentage / 100));
}
`;
              const fixedTest = `import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscount } from "../src/discount.js";

test("calculates standard discount", () => {
  assert.equal(calculateDiscount(100, 20), 80);
  assert.equal(calculateDiscount(200, 50), 100);
  assert.equal(calculateDiscount(50, 0), 50);
  assert.equal(calculateDiscount(50, 100), 0);
});

test("throws RangeError when percentage is out of range", () => {
  assert.throws(() => calculateDiscount(100, -5), RangeError);
  assert.throws(() => calculateDiscount(100, 101), RangeError);
});

test("throws RangeError when price is negative", () => {
  assert.throws(() => calculateDiscount(-10, 10), RangeError);
});

test("throws TypeError for non-numeric inputs", () => {
  assert.throws(() => calculateDiscount("100", 10), TypeError);
  assert.throws(() => calculateDiscount(100, "10"), TypeError);
});
`;
              await fs.writeFile(path.join(req.worktreePath, "src/discount.js"), fixedCode);
              await fs.writeFile(path.join(req.worktreePath, "test/discount.test.js"), fixedTest);

              return {
                success: true,
                changedFiles: ["src/discount.js", "test/discount.test.js"],
                modelUsed: req.selectedModel.modelId,
                providerUsed: req.selectedModel.providerId,
                durationMs: 55,
              };
            }

            throw new Error(`Unexpected role: ${req.role}`);
          },
        };

        const liveReviewer = new IndependentReviewer({
          forceAI: true,
          model: "google/gemini-2.5-flash",
        });

        // Intercept reviewer to capture all review rounds for audit artifact
        const originalReviewDiff = liveReviewer.reviewDiff.bind(liveReviewer);
        liveReviewer.reviewDiff = async (...args: any[]) => {
          const res = await (originalReviewDiff as any)(...args);
          capturedReviews.push(res);
          return res;
        };

        const engine = new WorkflowEngine({
          agentExecutor: mockImplementerAndRepairer,
          reviewer: liveReviewer,
          config: {
            activeHarness: "opencode",
            git: { push: false, openPr: false },
            verification: ["node --test test/discount.test.js"],
            roleMappings: {
              critic: { provider: "openrouter", model: "google/gemini-2.5-flash" },
              repairer: { provider: "openrouter", model: "google/gemini-2.5-flash" },
            },
          },
        });

        const intent =
          "Implement calculateDiscount(price, percentage) in src/discount.js. CRITICAL: must throw RangeError if percentage < 0 or percentage > 100.";

        const task = await engine.createTask(intent, sandboxDir, { executionMode: "REAL" });
        const result = await engine.startTask(task.id);
        const durationMs = Date.now() - startTime;

        expect(result.status).toBe("COMPLETED");
        expect(result.commitSha).toBeDefined();
        expect(repairCalls).toBeGreaterThanOrEqual(1);

        // Check model usage audit trail
        const criticAudits = (result.modelUsageAudit || []).filter((a) => a.role === "critic");
        expect(criticAudits.length).toBeGreaterThanOrEqual(2);

        const firstReviewAudit = criticAudits[0];
        const secondReviewAudit = criticAudits[1];

        // Verify tokens are > 0 and models are real
        expect(firstReviewAudit.actualProvider).toBe("openrouter");
        expect(firstReviewAudit.actualModel).toMatch(/gemini/i);
        expect(firstReviewAudit.tokens).toBeGreaterThan(0);

        expect(secondReviewAudit.actualProvider).toBe("openrouter");
        expect(secondReviewAudit.actualModel).toMatch(/gemini/i);
        expect(secondReviewAudit.tokens).toBeGreaterThan(0);

        // Verify initial review was CHANGES_REQUESTED with P1 findings
        expect(capturedReviews[0].verdict).toBe("CHANGES_REQUESTED");
        expect(capturedReviews[0].findings.some((f: any) => f.severity === "P0" || f.severity === "P1")).toBe(true);

        // Verify latest review is approved with 0 P0/P1 blockers
        expect(result.latestReview?.verdict).toBe("APPROVED");
        expect(result.latestReview?.findings.filter((f: any) => f.severity === "P0" || f.severity === "P1").length).toBe(0);

        // Record validation artifact
        const outDir = path.resolve(process.cwd(), "docs/validation");
        await fs.mkdir(outDir, { recursive: true });

        const evidence = {
          timestamp: new Date().toISOString(),
          testName: "Real AI Reviewer Negative Defect & Repair Loop",
          executionMode: "REAL",
          durationMs,
          taskId: result.id,
          commitSha: result.commitSha,
          criticAudits,
          capturedReviews,
          finalVerdict: result.latestReview,
        };

        await fs.writeFile(
          path.join(outDir, "2026-09-06-ai-review-negative.json"),
          JSON.stringify(evidence, null, 2),
          "utf-8",
        );

        const mdReport = `# Negative Defect & Repair Loop Validation Evidence
**Date:** 2026-09-06
**Execution Mode:** REAL
**Test Purpose:** Prove real AI reviewer catches intentional defect, returns P1, triggers repair loop, and fresh real AI reviewer approves.
**Reviewer Model:** \`${firstReviewAudit.actualModel}\` (via \`${firstReviewAudit.actualProvider}\`)
**Duration:** ${(durationMs / 1000).toFixed(1)}s

---

## 1. Initial Review (Intentional Defect Flagged by Real Gemini 2.5 Flash)
- **Reviewer Model:** \`${firstReviewAudit.actualModel}\`
- **Provider:** \`${firstReviewAudit.actualProvider}\`
- **Prompt & Completion Tokens:** \`${firstReviewAudit.tokens}\`
- **Initial Verdict:** \`${capturedReviews[0]?.verdict}\`
- **Defects Flagged (${capturedReviews[0]?.findings.length}):**
${capturedReviews[0]?.findings.map((f: any) => `  - [**${f.severity}**] \`${f.title}\`: ${f.description}`).join("\n")}

---

## 2. Automated Repair Loop
- **Repair Agent:** Resolved missing RangeError boundary checks and input validation in \`src/discount.js\`.
- **Verification Command:** \`node --test test/discount.test.js\` -> PASSED

---

## 3. Fresh Independent AI Review
- **Verdict:** \`${result.latestReview?.verdict}\`
- **Reviewer Model:** \`${secondReviewAudit.actualModel}\`
- **Tokens Used:** \`${secondReviewAudit.tokens}\`
- **Findings Count:** \`${result.latestReview?.findings.length}\`
- **Summary:** ${result.latestReview?.summary}

---

## 4. Final Verification
- **Verified Git Commit:** \`${result.commitSha}\`
- **Task Status:** \`${result.status}\` (Settled)
`;

        await fs.writeFile(path.join(outDir, "2026-09-06-ai-review-negative.md"), mdReport, "utf-8");
      } finally {
        await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    120000,
  );
});
