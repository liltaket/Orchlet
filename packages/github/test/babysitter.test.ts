import { describe, it, expect, vi } from "vitest";
import { PRBabysitter } from "../src/babysitter.js";
import type { PRGateInput } from "../src/gates.js";

describe("PRBabysitter Transitions", () => {
  it("transitions to READY_TO_MERGE when CI and review pass and autoMerge is false", async () => {
    const babysitter = new PRBabysitter();
    vi.spyOn(babysitter, "getPRStatus").mockResolvedValue({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    const result = await babysitter.babysitPR("liltaket", "Orchlet", 42, {
      autoMerge: false,
      maxPollAttempts: 2,
    });

    expect(result.readyToMerge).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.reason).toContain("Ready for manual or policy merge");
  });

  it("handles CI pending across polls until success", async () => {
    const babysitter = new PRBabysitter();
    let pollCount = 0;
    vi.spyOn(babysitter, "getPRStatus").mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) {
        return {
          state: "OPEN",
          isDraft: false,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
          unresolvedThreadCount: 0,
          statusRollupState: "PENDING",
        };
      }
      return {
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
        unresolvedThreadCount: 0,
        statusRollupState: "SUCCESS",
      };
    });

    const result = await babysitter.babysitPR("liltaket", "Orchlet", 42, {
      autoMerge: false,
      maxPollAttempts: 3,
      pollDelayOverrideMs: 1,
    });

    expect(pollCount).toBe(2);
    expect(result.readyToMerge).toBe(true);
    expect(result.merged).toBe(false);
  });

  it("fails when CI checks fail", async () => {
    const babysitter = new PRBabysitter();
    vi.spyOn(babysitter, "getPRStatus").mockResolvedValue({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "APPROVED", authorAssociation: "COLLABORATOR" }],
      unresolvedThreadCount: 0,
      statusRollupState: "FAILURE",
    });

    const result = await babysitter.babysitPR("liltaket", "Orchlet", 42, {
      autoMerge: false,
      maxPollAttempts: 1,
      pollDelayOverrideMs: 1,
    });

    expect(result.readyToMerge).toBe(false);
    expect(result.merged).toBe(false);
  });

  it("fails when reviews request changes", async () => {
    const babysitter = new PRBabysitter();
    vi.spyOn(babysitter, "getPRStatus").mockResolvedValue({
      state: "OPEN",
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviews: [{ state: "CHANGES_REQUESTED", authorAssociation: "COLLABORATOR" }],
      unresolvedThreadCount: 0,
      statusRollupState: "SUCCESS",
    });

    const result = await babysitter.babysitPR("liltaket", "Orchlet", 42, {
      autoMerge: false,
      maxPollAttempts: 1,
      pollDelayOverrideMs: 1,
    });

    expect(result.readyToMerge).toBe(false);
    expect(result.merged).toBe(false);
  });

  it("merges PR when autoMerge is true in simulated mode", async () => {
    const babysitter = new PRBabysitter();
    const result = await babysitter.babysitPR("liltaket", "Orchlet", 42, {
      simulate: true,
      autoMerge: true,
      maxPollAttempts: 1,
    });

    expect(result.readyToMerge).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.reason).toContain("Simulated merge completed");
  });
});
