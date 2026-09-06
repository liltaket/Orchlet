export interface GateEvaluation {
  canMerge: boolean;
  reason?: string;
  actionRequired?: "UPDATE_BRANCH" | "WAIT_CI" | "WAIT_REVIEW" | "RESOLVE_CONFLICT" | "RESOLVE_THREADS";
}

export type NormalizedCheckState = "SUCCESS" | "PENDING" | "FAILURE" | "ERROR";

export function normalizeCheckItem(check: any): NormalizedCheckState {
  if (!check || typeof check !== "object") {
    return "ERROR";
  }

  // 1. StatusContext: uses .state (EXPECTED, PENDING, SUCCESS, ERROR, FAILURE)
  if (check.__typename === "StatusContext" || (check.state && !check.conclusion && !check.status)) {
    const state = String(check.state || "").trim().toUpperCase();
    switch (state) {
      case "EXPECTED":
      case "PENDING":
        return "PENDING";
      case "SUCCESS":
        return "SUCCESS";
      case "FAILURE":
        return "FAILURE";
      case "ERROR":
        return "ERROR";
      default:
        // Conservative: unknown state is treated as ERROR, never SUCCESS
        return "ERROR";
    }
  }

  // 2. CheckRun: uses .status (QUEUED, IN_PROGRESS, COMPLETED, etc.) and .conclusion
  const status = String(check.status || "").trim().toUpperCase();
  const conclusion = check.conclusion ? String(check.conclusion).trim().toUpperCase() : null;

  // Active or unstarted check run
  if (status === "QUEUED" || status === "IN_PROGRESS" || status === "WAITING" || status === "REQUESTED" || status === "PENDING") {
    return "PENDING";
  }

  // If conclusion is explicitly available (COMPLETED or conclusion set)
  if (conclusion) {
    switch (conclusion) {
      case "SUCCESS":
      case "NEUTRAL":
      case "SKIPPED":
        return "SUCCESS";
      case "FAILURE":
      case "CANCELLED":
      case "TIMED_OUT":
      case "ACTION_REQUIRED":
      case "STALE":
        return "FAILURE";
      case "ERROR":
        return "ERROR";
      default:
        // Unknown conclusion: conservative fail
        return "ERROR";
    }
  }

  // Completed but no conclusion yet
  if (status === "COMPLETED") {
    return "PENDING";
  }

  // Check generic .state fallback if status was empty
  if (check.state) {
    const fallbackState = String(check.state).trim().toUpperCase();
    if (fallbackState === "SUCCESS") return "SUCCESS";
    if (fallbackState === "PENDING" || fallbackState === "EXPECTED") return "PENDING";
    if (fallbackState === "FAILURE") return "FAILURE";
    if (fallbackState === "ERROR") return "ERROR";
  }

  // Unrecognized check format
  return "ERROR";
}

export function normalizeRollupState(checks: any[]): NormalizedCheckState {
  if (!Array.isArray(checks) || checks.length === 0) {
    return "SUCCESS";
  }

  let hasFailure = false;
  let hasError = false;
  let hasPending = false;

  for (const check of checks) {
    const normalized = normalizeCheckItem(check);
    if (normalized === "FAILURE") {
      hasFailure = true;
    } else if (normalized === "ERROR") {
      hasError = true;
    } else if (normalized === "PENDING") {
      hasPending = true;
    }
  }

  // Precedence: FAILURE > ERROR > PENDING > SUCCESS
  if (hasFailure) return "FAILURE";
  if (hasError) return "ERROR";
  if (hasPending) return "PENDING";
  return "SUCCESS";
}

export interface PRGateInput {
  state: "OPEN" | "CLOSED" | "MERGED" | string;
  isDraft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  mergeStateStatus: "CLEAN" | "BLOCKED" | "BEHIND" | "DIRTY" | "UNSTABLE" | "HAS_HOOKS" | string;
  reviews: Array<{ state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | string; authorAssociation: string }>;
  unresolvedThreadCount: number;
  statusRollupState: NormalizedCheckState | string;
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
