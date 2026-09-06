import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "@orchlet/shared";

export interface DiscoveredInstruction {
  filePath: string;
  frontmatter: Record<string, string>;
  content: string;
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

    while (currentDir === resolvedRoot || currentDir.startsWith(normalizedRootWithSep)) {
      for (const filename of ["AGENTS.md", "ORCHLET.md", "CLAUDE.md"]) {
        const candidate = path.join(currentDir, filename);
        if (!this.loadedPaths.has(candidate)) {
          try {
            const raw = await fs.readFile(candidate, "utf-8");
            const parsed = this.parseInstructionFile(raw, candidate);
            this.loadedPaths.add(candidate);
            discovered.push(parsed);
            this.logger.debug(`Loaded context instructions from: ${candidate}`);
          } catch {
            // File does not exist, ignore
          }
        }
      }
      if (currentDir === resolvedRoot) break;
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break; // Reached root of drive
      currentDir = parent;
    }

    // Return nearest-first (closest directory to target file takes precedence)
    return discovered;
  }

  private parseInstructionFile(raw: string, filePath: string): DiscoveredInstruction {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = frontmatterRegex.exec(raw);
    if (!match) {
      return { filePath, frontmatter: {}, content: raw.trim() };
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
      frontmatter,
      content: match[2].trim(),
    };
  }
}
