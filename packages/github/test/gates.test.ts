import { describe, it, expect } from "vitest";
import { evaluateMergeGates } from "../src/gates.js";

describe("GitHub Preflight Safe Merge Gates", () => {
  it("allows merge when PR is clean, approved, and CI is passing", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    expect(result.canMerge).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks merge when PR is in draft mode", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: true,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "APPROVED", authorAssociation: "MEMBER" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    expect(result.canMerge).toBe(false);
    expect(result.reason).toContain("Draft mode");
  });

  it("blocks merge and signals conflict when branch is conflicting", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: false,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      reviews: [{ state: "APPROVED", authorAssociation: "OWNER" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    expect(result.canMerge).toBe(false);
    expect(result.actionRequired).toBe("RESOLVE_CONFLICT");
  });

  it("blocks merge and requests branch update when behind base branch", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "BEHIND",
      reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    expect(result.canMerge).toBe(false);
    expect(result.actionRequired).toBe("UPDATE_BRANCH");
  });

  it("blocks merge when unresolved review threads exist", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "APPROVED", authorAssociation: "MEMBER" }],
      unresolvedThreadCount: 2,
      statusRollupState: "SUCCESS",
    });

    expect(result.canMerge).toBe(false);
    expect(result.actionRequired).toBe("RESOLVE_THREADS");
  });

  it("blocks merge when CI check runs are failing", () => {
    const result = evaluateMergeGates({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviews: [{ state: "APPROVED", authorAssociation: "MEMBER" }],
      unresolvedThreadCount: 0,
      statusRollupState: "FAILURE",
    });

    expect(result.canMerge).toBe(false);
    expect(result.actionRequired).toBe("WAIT_CI");
  });
});
