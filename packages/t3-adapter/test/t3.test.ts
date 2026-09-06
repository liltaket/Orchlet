import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { T3Client } from "../src/client.js";

describe("T3Client", () => {
  let client: T3Client;

  beforeEach(() => {
    client = new T3Client();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles absent runtime gracefully when baseUrl is null", async () => {
    vi.spyOn(client, "discoverRuntime").mockResolvedValue(null);
    client.setBaseUrl(null);
    const health = await client.checkHealth();
    expect(health.ok).toBe(false);
  });

  it("dispatches turn when runtime is mock-configured", async () => {
    // Mock fetch for environment and dispatch
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      if (typeof url === "string" && url.includes("/.well-known/t3/environment")) {
        return {
          ok: true,
          json: async () => ({ serverVersion: "0.1.0" }),
        } as any;
      }
      if (typeof url === "string" && url.includes("/api/orchestration/dispatch")) {
        return {
          ok: true,
          json: async () => ({ success: true }),
        } as any;
      }
      return { ok: false } as any;
    });

    client.setBaseUrl("http://127.0.0.1:9999");

    const health = await client.checkHealth();
    expect(health.ok).toBe(true);
    expect(health.version).toBe("0.1.0");

    const res = await client.dispatchTurn("thread-123", "Run test orchestration", "test-token");
    expect(res.ok).toBe(true);
    expect(res.commandId).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
