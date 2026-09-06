import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Logger } from "@orchlet/shared";
import type { BudgetConfig } from "@orchlet/core";

export interface RollingSpendData {
  lastUpdated: string;
  daily: Record<string, number>; // "YYYY-MM-DD": totalCostUsd
  monthly: Record<string, number>; // "YYYY-MM": totalCostUsd
}

export class BudgetTracker {
  private filePath: string;
  private logger = new Logger({ prefix: "BudgetTracker" });
  private memoryData: RollingSpendData = {
    lastUpdated: new Date().toISOString(),
    daily: {},
    monthly: {},
  };
  private isLoaded = false;

  constructor(options: { filePath?: string } = {}) {
    this.filePath = options.filePath || path.join(os.homedir(), ".orchlet", "budget-spend.json");
  }

  private getDateKeys(): { dayKey: string; monthKey: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return {
      dayKey: `${year}-${month}-${day}`,
      monthKey: `${year}-${month}`,
    };
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: RollingSpendData = JSON.parse(raw);
      this.memoryData = {
        lastUpdated: parsed.lastUpdated || new Date().toISOString(),
        daily: parsed.daily || {},
        monthly: parsed.monthly || {},
      };
      this.isLoaded = true;
      this.logger.debug("Loaded rolling budget spend data from disk.");
    } catch {
      // File doesn't exist yet; initialize empty
      this.isLoaded = true;
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      this.memoryData.lastUpdated = new Date().toISOString();
      await fs.writeFile(this.filePath, JSON.stringify(this.memoryData, null, 2), "utf-8");
    } catch (err: any) {
      this.logger.warn(`Failed to persist budget spend data: ${err.message}`);
    }
  }

  async recordSpend(costUsd: number): Promise<void> {
    if (!costUsd || costUsd <= 0 || !Number.isFinite(costUsd)) {
      return;
    }
    await this.load();
    const { dayKey, monthKey } = this.getDateKeys();

    this.memoryData.daily[dayKey] = (this.memoryData.daily[dayKey] || 0) + costUsd;
    this.memoryData.monthly[monthKey] = (this.memoryData.monthly[monthKey] || 0) + costUsd;

    await this.save();
    this.logger.debug(
      `Recorded spend $${costUsd.toFixed(5)}. Today: $${(this.memoryData.daily[dayKey] || 0).toFixed(4)}, This Month: $${(this.memoryData.monthly[monthKey] || 0).toFixed(4)}`
    );
  }

  getTodaySpend(): number {
    const { dayKey } = this.getDateKeys();
    return this.memoryData.daily[dayKey] || 0;
  }

  getCurrentMonthSpend(): number {
    const { monthKey } = this.getDateKeys();
    return this.memoryData.monthly[monthKey] || 0;
  }

  checkBudgetLimits(budget?: BudgetConfig): { allowed: boolean; reason?: string } {
    if (!budget) return { allowed: true };

    const hardStopPercent = budget.hardStopAtPercent ?? 100;
    const threshold = hardStopPercent / 100;

    // Check daily limit
    if (budget.dailyUsd !== undefined && budget.dailyUsd > 0) {
      const today = this.getTodaySpend();
      const dailyCap = budget.dailyUsd * threshold;
      if (today >= dailyCap) {
        return {
          allowed: false,
          reason: `Daily budget cap ($${budget.dailyUsd.toFixed(2)}) reached. Today's spend: $${today.toFixed(4)}.`,
        };
      }
    }

    // Check monthly limit
    if (budget.monthlyUsd !== undefined && budget.monthlyUsd > 0) {
      const month = this.getCurrentMonthSpend();
      const monthlyCap = budget.monthlyUsd * threshold;
      if (month >= monthlyCap) {
        return {
          allowed: false,
          reason: `Monthly budget cap ($${budget.monthlyUsd.toFixed(2)}) reached. Month spend: $${month.toFixed(4)}.`,
        };
      }
    }

    return { allowed: true };
  }

  getSpendSummary(): { todayUsd: number; monthUsd: number; lastUpdated: string } {
    return {
      todayUsd: this.getTodaySpend(),
      monthUsd: this.getCurrentMonthSpend(),
      lastUpdated: this.memoryData.lastUpdated,
    };
  }
}

export const budgetTracker = new BudgetTracker();
