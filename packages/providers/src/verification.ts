import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Logger } from "@orchlet/shared";
import type { IVerificationRunner, VerificationResult } from "@orchlet/core";

const execAsync = promisify(exec);

export class VerificationRunner implements IVerificationRunner {
  private logger = new Logger({ prefix: "VerificationRunner" });

  async runVerification(commands: string[], worktreePath: string): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const cmd of commands) {
      if (!cmd || !cmd.trim()) continue;
      const cleanCmd = cmd.trim();
      this.logger.info(`Running verification: "${cleanCmd}" in: ${worktreePath}`);
      const startTime = Date.now();

      try {
        const { stdout, stderr } = await execAsync(cleanCmd, {
          cwd: worktreePath,
          timeout: 60000, // 60s timeout
          maxBuffer: 5 * 1024 * 1024,
        });

        const durationMs = Date.now() - startTime;
        results.push({
          command: cleanCmd,
          exitCode: 0,
          durationMs,
          stdoutTail: this.getTail(stdout),
          stderrTail: this.getTail(stderr),
          passed: true,
        });
        this.logger.info(`Verification passed: "${cleanCmd}" (${durationMs}ms)`);
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const exitCode = typeof err.code === "number" ? err.code : 1;
        const stdout = err.stdout || "";
        const stderr = err.stderr || err.message || "";

        results.push({
          command: cleanCmd,
          exitCode,
          durationMs,
          stdoutTail: this.getTail(stdout),
          stderrTail: this.getTail(stderr),
          passed: false,
        });
        this.logger.warn(`Verification failed: "${cleanCmd}" (exit ${exitCode})`);
      }
    }

    return results;
  }

  private getTail(text: string, maxLines = 40): string {
    if (!text) return "";
    const lines = text.split("\n");
    if (lines.length <= maxLines) return text.trim();
    return lines.slice(-maxLines).join("\n").trim();
  }
}

export const verificationRunner = new VerificationRunner();
