import { Logger } from "@orchlet/shared";
import {
  type HealthState,
  type UsageSnapshot,
  calculateHealthState,
} from "./types.js";

export class UsageManager {
  private snapshots = new Map<string, UsageSnapshot>();
  private listeners: Array<(snapshot: UsageSnapshot) => void> = [];
  private logger = new Logger({ prefix: "UsageManager" });

  registerProvider(snapshot: UsageSnapshot): void {
    this.snapshots.set(snapshot.providerId, snapshot);
    this.logger.debug(`Registered provider usage for ${snapshot.providerId}: health=${snapshot.healthState}`);
    this.notify(snapshot);
  }

  getSnapshot(providerId: string): UsageSnapshot | undefined {
    return this.snapshots.get(providerId);
  }

  getAllSnapshots(): UsageSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  updateWindows(providerId: string, windows: UsageSnapshot["windows"], isThrottled = false): UsageSnapshot {
    const existing = this.snapshots.get(providerId);
    const healthState = calculateHealthState(windows, isThrottled);
    const updated: UsageSnapshot = {
      providerId,
      providerType: existing?.providerType || "custom",
      healthState,
      windows,
      updatedAt: new Date().toISOString(),
    };

    this.snapshots.set(providerId, updated);
    if (existing?.healthState !== healthState) {
      this.logger.info(`Provider ${providerId} transitioned: ${existing?.healthState ?? "none"} -> ${healthState}`);
    }
    this.notify(updated);
    return updated;
  }

  isProviderHealthy(providerId: string): boolean {
    const snap = this.snapshots.get(providerId);
    if (!snap) return true; // Optimistic default
    return snap.healthState !== "exhausted" && snap.healthState !== "critical";
  }

  subscribe(listener: (snapshot: UsageSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(snapshot: UsageSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        this.logger.error("Error in usage subscription listener", err);
      }
    }
  }
}

export const usageManager = new UsageManager();
