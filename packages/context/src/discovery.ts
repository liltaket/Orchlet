import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Logger } from "@orchlet/shared";
import type { ContextFile } from "@orchlet/core";

export interface DiscoveredInstruction {
  filePath: string;
  relativePath: string;
  sourceType: "AGENTS" | "CLAUDE" | "GEMINI" | "COPILOT" | "ORCHLET" | "OTHER";
  frontmatter: Record<string, string>;
  content: string;
  sha256: string;
}

export class InstructionDiscoveryEngine {
  private loadedPaths = new Set<string>();
  private logger = new Logger({ prefix: "InstructionDiscovery" });

  constructor(private readonly projectRoot: string) {}

  async discoverForPath(targetFilePath: string): Promise<DiscoveredInstruction[]> {
    const discovered: DiscoveredInstruction[] = [];
    let currentDir = path.dirname(path.resolve(targetFilePath));
    const resolvedRoot = path.resolve(this.projectRoot);
    const normalizedRootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

    // Candidates in current directories
    const candidates = [
      { name: "AGENTS.md", type: "AGENTS" as const },
      { name: "ORCHLET.md", type: "ORCHLET" as const },
      { name: "CLAUDE.md", type: "CLAUDE" as const },
      { name: "GEMINI.md", type: "GEMINI" as const },
    ];

    while (currentDir === resolvedRoot || currentDir.startsWith(normalizedRootWithSep)) {
      for (const item of candidates) {
        const candidatePath = path.join(currentDir, item.name);
        if (!this.loadedPaths.has(candidatePath)) {
          try {
            const raw = await fs.readFile(candidatePath, "utf-8");
            const sha256 = createHash("sha256").update(raw).digest("hex");
            const relativePath = path.relative(this.projectRoot, candidatePath);
            const parsed = this.parseInstructionFile(raw, candidatePath, relativePath, item.type, sha256);
            this.loadedPaths.add(candidatePath);
            discovered.push(parsed);
            this.logger.debug(`Loaded context instructions from: ${candidatePath}`);
          } catch {
            // File does not exist, continue
          }
        }
      }
      if (currentDir === resolvedRoot) break;
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break; // Reached root
      currentDir = parent;
    }

    // Check .github/copilot-instructions.md at repo root
    const copilotPath = path.join(resolvedRoot, ".github", "copilot-instructions.md");
    if (!this.loadedPaths.has(copilotPath)) {
      try {
        const raw = await fs.readFile(copilotPath, "utf-8");
        const sha256 = createHash("sha256").update(raw).digest("hex");
        const relativePath = path.relative(this.projectRoot, copilotPath);
        const parsed = this.parseInstructionFile(raw, copilotPath, relativePath, "COPILOT", sha256);
        this.loadedPaths.add(copilotPath);
        discovered.push(parsed);
        this.logger.debug(`Loaded context instructions from: ${copilotPath}`);
      } catch {
        // Not present
      }
    }

    return discovered;
  }

  private parseInstructionFile(
    raw: string,
    filePath: string,
    relativePath: string,
    sourceType: "AGENTS" | "CLAUDE" | "GEMINI" | "COPILOT" | "ORCHLET" | "OTHER",
    sha256: string,
  ): DiscoveredInstruction {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = frontmatterRegex.exec(raw);
    if (!match) {
      return {
        filePath,
        relativePath,
        sourceType,
        frontmatter: {},
        content: raw.trim(),
        sha256,
      };
    }

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        frontmatter[k] = v.replace(/^["']|["']$/g, "");
      }
    }

    return {
      filePath,
      relativePath,
      sourceType,
      frontmatter,
      content: match[2].trim(),
      sha256,
    };
  }
}
