export interface GateEvaluation {
  canMerge: boolean;
  reason?: string;
  actionRequired?: "UPDATE_BRANCH" | "WAIT_CI" | "WAIT_REVIEW" | "RESOLVE_CONFLICT" | "RESOLVE_THREADS";
}

export interface PRGateInput {
  state: "OPEN" | "CLOSED" | "MERGED" | string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  mergeStateStatus: "CLEAN" | "BLOCKED" | "BEHIND" | "DIRTY" | "UNSTABLE" | "HAS_HOOKS" | string;
  reviews: Array<{ state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | string; authorAssociation: string }>;
  unresolvedThreadCount: number;
  statusRollupState: "SUCCESS" | "PENDING" | "FAILURE" | "ERROR" | string;
}

export function evaluateMergeGates(pr: PRGateInput): GateEvaluation {
  if (pr.state !== "OPEN") {
    return { canMerge: false, reason: `PR is not open (current state: ${pr.state})` };
  }
  if (pr.isDraft) {
    return { canMerge: false, reason: "PR is currently in Draft mode" };
  }

  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
    return { canMerge: false, reason: "Merge conflict detected with base branch", actionRequired: "RESOLVE_CONFLICT" };
  }

  if (pr.mergeable === "UNKNOWN") {
    return { canMerge: false, reason: "GitHub is calculating mergeability", actionRequired: "WAIT_CI" };
  }

  if (pr.unresolvedThreadCount > 0) {
    return {
      canMerge: false,
      reason: `${pr.unresolvedThreadCount} review thread(s) unresolved`,
      actionRequired: "RESOLVE_THREADS",
    };
  }

  // Changes requested
  const hasChangesRequested = pr.reviews.some((r) => r.state === "CHANGES_REQUESTED");
  if (hasChangesRequested) {
    return { canMerge: false, reason: "Changes requested by reviewer", actionRequired: "WAIT_REVIEW" };
  }

  // Branch behind base branch
  if (pr.mergeStateStatus === "BEHIND") {
    return { canMerge: false, reason: "Branch is behind base branch", actionRequired: "UPDATE_BRANCH" };
  }

  // CI status checks
  if (pr.statusRollupState === "PENDING" || pr.mergeStateStatus === "BLOCKED") {
    return { canMerge: false, reason: "CI checks pending or failing", actionRequired: "WAIT_CI" };
  }

  if (pr.statusRollupState === "FAILURE" || pr.statusRollupState === "ERROR") {
    return { canMerge: false, reason: "CI checks failed", actionRequired: "WAIT_CI" };
  }

  if (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "UNSTABLE") {
    return { canMerge: true };
  }

  return { canMerge: false, reason: `PR in blocked merge state: ${pr.mergeStateStatus}` };
}
