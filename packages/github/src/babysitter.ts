import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Logger } from "@orchlet/shared";
import type { IBabysitter } from "@orchlet/core";
import { evaluateMergeGates, type PRGateInput } from "./gates.js";
import { computeNextPollInterval } from "./backoff.js";

const execFileAsync = promisify(execFile);

export type BabysitterStatus =
  | "READY_TO_MERGE"
  | "MERGED"
  | "WAITING_FOR_CI"
  | "CI_FAILED"
  | "CHANGES_REQUESTED"
  | "CONFLICT"
  | "TIMED_OUT";

export interface BabysitResult {
  merged: boolean;
  readyToMerge?: boolean;
  status: BabysitterStatus;
  reason?: string;
}

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
      return null;
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
      repo?: string;
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
    if (options.repo) {
      args.push("--repo", options.repo);
    }
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
  ): Promise<BabysitResult> {
    const maxAttempts = options.maxPollAttempts || 5;
    const isSimulate = options.simulate ?? false;
    const autoMerge = options.autoMerge ?? false;

    this.logger.info(
      `Starting PR babysitter for ${repoOwner}/${repoName}#${prNumber} (simulate=${isSimulate}, autoMerge=${autoMerge})`
    );

    let lastGateState: { status: BabysitterStatus; reason: string } = {
      status: "WAITING_FOR_CI",
      reason: "Waiting for checks to report.",
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let prState: PRGateInput;
      try {
        prState = await this.getPRStatus(repoOwner, repoName, prNumber, isSimulate);
      } catch (err: any) {
        this.logger.warn(`Attempt ${attempt + 1}: could not query PR status: ${err.message}`);
        if (attempt === maxAttempts - 1) {
          return {
            merged: false,
            readyToMerge: false,
            status: "TIMED_OUT",
            reason: `PR status query failed: ${err.message}`,
          };
        }
        const waitMs = options.pollDelayOverrideMs ?? computeNextPollInterval(attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      // Check specific states
      if (prState.reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
        lastGateState = {
          status: "CHANGES_REQUESTED",
          reason: "Changes requested by reviewer.",
        };
      } else if (prState.statusRollupState === "FAILURE" || prState.statusRollupState === "ERROR") {
        lastGateState = {
          status: "CI_FAILED",
          reason: "One or more CI status checks reported failure.",
        };
      } else if (prState.mergeable === "CONFLICTING") {
        lastGateState = {
          status: "CONFLICT",
          reason: "PR has merge conflicts.",
        };
      } else {
        lastGateState = {
          status: "WAITING_FOR_CI",
          reason: `CI status is ${prState.statusRollupState || "PENDING"}. Waiting for completion.`,
        };
      }

      const gateEvaluation = evaluateMergeGates(prState);

      if (gateEvaluation.canMerge) {
        this.logger.info(`All merge gates satisfied for PR #${prNumber}.`);

        if (autoMerge) {
          if (isSimulate) {
            this.logger.info(`Simulated merge for PR #${prNumber}`);
            return { merged: true, readyToMerge: true, status: "MERGED", reason: "Simulated merge completed." };
          }
          this.logger.info(`Auto-merge is enabled. Attempting merge via gh CLI...`);
          try {
            await execFileAsync("gh", [
              "pr",
              "merge",
              prNumber.toString(),
              "--repo",
              `${repoOwner}/${repoName}`,
              "--merge",
              "--delete-branch",
            ]);
            this.logger.info(`PR #${prNumber} successfully merged.`);
            return { merged: true, readyToMerge: true, status: "MERGED" };
          } catch (mergeErr: any) {
            this.logger.error(`Failed to auto-merge PR #${prNumber}: ${mergeErr.message}`);
            return {
              merged: false,
              readyToMerge: true,
              status: "READY_TO_MERGE",
              reason: `Auto-merge execution failed: ${mergeErr.message}`,
            };
          }
        }

        return { merged: false, readyToMerge: true, status: "READY_TO_MERGE", reason: "Ready for manual or policy merge (all gates satisfied)." };
      }

      this.logger.info(
        `Attempt ${attempt + 1}/${maxAttempts}: gates not yet satisfied (${gateEvaluation.reason || "Gates not met"}). Retrying...`
      );

      if (attempt < maxAttempts - 1) {
        const waitMs = options.pollDelayOverrideMs ?? computeNextPollInterval(attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    this.logger.warn(`PR #${prNumber} babysitting timed out after ${maxAttempts} attempts.`);
    return {
      merged: false,
      readyToMerge: false,
      status: lastGateState.status,
      reason: lastGateState.reason,
    };
  }
}

export const prBabysitter = new PRBabysitter();
