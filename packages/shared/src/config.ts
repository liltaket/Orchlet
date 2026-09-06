import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Logger } from "./logger.js";

export interface ModelCatalogEntry {
  provider: string;
  model: string;
  tier: "fast" | "balanced" | "strong";
  strengths?: string[];
  costWeight?: number;
}

export interface OrchletConfigData {
  models?: Record<string, ModelCatalogEntry>;
  roleMappings?: Record<string, { tier?: "fast" | "balanced" | "strong"; model?: string; provider?: string }>;
  git?: {
    push?: boolean;
    openPr?: boolean;
    autoMerge?: boolean;
    baseBranch?: string;
  };
  verification?: string[];
  activeHarness?: "opencode" | "openrouter" | "mock";
}

const DEFAULT_CONFIG: OrchletConfigData = {
  models: {
    "deepseek-fast": {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      tier: "fast",
      strengths: ["fast", "coding", "low-cost"],
      costWeight: 0.2,
    },
    "gemini-flash": {
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      tier: "fast",
      strengths: ["fast", "context"],
      costWeight: 0.3,
    },
    "deepseek-balanced": {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      tier: "balanced",
      strengths: ["coding", "architecture", "repair"],
      costWeight: 0.5,
    },
    "gemini-pro": {
      provider: "openrouter",
      model: "google/gemini-2.5-pro",
      tier: "strong",
      strengths: ["reasoning", "adversarial-review", "complex-refactor"],
      costWeight: 2.0,
    },
  },
  git: {
    push: false,
    openPr: false,
    autoMerge: false,
    baseBranch: "main",
  },
  verification: [],
  activeHarness: "opencode",
};

export class ConfigManager {
  private static logger = new Logger({ prefix: "ConfigManager" });

  static async loadConfig(projectRoot?: string): Promise<OrchletConfigData> {
    const candidatePaths: string[] = [];

    if (projectRoot) {
      candidatePaths.push(path.join(projectRoot, "orchlet.config.json"));
      candidatePaths.push(path.join(projectRoot, ".orchlet.json"));
      candidatePaths.push(path.join(projectRoot, ".orchlet", "config.json"));
    }

    const homeConfig = path.join(os.homedir(), ".orchlet", "config.json");
    candidatePaths.push(homeConfig);

    for (const p of candidatePaths) {
      try {
        const raw = await fs.readFile(p, "utf-8");
        const parsed = JSON.parse(raw) as OrchletConfigData;
        this.logger.debug(`Loaded user configuration from: ${p}`);
        return this.mergeConfig(DEFAULT_CONFIG, parsed);
      } catch {
        // File does not exist or unreadable, continue search
      }
    }

    return DEFAULT_CONFIG;
  }

  private static mergeConfig(base: OrchletConfigData, user: OrchletConfigData): OrchletConfigData {
    return {
      ...base,
      ...user,
      models: { ...base.models, ...user.models },
      git: { ...base.git, ...user.git },
      verification: user.verification && user.verification.length > 0 ? user.verification : base.verification,
      activeHarness: user.activeHarness || base.activeHarness,
    };
  }
}
