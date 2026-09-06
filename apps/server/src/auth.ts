import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { Logger } from "@orchlet/shared";

export class AuthManager {
  private static token: string | null = null;
  private static wsTickets = new Map<string, number>(); // ticket -> expiresAt timestamp
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

  /**
   * Issue a short-lived (60s), single-use WebSocket ticket for browser authentication.
   * Avoids exposing bearer tokens in URLs or browser histories.
   */
  static createWsTicket(validityMs = 60_000): string {
    // Purge expired tickets
    const now = Date.now();
    for (const [ticket, expiresAt] of this.wsTickets.entries()) {
      if (now > expiresAt) {
        this.wsTickets.delete(ticket);
      }
    }

    const ticket = `wst_${randomBytes(16).toString("hex")}`;
    this.wsTickets.set(ticket, now + validityMs);
    return ticket;
  }

  /**
   * Validates and consumes a single-use WebSocket ticket.
   */
  static validateAndConsumeWsTicket(ticket?: string | null): boolean {
    if (!ticket) return false;
    const expiresAt = this.wsTickets.get(ticket.trim());
    if (!expiresAt) return false;

    // Immediately consume ticket (one-time use)
    this.wsTickets.delete(ticket.trim());

    return Date.now() <= expiresAt;
  }
}
