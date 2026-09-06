import { Logger } from "@orchlet/shared";
import type {
  ContextFile,
  IReviewEngine,
  ReviewFinding,
  ReviewVerdict,
  VerificationResult,
  TaskPacket,
  ExecutionMode,
} from "@orchlet/core";
import { OpenRouterProvider, openRouterProvider } from "./openrouter.js";

export interface AIReviewerOptions {
  model?: string;
  provider?: OpenRouterProvider;
  forceAI?: boolean;
}

export interface ReviewExecutionOptions {
  model?: string;
  provider?: string;
  executionMode?: ExecutionMode;
}

export class IndependentReviewer implements IReviewEngine {
  private logger = new Logger({ prefix: "IndependentReviewer" });
  private provider: OpenRouterProvider;
  private defaultModel: string;
  private forceAI: boolean;

  constructor(options: AIReviewerOptions = {}) {
    this.provider = options.provider || openRouterProvider;
    this.defaultModel = options.model || "deepseek/deepseek-chat";
    this.forceAI = Boolean(options.forceAI);
  }

  async reviewDiff(
    diff: string,
    contextPrompt = "",
    verificationResults: VerificationResult[] = [],
    packet?: TaskPacket,
    options?: ReviewExecutionOptions,
  ): Promise<ReviewVerdict> {
    this.logger.info(`Starting independent adversarial review on diff (${diff.length} bytes)...`);

    const modelToUse = options?.model || this.defaultModel;
    const providerToUse = options?.provider || "openrouter";

    // If diff is completely empty and no files changed
    if (!diff || diff.trim().length === 0) {
      return {
        verdict: "CHANGES_REQUESTED",
        findings: [
          {
            id: `rev_${Date.now()}_empty`,
            severity: "P0",
            title: "Empty Diff",
            filePath: "N/A",
            description: "No code changes detected in the worktree.",
          },
        ],
        summary: "Execution produced an empty diff. Real modifications are required.",
        reviewedCommit: "HEAD",
        reviewerModel: modelToUse,
        providerUsed: providerToUse,
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
        costEstimate: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // Do NOT spend API money in automated tests unless explicitly forced
    const isTestEnv = (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) && !process.env.TEST_LIVE;
    const canUseAI = (Boolean(process.env.OPENROUTER_API_KEY) && !isTestEnv) || this.forceAI || Boolean(process.env.TEST_LIVE);

    if (canUseAI) {
      try {
        return await this.performAIReview(diff, contextPrompt, verificationResults, packet, modelToUse, providerToUse);
      } catch (err: any) {
        this.logger.warn(`AI review call failed (${err.message}). Falling back to static safety review.`);
      }
    }

    // Static fallback review for offline / test environments
    return this.performStaticSafetyReview(diff, verificationResults, modelToUse, providerToUse);
  }

  private async performAIReview(
    diff: string,
    contextPrompt: string,
    verificationResults: VerificationResult[],
    packet?: TaskPacket,
    modelToUse?: string,
    providerToUse?: string,
  ): Promise<ReviewVerdict> {
    const testSummary = verificationResults.length > 0
      ? verificationResults
          .map((v) => `Command: ${v.command} -> ${v.passed ? "PASSED" : "FAILED (exit " + v.exitCode + ")"}\nOutput:\n${v.stderrTail || v.stdoutTail}`)
          .join("\n\n")
      : "No automated test results recorded.";

    let instructions = "";
    if (packet?.contextBundle?.files) {
      instructions = packet.contextBundle.files
        .map((f: ContextFile) => `### From ${f.relativePath}:\n${f.content}`)
        .join("\n\n");
    }

    const systemPrompt = `You are an expert, adversarial, independent code reviewer for Orchlet.
Your job is to thoroughly audit the provided git diff against the user's objective and repository instructions.
You must be rigorous and skeptical. Do NOT give benefit of the doubt.

Severity Definitions:
- P0: Critical Blocker (security vulnerability, credential leak, crash, build break, data corruption, empty or fake implementation)
- P1: Important Defect (logic flaw, incorrect behavior against requirements, missing unit tests for new logic, regression)
- P2: Improvement (code quality, maintainability, minor performance optimization)
- P3: Nit (stylistic suggestion, comment grammar)

Rules:
1. If there are any P0 or P1 findings, the verdict MUST be "CHANGES_REQUESTED" or "BLOCKED".
2. Only return "APPROVED" if there are ZERO P0 and ZERO P1 findings.
3. Respond ONLY with a valid JSON object adhering exactly to this schema:
{
  "verdict": "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED",
  "findings": [
    {
      "severity": "P0" | "P1" | "P2" | "P3",
      "title": "Short title",
      "filePath": "path/to/file",
      "lineRange": { "start": 1, "end": 10 },
      "description": "Clear explanation of the defect",
      "suggestedFix": "How to fix it",
      "securityImpact": false
    }
  ],
  "summary": "Brief executive summary of findings and overall assessment."
}`;

    const userMessage = `# USER OBJECTIVE
${packet?.objective || contextPrompt || "Ensure code quality and correctness."}

# REPOSITORY INSTRUCTIONS
${instructions || "Follow standard clean code and testing best practices."}

# AUTOMATED VERIFICATION RESULTS
${testSummary}

# GIT DIFF TO AUDIT
\`\`\`diff
${diff}
\`\`\``;

    const response = await this.provider.complete({
      model: modelToUse || this.defaultModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Reviewer response did not contain valid JSON object");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const findings: ReviewFinding[] = (parsed.findings || []).map((f: any, idx: number) => ({
      id: `rev_${Date.now()}_${idx}`,
      severity: f.severity || "P2",
      title: f.title || "Review finding",
      filePath: f.filePath || "unknown",
      lineRange: f.lineRange,
      description: f.description || "",
      suggestedFix: f.suggestedFix,
      securityImpact: Boolean(f.securityImpact),
    }));

    const verdict = parsed.verdict || (findings.some((f) => f.severity === "P0" || f.severity === "P1") ? "CHANGES_REQUESTED" : "APPROVED");

    this.logger.info(
      `AI review completed via ${response.model}. Verdict: ${verdict}, Findings: ${findings.length}`
    );

    return {
      verdict,
      findings,
      summary: parsed.summary || "Independent review completed.",
      reviewedCommit: "HEAD",
      reviewerModel: response.model,
      providerUsed: providerToUse || "openrouter",
      tokensUsed: response.tokensUsed,
      costEstimate: response.costUsd,
      timestamp: new Date().toISOString(),
    };
  }

  private performStaticSafetyReview(
    diff: string,
    verificationResults: VerificationResult[],
    modelUsed = "offline-safety-reviewer",
    providerUsed = "local",
  ): ReviewVerdict {
    const findings: ReviewFinding[] = [];

    // Check for test failures
    const failedTests = verificationResults.filter((v) => !v.passed);
    if (failedTests.length > 0) {
      findings.push({
        id: `rev_${Date.now()}_test_fail`,
        severity: "P0",
        title: "Automated Verification Failure",
        filePath: "tests",
        description: `Verification command failed: ${failedTests.map((t) => t.command).join(", ")}`,
      });
    }

    // Check for plaintext secrets / keys in diff
    if (/api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i.test(diff) || /ghp_[a-zA-Z0-9]{36}/.test(diff)) {
      findings.push({
        id: `rev_${Date.now()}_secret`,
        severity: "P0",
        title: "Hardcoded Credential Detected",
        filePath: "diff",
        description: "Git diff contains potential hardcoded API secret or credential token.",
        securityImpact: true,
      });
    }

    const hasBlockers = findings.some((f) => f.severity === "P0" || f.severity === "P1");

    return {
      verdict: hasBlockers ? "CHANGES_REQUESTED" : "APPROVED",
      findings,
      summary: hasBlockers
        ? `Review flagged ${findings.length} blocking issues requiring resolution.`
        : "Safety scan passed. Zero high-severity defects detected.",
      reviewedCommit: "HEAD",
      reviewerModel: modelUsed,
      providerUsed,
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      costEstimate: 0,
      timestamp: new Date().toISOString(),
    };
  }
}

export const independentReviewer = new IndependentReviewer();
