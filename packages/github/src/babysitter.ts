import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Logger } from "@orchlet/shared";
import type { IBabysitter } from "@orchlet/core";
import { evaluateMergeGates, type PRGateInput } from "./gates.js";
import { computeNextPollInterval } from "./backoff.js";

const execFileAsync = promisify(execFile);

export interface BabysitOptions {
  maxPollAttempts?: number;
  simulate?: boolean;
  pollDelayOverrideMs?: number;
  autoMerge?: boolean;
}

export class PRBabysitter implements IBabysitter {
  private logger = new Logger({ prefix: "PRBabysitter" });

  async resolveToken(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("gh", ["auth", "token"]);
      return stdout.trim();
    } catch {
      return process.env.GITHUB_TOKEN || null;
    }
  }

  async createPullRequest(
    repoPath: string,
    options: {
      title: string;
      body: string;
      headBranch: string;
      baseBranch?: string;
      draft?: boolean;
    },
  ): Promise<{ prNumber: number; prUrl: string }> {
    this.logger.info(`Opening pull request for branch ${options.headBranch} in: ${repoPath}`);
    const args = [
      "pr",
      "create",
      "--title",
      options.title,
      "--body",
      options.body,
      "--head",
      options.headBranch,
    ];
    if (options.baseBranch) {
      args.push("--base", options.baseBranch);
    }
    if (options.draft) {
      args.push("--draft");
    }

    const { stdout } = await execFileAsync("gh", args, { cwd: repoPath });
    const prUrl = stdout.trim();
    const match = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = match ? parseInt(match[1], 10) : 1;

    this.logger.info(`Successfully created PR #${prNumber}: ${prUrl}`);
    return { prNumber, prUrl };
  }

  async getPRStatus(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    simulate = false,
  ): Promise<PRGateInput> {
    if (simulate) {
      return {
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
        unresolvedThreadCount: 0,
        statusRollupState: "SUCCESS",
      };
    }

    try {
      const { stdout } = await execFileAsync("gh", [
        "pr",
        "view",
        prNumber.toString(),
        "--repo",
        `${repoOwner}/${repoName}`,
        "--json",
        "state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,reviews",
      ]);
      const data = JSON.parse(stdout);
      const reviews = (data.reviews || []).map((r: any) => ({
        state: r.state,
        authorAssociation: r.authorAssociation || "NONE",
      }));

      let statusRollupState = "SUCCESS";
      const rollups = data.statusCheckRollup || [];
      for (const check of rollups) {
        if (check.conclusion === "FAILURE" || check.status === "FAILED") {
          statusRollupState = "FAILURE";
          break;
        }
        if (check.status === "IN_PROGRESS" || check.status === "QUEUED") {
          statusRollupState = "PENDING";
        }
      }

      return {
        state: data.state || "OPEN",
        isDraft: Boolean(data.isDraft),
        mergeable: data.mergeable || "MERGEABLE",
        mergeStateStatus: data.mergeStateStatus || "CLEAN",
        reviews,
        unresolvedThreadCount: 0,
        statusRollupState,
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch PR status via gh CLI: ${err.message}`);
      throw err;
    }
  }

  async babysitPR(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    options: BabysitOptions = {},
  ): Promise<{ merged: boolean; readyToMerge?: boolean; reason?: string }> {
    const maxAttempts = options.maxPollAttempts || 5;
    const isSimulate = options.simulate ?? false;
    const autoMerge = options.autoMerge ?? false;

    this.logger.info(
      `Starting PR babysitter for ${repoOwner}/${repoName}#${prNumber} (simulate=${isSimulate}, autoMerge=${autoMerge})`
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let prState: PRGateInput;
      try {
        prState = await this.getPRStatus(repoOwner, repoName, prNumber, isSimulate);
      } catch (err: any) {
        this.logger.warn(`Attempt ${attempt + 1}: could not query PR status: ${err.message}`);
        if (attempt === maxAttempts - 1) {
          return { merged: false, reason: `PR status query failed: ${err.message}` };
        }
        const waitMs = options.pollDelayOverrideMs ?? computeNextPollInterval(attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      const gate = evaluateMergeGates(prState);

      if (gate.canMerge) {
        this.logger.info(`PR #${prNumber} passed all gates!`);
        if (!autoMerge) {
          this.logger.info(
            `Auto-merge is false. PR #${prNumber} is verified and READY_TO_MERGE.`
          );
          return {
            merged: false,
            readyToMerge: true,
            reason: "All checks and reviews passed. Ready for manual or policy merge.",
          };
        }

        this.logger.info(`Auto-merge is enabled. Attempting merge for PR #${prNumber}...`);
        if (isSimulate) {
          this.logger.info(`Simulated merge success for PR #${prNumber}`);
          return { merged: true, readyToMerge: true, reason: "Simulated merge completed." };
        }

        try {
          await execFileAsync("gh", [
            "pr",
            "merge",
            prNumber.toString(),
            "--merge",
            "--repo",
            `${repoOwner}/${repoName}`,
          ]);
          this.logger.info(`PR #${prNumber} successfully merged!`);
          return { merged: true, readyToMerge: true, reason: "PR merged into base branch." };
        } catch (mergeErr: any) {
          this.logger.error(`Merge command failed for PR #${prNumber}: ${mergeErr.message}`);
          return { merged: false, readyToMerge: true, reason: `Merge failed: ${mergeErr.message}` };
        }
      }

      this.logger.info(`Gate check ${attempt + 1}/${maxAttempts} pending: ${gate.reason || "Gates not satisfied"}`);

      if (attempt < maxAttempts - 1) {
        const waitMs = options.pollDelayOverrideMs ?? computeNextPollInterval(attempt);
        this.logger.debug(`Backing off for ${waitMs}ms before next poll...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return {
      merged: false,
      readyToMerge: false,
      reason: `Exhausted ${maxAttempts} poll attempts waiting for CI/review gates.`,
    };
  }
}

export const prBabysitter = new PRBabysitter();
