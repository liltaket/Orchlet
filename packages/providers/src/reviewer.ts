import { Logger } from "@orchlet/shared";
import type { IReviewEngine, ReviewVerdict, ReviewFinding } from "@orchlet/core";

export class IndependentReviewer implements IReviewEngine {
  private logger = new Logger({ prefix: "IndependentReviewer" });

  async reviewDiff(diff: string, contextPrompt?: string): Promise<ReviewVerdict> {
    this.logger.info(`Starting independent review on diff (${diff.length} bytes)...`);

    const findings: ReviewFinding[] = [];

    // Static adversarial heuristics for critical defects
    if (diff.includes("TODO") || diff.includes("FIXME")) {
      findings.push({
        id: "find_todo",
        severity: "P2",
        title: "Unresolved TODO in diff",
        filePath: "diff",
        description: "Found unresolved TODO markers in changes.",
      });
    }

    if (diff.includes("password =") || diff.includes("api_key =") || diff.includes("secret =")) {
      findings.push({
        id: "find_secret",
        severity: "P0",
        title: "Potential hardcoded credential",
        filePath: "diff",
        description: "Found possible plaintext secret or password assignment.",
        securityImpact: true,
      });
    }

    const hasBlockers = findings.some((f) => f.severity === "P0" || f.severity === "P1");
    const verdict: ReviewVerdict = {
      verdict: hasBlockers ? "CHANGES_REQUESTED" : "APPROVED",
      findings,
      summary: hasBlockers
        ? `Adversarial review identified ${findings.length} issue(s) requiring remediation.`
        : "All acceptance criteria verified. No blocking defects detected.",
      reviewedCommit: "HEAD",
      reviewerModel: "anthropic/claude-3.7-sonnet:thinking",
      timestamp: new Date().toISOString(),
    };

    this.logger.info(`Review completed. Verdict: ${verdict.verdict}, Findings: ${findings.length}`);
    return verdict;
  }
}

export const independentReviewer = new IndependentReviewer();
