import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Logger } from "@orchlet/shared";

export interface T3RuntimeConfig {
  pid: number;
  port: number;
  host: string;
  protocol: string;
}

export class T3Client {
  private logger = new Logger({ prefix: "T3Client" });
  private baseUrl: string | null = null;

  async discoverRuntime(): Promise<T3RuntimeConfig | null> {
    try {
      const runtimePath = path.join(os.homedir(), ".t3", "userdata", "server-runtime.json");
      const content = await fs.readFile(runtimePath, "utf-8");
      const config: T3RuntimeConfig = JSON.parse(content);
      this.baseUrl = `${config.protocol}://${config.host}:${config.port}`;
      this.logger.info(`Discovered live T3 server at: ${this.baseUrl} (pid: ${config.pid})`);
      return config;
    } catch {
      this.logger.debug("No local T3 server runtime detected");
      return null;
    }
  }

  async checkHealth(): Promise<{ ok: boolean; version?: string }> {
    if (!this.baseUrl) {
      await this.discoverRuntime();
    }
    if (!this.baseUrl) return { ok: false };

    try {
      const res = await fetch(`${this.baseUrl}/.well-known/t3/environment`);
      if (res.ok) {
        const data = await res.json() as any;
        return { ok: true, version: data.serverVersion };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  }

  async dispatchTurn(threadId: string, text: string, bearerToken?: string): Promise<{ ok: boolean; commandId?: string }> {
    if (!this.baseUrl) {
      await this.discoverRuntime();
    }
    if (!this.baseUrl) {
      return { ok: false };
    }

    const commandId = `cmd_${Date.now()}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (bearerToken) {
      headers["Authorization"] = `Bearer ${bearerToken}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/orchestration/dispatch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "thread.turn.start",
          commandId,
          threadId,
          message: {
            messageId: `msg_${Date.now()}`,
            role: "user",
            text,
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      });

      return { ok: res.ok, commandId };
    } catch (err: any) {
      this.logger.warn(`T3 turn dispatch failed: ${err.message}`);
      return { ok: false };
    }
  }
}

export const t3Client = new T3Client();
