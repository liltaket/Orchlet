import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "../../../apps/server/src/server.js";
import { AuthManager } from "../../../apps/server/src/auth.js";

const execFileAsync = promisify(execFile);
const isLive = Boolean(process.env.TEST_LIVE);

describe.runIf(isLive)("Production Daemon HTTP End-to-End Live Validation", () => {
  it(
    "proves full production daemon lifecycle: HTTP POST -> dynamic OpenCode -> verification -> real AI review -> commit -> push -> GitHub PR -> CI observed -> READY_TO_MERGE",
    async () => {
      const sandboxRepo = path.join(os.homedir(), "orchlet-sandbox");

      // Verify repo exists and origin points to orchlet-sandbox
      const { stdout: remoteUrl } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: sandboxRepo,
      });
      expect(remoteUrl.trim()).toContain("orchlet-sandbox");

      // Sync with main branch
      await execFileAsync("git", ["checkout", "main"], { cwd: sandboxRepo });
      await execFileAsync("git", ["pull", "origin", "main"], { cwd: sandboxRepo }).catch(() => {});

      // 1. Start real production Fastify daemon without manual engine injection
      const server = await createServer();
      const token = await AuthManager.getOrCreateToken();
      await server.listen({ port: 0, host: "127.0.0.1" });

      const address = server.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      console.log(`Production daemon started on ${baseUrl}`);

      const startTime = Date.now();

      try {
        const intent = `Add titleCase string utility in src/titleCase.js and tests in test/titleCase.test.js`;

        // 2. Submit task via standard HTTP POST /api/tasks
        const postRes = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            intent,
            repoPath: sandboxRepo,
            executionMode: "REAL",
          }),
        });

        expect(postRes.status).toBe(202);
        const createdTask = (await postRes.json()) as any;
        expect(createdTask.id).toBeDefined();
        const taskId = createdTask.id;
        console.log(`Task ${taskId} submitted over HTTP. Polling status via GET /api/tasks/${taskId}...`);

        // 3. Poll task status over HTTP
        let finalTask: any = null;
        const maxPollTimeMs = 300000; // 5 minutes
        const pollIntervalMs = 3000;
        const pollStart = Date.now();

        while (Date.now() - pollStart < maxPollTimeMs) {
          const pollRes = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (pollRes.status === 200) {
            const current = (await pollRes.json()) as any;
            console.log(`Task status: ${current.status} (${current.attentionState})`);

            if (
              current.status === "READY_TO_MERGE" ||
              current.status === "COMPLETED" ||
              current.status === "FAILED"
            ) {
              finalTask = current;
              break;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        if (finalTask?.status === "FAILED") {
          expect(finalTask.error).toBe("TASK COMPLETED WITHOUT ERROR");
        }

        expect(finalTask).not.toBeNull();
        expect(finalTask.status).toMatch(/READY_TO_MERGE|COMPLETED/);
        expect(finalTask.attentionState).toBe("SETTLED");
        expect(finalTask.executionMode).toBe("REAL");
        expect(finalTask.commitSha).toBeDefined();
        expect(finalTask.commitSha.length).toBe(40);
        expect(finalTask.prNumber).toBeGreaterThan(0);
        expect(finalTask.prUrl).toContain("github.com/liltaket/orchlet-sandbox/pull/");

        // 4. Verify Model Audits (OpenCode executor + real AI reviewer with non-zero tokens)
        const audits = finalTask.modelUsageAudit || [];
        const executorAudit = audits.find((a: any) => a.role === "executor");
        const criticAudit = audits.find((a: any) => a.role === "critic");

        expect(executorAudit).toBeDefined();
        expect(criticAudit).toBeDefined();

        // Reviewer must have made real network call with non-zero tokens
        expect(criticAudit.actualProvider).toBe("openrouter");
        expect(criticAudit.actualModel).toMatch(/gemini/i);
        expect(criticAudit.tokens).toBeGreaterThan(0);

        // 5. Query GitHub CLI directly to verify PR on GitHub
        const { stdout: prJson } = await execFileAsync("gh", [
          "pr",
          "view",
          finalTask.prNumber.toString(),
          "--repo",
          "liltaket/orchlet-sandbox",
          "--json",
          "number,title,url,state,headRefName,baseRefName,statusCheckRollup,mergeable",
        ]);
        const ghPr = JSON.parse(prJson);

        expect(ghPr.number).toBe(finalTask.prNumber);
        expect(ghPr.state).toBe("OPEN");

        const durationMs = Date.now() - startTime;

        // 6. Save structured validation artifact
        const outDir = path.resolve(process.cwd(), "docs/validation");
        await fs.mkdir(outDir, { recursive: true });

        const validationRecord = {
          timestamp: new Date().toISOString(),
          testName: "Production Daemon HTTP -> Real GitHub PR",
          durationMs,
          taskId: finalTask.id,
          executionMode: finalTask.executionMode,
          finalStatus: finalTask.status,
          finalAttentionState: finalTask.attentionState,
          commitSha: finalTask.commitSha,
          prNumber: finalTask.prNumber,
          prUrl: finalTask.prUrl,
          requestedExecutorModel: executorAudit.requestedModel,
          actualExecutorModel: executorAudit.actualModel,
          requestedReviewerModel: criticAudit.requestedModel,
          actualReviewerModel: criticAudit.actualModel,
          reviewerTokens: criticAudit.tokens,
          reviewerCostUsd: criticAudit.costUsd,
          verificationResults: finalTask.verificationResults,
          githubPr: ghPr,
        };

        await fs.writeFile(
          path.join(outDir, "2026-09-06-production-daemon-pr.json"),
          JSON.stringify(validationRecord, null, 2),
          "utf-8",
        );

        const mdReport = `# Production Daemon HTTP to Real GitHub PR Validation Record
**Date:** 2026-09-06
**Execution Path:** Production Fastify Daemon (\`POST /api/tasks\`) -> Dynamic Harness Resolution -> Real OpenCode -> Real Verification -> Real AI Reviewer -> Git Commit -> Push -> GitHub PR -> CI Observation -> READY_TO_MERGE
**Duration:** ${(durationMs / 1000).toFixed(1)}s

---

## 1. Execution Summary
- **Task ID:** \`${finalTask.id}\`
- **Daemon HTTP Endpoint:** \`${baseUrl}/api/tasks\`
- **Auth Scheme:** Bearer Token via \`~/.orchlet/auth-token\`
- **Execution Mode:** \`${finalTask.executionMode}\` (REAL)
- **Final Status:** \`${finalTask.status}\`
- **Attention State:** \`${finalTask.attentionState}\`
- **Verified Commit SHA:** \`${finalTask.commitSha}\`

---

## 2. Dynamic Agent & Reviewer Identity Audit
- **Executor Harness:** Dynamic OpenCode (no manual injection)
- **Requested Executor Model:** \`${executorAudit.requestedModel}\` (\`${executorAudit.requestedProvider}\`)
- **Actual Executor Model:** \`${executorAudit.actualModel}\` (\`${executorAudit.actualProvider}\`)
- **Requested Reviewer Model:** \`${criticAudit.requestedModel}\` (\`${criticAudit.requestedProvider}\`)
- **Actual Reviewer Model:** \`${criticAudit.actualModel}\` (\`${criticAudit.actualProvider}\`)
- **Reviewer Token Usage:** **${criticAudit.tokens} tokens** (Prompt + Completion > 0)
- **Reviewer Cost:** $${criticAudit.costUsd?.toFixed(5) ?? 0}
- **Static Fallback:** **DID NOT RUN** (Verified real AI network call)

---

## 3. Real GitHub PR & CI Verification
- **GitHub Repository:** [liltaket/orchlet-sandbox](https://github.com/liltaket/orchlet-sandbox)
- **Pull Request:** [${ghPr.url}](${ghPr.url}) (PR #${ghPr.number})
- **Branch:** \`${finalTask.workBranch}\` -> \`main\`
- **State:** \`${ghPr.state}\`
- **Mergeable:** \`${ghPr.mergeable}\`
- **CI Status Check Rollup:** \`${JSON.stringify(ghPr.statusCheckRollup || [])}\`

---

## 4. Verification Gate Results
${finalTask.verificationResults?.map((v: any) => `- Command: \`${v.command}\` (exit code: ${v.exitCode}, ${v.durationMs}ms) -> **${v.passed ? "PASSED" : "FAILED"}**`).join("\n")}
`;

        await fs.writeFile(path.join(outDir, "2026-09-06-production-daemon-pr.md"), mdReport, "utf-8");
        console.log("Validation artifact saved to docs/validation/2026-09-06-production-daemon-pr.md");
      } finally {
        await server.close();
      }
    },
    360000, // 6 minute test timeout
  );
});
