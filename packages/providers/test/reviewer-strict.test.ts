import { describe, it, expect } from "vitest";
import {
  IndependentReviewer,
  ReviewerProviderRegistry,
  type IReviewerProvider,
} from "../src/index.js";

describe("IndependentReviewer Strict Semantics & Fail-Closed Guardrails", () => {
  it("REAL mode FAILS CLOSED when AI reviewer fails, refusing silent static fallback", async () => {
    // Mock provider that fails (e.g. 500 error or rate limit)
    const failingProvider: IReviewerProvider = {
      providerId: "openrouter",
      completeReview: async () => {
        throw new Error("503 Service Unavailable: Rate limited / Out of credits");
      },
    };

    const registry = new ReviewerProviderRegistry();
    registry.register(failingProvider);

    const reviewer = new IndependentReviewer({
      registry,
      allowStaticFallback: false,
    });

    await expect(
      reviewer.reviewDiff("diff --git a/test.ts b/test.ts\n+const x = 1;", "add x", [], undefined, {
        executionMode: "REAL",
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
      }),
    ).rejects.toThrow(/AI review failed in REAL mode/);
  });

  it("Static fallback is permitted ONLY when explicitly configured, and audit identities are truthful", async () => {
    const failingProvider: IReviewerProvider = {
      providerId: "openrouter",
      completeReview: async () => {
        throw new Error("Provider timeout");
      },
    };

    const registry = new ReviewerProviderRegistry();
    registry.register(failingProvider);

    const reviewer = new IndependentReviewer({
      registry,
      allowStaticFallback: false, // Default false
    });

    // Explicitly pass allowStaticFallback: true
    const verdict = await reviewer.reviewDiff(
      "diff --git a/test.ts b/test.ts\n+const x = 1;",
      "add x",
      [],
      undefined,
      {
        executionMode: "REAL",
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        allowStaticFallback: true,
      },
    );

    expect(verdict.verdict).toBe("APPROVED");
    // CRITICAL: Must NOT claim google/gemini-2.5-flash executed!
    expect(verdict.reviewerModel).toBe("offline-safety-reviewer");
    expect(verdict.providerUsed).toBe("local");
    expect(verdict.actualProvider).toBe("local");
    expect(verdict.actualModel).toBe("offline-safety-reviewer");
    expect(verdict.requestedProvider).toBe("openrouter");
    expect(verdict.requestedModel).toBe("google/gemini-2.5-flash");
    expect(verdict.fallbackReason).toContain("AI review failed: Provider timeout");
    expect(verdict.tokensUsed?.total).toBe(0);
  });

  it("Unsupported reviewer providers fail explicitly with UNSUPPORTED_REVIEW_PROVIDER", async () => {
    const reviewer = new IndependentReviewer();

    await expect(
      reviewer.reviewDiff("diff --git a/test.ts b/test.ts\n+const x = 1;", "add x", [], undefined, {
        executionMode: "REAL",
        provider: "google-direct",
        model: "gemini-2.5-pro",
      }),
    ).rejects.toThrow(/Unsupported reviewer provider 'google-direct'/);

    await expect(
      reviewer.reviewDiff("diff --git a/test.ts b/test.ts\n+const x = 1;", "add x", [], undefined, {
        executionMode: "REAL",
        provider: "codex",
        model: "codex-mini",
      }),
    ).rejects.toThrow(/Unsupported reviewer provider 'codex'/);
  });

  it("Successful AI review records exact actual provider and actual model from response", async () => {
    const mockSuccessProvider: IReviewerProvider = {
      providerId: "openrouter",
      completeReview: async (req) => ({
        text: JSON.stringify({
          verdict: "APPROVED",
          findings: [],
          summary: "All requirements met flawlessly.",
        }),
        model: "google/gemini-2.5-flash-001", // Actual model returned by OpenRouter
        tokensUsed: { prompt: 150, completion: 45, total: 195 },
        costEstimate: 0.0002,
      }),
    };

    const registry = new ReviewerProviderRegistry();
    registry.register(mockSuccessProvider);

    const reviewer = new IndependentReviewer({ registry });

    const verdict = await reviewer.reviewDiff(
      "diff --git a/test.ts b/test.ts\n+const x = 1;",
      "add x",
      [],
      undefined,
      {
        executionMode: "REAL",
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
      },
    );

    expect(verdict.verdict).toBe("APPROVED");
    expect(verdict.requestedProvider).toBe("openrouter");
    expect(verdict.requestedModel).toBe("google/gemini-2.5-flash");
    expect(verdict.actualProvider).toBe("openrouter");
    expect(verdict.actualModel).toBe("google/gemini-2.5-flash-001");
    expect(verdict.tokensUsed?.total).toBe(195);
    expect(verdict.costEstimate).toBe(0.0002);
  });
});
