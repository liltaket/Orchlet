import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ContextPacketBuilder } from "../src/packet.js";
import type { ReviewFinding } from "@orchlet/core";

describe("ContextPacketBuilder Audience Separation", () => {
  let tmpDir: string;
  const builder = new ContextPacketBuilder();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-packet-test-"));
    await fs.writeFile(path.join(tmpDir, "AGENTS.md"), "# Project Instructions\nAlways write tests.");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("provides plan summary and blocking findings to implementer", async () => {
    const findings: ReviewFinding[] = [
      {
        severity: "P0",
        title: "Missing bounds check",
        description: "Value can exceed range",
        filePath: "src/index.ts",
      },
    ];

    const packet = await builder.buildPacket(
      "task-123",
      "Implement feature",
      tmpDir,
      "implementer",
      { planSummary: "1. Update code 2. Run tests", blockingFindings: findings },
    );

    expect(packet.contextBundle.audience).toBe("implementer");
    expect(packet.planSummary).toBe("1. Update code 2. Run tests");
    expect(packet.blockingFindings).toEqual(findings);
    expect(packet.contextBundle.files.length).toBeGreaterThan(0);
  });

  it("strictly omits plan summary and previous reviewer findings from reviewer packet", async () => {
    const findings: ReviewFinding[] = [
      {
        severity: "P0",
        title: "Missing bounds check",
        description: "Value can exceed range",
        filePath: "src/index.ts",
      },
    ];

    const packet = await builder.buildPacket(
      "task-123",
      "Implement feature",
      tmpDir,
      "reviewer",
      { planSummary: "1. Update code 2. Run tests", blockingFindings: findings },
    );

    expect(packet.contextBundle.audience).toBe("reviewer");
    // Reviewer must evaluate diff independently without implementer plan or anchor bias
    expect(packet.planSummary).toBeUndefined();
    expect(packet.blockingFindings).toBeUndefined();
    expect(packet.contextBundle.files.length).toBeGreaterThan(0);
  });
});
