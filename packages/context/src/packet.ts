import { createHash } from "node:crypto";
import type {
  ContextBundle,
  ContextFile,
  IContextBuilder,
  ReviewFinding,
  TaskPacket,
} from "@orchlet/core";
import { InstructionDiscoveryEngine } from "./discovery.js";

export class ContextPacketBuilder implements IContextBuilder {
  async buildPacket(
    taskId: string,
    objective: string,
    projectRoot: string,
    audience: "implementer" | "reviewer",
    options: { planSummary?: string; blockingFindings?: ReviewFinding[] } = {},
  ): Promise<TaskPacket> {
    const discoveryEngine = new InstructionDiscoveryEngine(projectRoot);
    const discovered = await discoveryEngine.discoverForPath(projectRoot);

    const contextFiles: ContextFile[] = discovered.map((d) => ({
      filePath: d.filePath,
      relativePath: d.relativePath,
      sourceType: d.sourceType,
      content: d.content,
      sha256: d.sha256,
    }));

    // Compute composite fingerprint
    const compositeHash = createHash("sha256");
    for (const f of [...contextFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      compositeHash.update(`${f.relativePath}:${f.sha256}`);
    }
    const bundleFingerprint = compositeHash.digest("hex");

    const contextBundle: ContextBundle = {
      files: contextFiles,
      bundleFingerprint,
      audience,
    };

    return {
      taskId,
      objective,
      contextBundle,
      planSummary: audience === "implementer" ? options.planSummary : undefined,
      blockingFindings: audience === "implementer" ? options.blockingFindings : undefined,
    };
  }
}

export const contextPacketBuilder = new ContextPacketBuilder();
