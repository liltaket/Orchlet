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
    const resolvedTarget = path.resolve(targetFilePath);
    let currentDir = resolvedTarget;
    try {
      const stat = await fs.stat(resolvedTarget);
      if (!stat.isDirectory()) {
        currentDir = path.dirname(resolvedTarget);
      }
    } catch {
      currentDir = path.dirname(resolvedTarget);
    }

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

      // Check agent skills folders (e.g. .agents/skills/*/SKILL.md)
      await this.discoverSkillsIn(currentDir, discovered);

      if (currentDir === resolvedRoot) {
        break; // Reached project root
      }
      currentDir = path.dirname(currentDir);
    }

    return discovered;
  }

  private async discoverSkillsIn(dir: string, discovered: DiscoveredInstruction[]): Promise<void> {
    const skillFolders = [".agents/skills", ".claude/skills", ".orchlet/skills"];
    for (const sub of skillFolders) {
      const skillsPath = path.join(dir, sub);
      try {
        const entries = await fs.readdir(skillsPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFile = path.join(skillsPath, entry.name, "SKILL.md");
            if (!this.loadedPaths.has(skillFile)) {
              try {
                const raw = await fs.readFile(skillFile, "utf-8");
                const sha256 = createHash("sha256").update(raw).digest("hex");
                const relativePath = path.relative(this.projectRoot, skillFile);
                discovered.push(this.parseInstructionFile(raw, skillFile, relativePath, "OTHER", sha256));
                this.loadedPaths.add(skillFile);
              } catch {
                // No SKILL.md
              }
            }
          }
        }
      } catch {
        // Skill dir does not exist
      }
    }
  }

  private parseInstructionFile(
    content: string,
    filePath: string,
    relativePath: string,
    sourceType: DiscoveredInstruction["sourceType"],
    sha256: string,
  ): DiscoveredInstruction {
    const frontmatter: Record<string, string> = {};
    let cleanContent = content;

    if (content.startsWith("---")) {
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (match) {
        cleanContent = match[2].trim();
        const lines = match[1].split(/\r?\n/);
        for (const line of lines) {
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim();
            frontmatter[key] = val;
          }
        }
      }
    }

    return {
      filePath,
      relativePath,
      sourceType,
      frontmatter,
      content: cleanContent,
      sha256,
    };
  }
}
