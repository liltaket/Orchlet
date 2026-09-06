import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { Logger, OrchletError } from "@orchlet/shared";
import type { AgentRequest, AgentResult, IAgentExecutor } from "@orchlet/core";

const execFileAsync = promisify(execFile);

export class OpenCodeHarness implements IAgentExecutor {
  readonly harnessName = "opencode";
  private logger = new Logger({ prefix: "OpenCodeHarness" });

  async execute(request: AgentRequest): Promise<AgentResult> {
    const startTime = Date.now();
    const modelArg = `${request.selectedModel.providerId}/${request.selectedModel.modelId}`;

    this.logger.info(
      `Executing task ${request.taskId} [role=${request.role}] via OpenCode on model: ${modelArg} in: ${request.worktreePath}`
    );

    // Build execution prompt incorporating objective, context files, instructions
    const promptParts: string[] = [
      `# TASK OBJECTIVE\n${request.userObjective}`,
    ];

    if (request.taskPacket.planSummary) {
      promptParts.push(`\n# PLAN\n${request.taskPacket.planSummary}`);
    }

    if (request.taskPacket.blockingFindings && request.taskPacket.blockingFindings.length > 0) {
      promptParts.push(
        `\n# BLOCKING FINDINGS TO REPAIR (P0/P1)\n` +
          request.taskPacket.blockingFindings
            .map((f) => `- [${f.severity}] ${f.title} in ${f.filePath}:\n  ${f.description}\n  Suggested fix: ${f.suggestedFix || "N/A"}`)
            .join("\n")
      );
    }

    if (request.taskPacket.contextBundle.files.length > 0) {
      promptParts.push("\n# REPOSITORY INSTRUCTIONS");
      for (const cf of request.taskPacket.contextBundle.files) {
        promptParts.push(`\n## From ${cf.relativePath}:\n${cf.content}`);
      }
    }

    promptParts.push(
      `\nPlease implement the requested modifications directly in the codebase now. Ensure all code compiles, adheres to instructions, and passes tests.`
    );

    const fullPrompt = promptParts.join("\n\n");

    const args = [
      "run",
      fullPrompt,
      "--dir",
      request.worktreePath,
      "-m",
      modelArg,
      "--auto", // Auto-approve permissions in isolated worktree
      "--format",
      "json",
    ];

    try {
      // Execute opencode run
      const { stdout, stderr } = await execFileAsync("opencode", args, {
        cwd: request.worktreePath,
        timeout: 180000, // 3 minutes timeout
        maxBuffer: 10 * 1024 * 1024,
      });

      const durationMs = Date.now() - startTime;

      // Extract modified files via git status inside worktree
      const changedFiles = await this.getChangedFiles(request.worktreePath);

      // Parse JSON lines from stdout if possible
      let totalTokens = 0;
      for (const line of stdout.split("\n")) {
        try {
          const parsed = JSON.parse(line.trim());
          if (parsed.tokens || parsed.usage) {
            totalTokens += (parsed.tokens?.total || parsed.usage?.total_tokens || 0);
          }
        } catch {
          // Non-JSON log line
        }
      }

      this.logger.info(
        `OpenCode completed for role=${request.role} in ${durationMs}ms (changed ${changedFiles.length} file(s))`
      );

      return {
        success: true,
        textResponse: stdout,
        changedFiles,
        usage: {
          totalTokens: totalTokens > 0 ? totalTokens : undefined,
        },
        modelUsed: request.selectedModel.modelId,
        providerUsed: request.selectedModel.providerId,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      this.logger.error(`OpenCode execution failed: ${err.message}`);
      return {
        success: false,
        changedFiles: [],
        modelUsed: request.selectedModel.modelId,
        providerUsed: request.selectedModel.providerId,
        durationMs,
        error: err.message,
      };
    }
  }

  private async getChangedFiles(worktreePath: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
        cwd: worktreePath,
      });
      return stdout
        .split("\n")
        .map((l) => l.trim().slice(3).trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

export const openCodeHarness = new OpenCodeHarness();
