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
  ): Promise<{ merged: boolean; reason?: string }> {
    const maxAttempts = options.maxPollAttempts || 5;
    const isSimulate = options.simulate ?? false;

    this.logger.info(`Starting PR babysitter for ${repoOwner}/${repoName}#${prNumber} (simulate=${isSimulate})`);

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
        this.logger.info(`PR #${prNumber} passed all gates! Attempting merge...`);
        if (isSimulate) {
          this.logger.info(`Simulated merge success for PR #${prNumber}`);
          return { merged: true, reason: "Simulated merge completed." };
        }

        try {
          await execFileAsync("gh", [
            "pr",
            "merge",
            prNumber.toString(),
            "--repo",
            `${repoOwner}/${repoName}`,
            "--squash",
            "--delete-branch",
          ]);
          this.logger.info(`Successfully merged PR #${prNumber}`);
          return { merged: true };
        } catch (err: any) {
          this.logger.error(`gh pr merge failed: ${err.message}`);
          return { merged: false, reason: `Merge command failed: ${err.message}` };
        }
      }

      this.logger.info(`PR #${prNumber} waiting: ${gate.reason} (action: ${gate.actionRequired})`);
      if (attempt < maxAttempts - 1) {
        const waitMs = options.pollDelayOverrideMs ?? computeNextPollInterval(attempt);
        this.logger.debug(`Waiting ${waitMs}ms before poll attempt ${attempt + 2}...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return { merged: false, reason: "Max babysitting poll attempts reached without passing gates" };
  }
}

export const prBabysitter = new PRBabysitter();
