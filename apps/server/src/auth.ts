import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { Logger } from "@orchlet/shared";

export class AuthManager {
  private static token: string | null = null;
  private static logger = new Logger({ prefix: "AuthManager" });

  static async getOrCreateToken(): Promise<string> {
    if (this.token) return this.token;

    if (process.env.ORCHLET_AUTH_TOKEN) {
      this.token = process.env.ORCHLET_AUTH_TOKEN;
      return this.token;
    }

    const orchletDir = path.join(os.homedir(), ".orchlet");
    const tokenPath = path.join(orchletDir, "auth-token");

    try {
      await fs.mkdir(orchletDir, { recursive: true });
      const existing = await fs.readFile(tokenPath, "utf-8");
      if (existing && existing.trim().length >= 16) {
        this.token = existing.trim();
        return this.token;
      }
    } catch {
      // File does not exist yet
    }

    const newToken = `orch_${randomBytes(24).toString("hex")}`;
    try {
      await fs.writeFile(tokenPath, newToken, { mode: 0o600 });
      this.logger.info(`Generated local auth token at: ${tokenPath}`);
    } catch (err: any) {
      this.logger.warn(`Could not persist auth token to ~/.orchlet: ${err.message}`);
    }

    this.token = newToken;
    return this.token;
  }

  static validateToken(provided?: string | null): boolean {
    if (!this.token || !provided) return false;
    return this.token === provided.trim();
  }
}
