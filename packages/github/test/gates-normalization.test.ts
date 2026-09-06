import { describe, it, expect } from "vitest";
import {
  normalizeCheckItem,
  normalizeRollupState,
  evaluateMergeGates,
  type PRGateInput,
} from "../src/gates.js";

describe("GitHub Status & CheckRun Rollup Normalization", () => {
  describe("normalizeCheckItem", () => {
    it("handles CheckRun active/pending statuses", () => {
      const pendingStatuses = ["QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "PENDING"];
      for (const status of pendingStatuses) {
        expect(normalizeCheckItem({ __typename: "CheckRun", status, conclusion: null })).toBe("PENDING");
        expect(normalizeCheckItem({ status })).toBe("PENDING");
      }
    });

    it("handles CheckRun completed conclusions", () => {
      // Successful / neutral
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" })).toBe("SUCCESS");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL" })).toBe("SUCCESS");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" })).toBe("SUCCESS");

      // Failures
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" })).toBe("FAILURE");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "CANCELLED" })).toBe("FAILURE");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT" })).toBe("FAILURE");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "ACTION_REQUIRED" })).toBe("FAILURE");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "STALE" })).toBe("FAILURE");

      // Error
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "ERROR" })).toBe("ERROR");

      // Incomplete (COMPLETED with no conclusion)
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: null })).toBe("PENDING");
    });

    it("handles StatusContext states properly", () => {
      // Pending
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "ci/status", state: "PENDING" })).toBe("PENDING");
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "CodeRabbit", state: "PENDING" })).toBe("PENDING");
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "security/scan", state: "EXPECTED" })).toBe("PENDING");

      // Success
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "codecov", state: "SUCCESS" })).toBe("SUCCESS");

      // Failure and error
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "linter", state: "FAILURE" })).toBe("FAILURE");
      expect(normalizeCheckItem({ __typename: "StatusContext", context: "security", state: "ERROR" })).toBe("ERROR");
    });

    it("is conservative on unknown / unrecognized states", () => {
      expect(normalizeCheckItem({ __typename: "StatusContext", state: "SOME_NEW_STATE" })).toBe("ERROR");
      expect(normalizeCheckItem({ __typename: "CheckRun", status: "COMPLETED", conclusion: "WEIRD_CONCLUSION" })).toBe("ERROR");
      expect(normalizeCheckItem({ notEvenAProperObject: true })).toBe("ERROR");
      expect(normalizeCheckItem(null)).toBe("ERROR");
      expect(normalizeCheckItem(undefined)).toBe("ERROR");
    });
  });

  describe("normalizeRollupState", () => {
    it("returns SUCCESS for empty check list", () => {
      expect(normalizeRollupState([])).toBe("SUCCESS");
      expect(normalizeRollupState(null as any)).toBe("SUCCESS");
    });

    it("returns SUCCESS when all checks succeed", () => {
      const checks = [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
        { __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
      ];
      expect(normalizeRollupState(checks)).toBe("SUCCESS");
    });

    it("returns PENDING when CheckRun is SUCCESS but StatusContext is PENDING (the CodeRabbit bug scenario)", () => {
      const checks = [
        {
          __typename: "CheckRun",
          name: "test",
          status: "COMPLETED",
          conclusion: "SUCCESS",
        },
        {
          __typename: "StatusContext",
          context: "CodeRabbit",
          state: "PENDING",
        },
      ];
      expect(normalizeRollupState(checks)).toBe("PENDING");
    });

    it("returns PENDING when CheckRun is QUEUED or IN_PROGRESS", () => {
      const checks = [
        { __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null },
        { __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
      ];
      expect(normalizeRollupState(checks)).toBe("PENDING");
    });

    it("FAILURE has top precedence over PENDING and ERROR", () => {
      const checks = [
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }, // PENDING
        { __typename: "StatusContext", context: "audit", state: "ERROR" },    // ERROR
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }, // FAILURE
      ];
      expect(normalizeRollupState(checks)).toBe("FAILURE");
    });

    it("ERROR has precedence over PENDING", () => {
      const checks = [
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }, // PENDING
        { __typename: "StatusContext", context: "audit", state: "ERROR" },    // ERROR
      ];
      expect(normalizeRollupState(checks)).toBe("ERROR");
    });

    it("conservative fallback: unknown check states prevent SUCCESS", () => {
      const checks = [
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "MYSTERIOUS_STATUS" },
      ];
      expect(normalizeRollupState(checks)).toBe("ERROR");
    });
  });

  describe("evaluateMergeGates integration", () => {
    it("blocks PR merge when StatusContext is PENDING", () => {
      const pr: PRGateInput = {
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviews: [{ state: "APPROVED", authorAssociation: "MEMBER" }],
        unresolvedThreadCount: 0,
        statusRollupState: normalizeRollupState([
          { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "StatusContext", context: "CodeRabbit", state: "PENDING" },
        ]),
      };

      const result = evaluateMergeGates(pr);
      expect(result.canMerge).toBe(false);
      expect(result.actionRequired).toBe("WAIT_CI");
      expect(result.reason).toContain("CI checks pending");
    });

    it("permits PR merge only when all CheckRuns and StatusContexts are SUCCESS", () => {
      const pr: PRGateInput = {
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviews: [{ state: "APPROVED", authorAssociation: "MEMBER" }],
        unresolvedThreadCount: 0,
        statusRollupState: normalizeRollupState([
          { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "StatusContext", context: "CodeRabbit", state: "SUCCESS" },
        ]),
      };

      const result = evaluateMergeGates(pr);
      expect(result.canMerge).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });
});
