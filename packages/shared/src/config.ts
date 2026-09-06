import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Logger } from "./logger.js";

export interface ModelCatalogEntry {
  provider: string;
  model: string;
  tier: "fast" | "balanced" | "strong";
  costClass?: "FREE" | "TINY" | "CHEAP" | "MODERATE" | "EXPENSIVE" | "PREMIUM" | "SUBSCRIPTION";
  strengths?: string[];
  capabilities?: string[];
  costWeight?: number;
  pricing?: {
    promptPerToken: number;
    completionPerToken: number;
  };
  contextLength?: number;
  discoveredAt?: string;
  discoverySource?: string;
}

export interface BudgetConfigData {
  mode?: "balanced" | "strict" | "permissive";
  perTaskUsd?: number;
  dailyUsd?: number;
  monthlyUsd?: number;
  warnAtPercent?: number;
  hardStopAtPercent?: number;
  roleLimits?: {
    executor?: number;
    reviewer?: number;
    repairer?: number;
    reserve?: number;
  };
}

export interface OrchletConfigData {
  routingMode?: "AUTO" | "CHEAP" | "QUALITY" | "BEST" | "MANUAL";
  budget?: BudgetConfigData;
  models?: Record<string, ModelCatalogEntry>;
  roleMappings?: Record<string, { tier?: "fast" | "balanced" | "strong"; model?: string; provider?: string }>;
  preferredModels?: string[];
  excludedModels?: string[];
  maxCostClass?: "FREE" | "TINY" | "CHEAP" | "MODERATE" | "EXPENSIVE" | "PREMIUM" | "SUBSCRIPTION";
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
  routingMode: "AUTO",
  budget: {
    mode: "balanced",
    perTaskUsd: 0.50,
    dailyUsd: 3.00,
    monthlyUsd: 30.00,
    warnAtPercent: 75,
    hardStopAtPercent: 100,
  },
  models: {
    "economy-coder": {
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      tier: "fast",
      costClass: "TINY",
      strengths: ["fast", "coding", "repair"],
      costWeight: 0.1,
      pricing: {
        promptPerToken: 0.000000075,
        completionPerToken: 0.00000025,
      },
      contextLength: 1310720,
    },
    "balanced-critic": {
      provider: "openrouter",
      model: "google/gemini-3.8-flash",
      tier: "balanced",
      costClass: "MODERATE",
      strengths: ["coding", "reasoning", "adversarial-review"],
      costWeight: 0.5,
      pricing: {
        promptPerToken: 0.00000075,
        completionPerToken: 0.00000375,
      },
      contextLength: 1048576,
    },
    "deepseek-balanced": {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      tier: "balanced",
      costClass: "CHEAP",
      strengths: ["coding", "architecture", "repair"],
      costWeight: 0.3,
      pricing: {
        promptPerToken: 0.00000014,
        completionPerToken: 0.00000028,
      },
      contextLength: 65536,
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
      budget: user.budget ? { ...base.budget, ...user.budget } : base.budget,
      models: { ...base.models, ...user.models },
      roleMappings: user.roleMappings ? { ...base.roleMappings, ...user.roleMappings } : base.roleMappings,
      git: { ...base.git, ...user.git },
      verification: user.verification && user.verification.length > 0 ? user.verification : base.verification,
      activeHarness: user.activeHarness || base.activeHarness,
    };
  }
}
