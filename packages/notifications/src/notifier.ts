import { Logger } from "@orchlet/shared";
import type { AttentionState } from "@orchlet/core";

export interface AttentionNotification {
  taskId: string;
  state: AttentionState;
  message: string;
  timestamp: string;
}

export class NotificationManager {
  private logger = new Logger({ prefix: "NotificationManager" });
  private listeners: Array<(event: AttentionNotification) => void> = [];

  notifyAttention(taskId: string, state: AttentionState, message: string): void {
    const event: AttentionNotification = {
      taskId,
      state,
      message,
      timestamp: new Date().toISOString(),
    };

    if (state === "NEEDS_ATTENTION") {
      this.logger.warn(`🚨 ATTENTION REQUIRED for task ${taskId}: ${message}`);
    } else if (state === "SETTLED") {
      this.logger.info(`✅ Task ${taskId} SETTLED: ${message}`);
    } else {
      this.logger.info(`Task ${taskId} state: [${state}] ${message}`);
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.logger.error("Error in notification listener", err);
      }
    }
  }

  subscribe(listener: (event: AttentionNotification) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

export const notificationManager = new NotificationManager();
