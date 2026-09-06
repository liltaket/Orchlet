import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "@orchlet/shared";
import type { AgentRequest, AgentResult, ExecutorCapabilities, IAgentExecutor } from "@orchlet/core";

export class OpenCodeHarness implements IAgentExecutor {
  readonly harnessName = "opencode";
  readonly capabilities: ExecutorCapabilities = {
    roles: ["executor", "repairer", "planner"],
    filesystem: true,
    shell: true,
    structuredOutput: true,
    streaming: true,
    modelSelection: true,
    providerSelection: true,
    isMock: false,
  };

  private logger = new Logger({ prefix: "OpenCodeHarness" });

  private async resolveOpenCodeBinary(): Promise<string> {
    if (process.platform === "win32") {
      const appData = process.env.APPDATA;
      if (appData) {
        const directExe = path.join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
        try {
          await fs.access(directExe);
          return directExe;
        } catch {
          // Continue fallback
        }
      }
      try {
        const whereCp = spawn("where.exe", ["opencode.exe"], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        for await (const chunk of whereCp.stdout) out += chunk;
        const first = out.trim().split(/\r?\n/)[0]?.trim();
        if (first) return first;
      } catch {
        // Continue fallback
      }
      try {
        const whereCp = spawn("where.exe", ["opencode"], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        for await (const chunk of whereCp.stdout) out += chunk;
        const lines = out.trim().split(/\r?\n/).map((l) => l.trim());
        const exe = lines.find((l) => l.endsWith(".exe"));
        if (exe) return exe;
      } catch {
        // Continue fallback
      }
      return "opencode.cmd";
    }
    return "opencode";
  }

  async execute(request: AgentRequest): Promise<AgentResult> {
    const startTime = Date.now();
    const modelArg = `${request.selectedModel.providerId}/${request.selectedModel.modelId}`;

    this.logger.info(
      `Executing task ${request.taskId} [role=${request.role}] via OpenCode on model: ${modelArg} in: ${request.worktreePath}`
    );

    // Ensure isolated worktree config permits necessary tools without interactive blocking
    try {
      const opencodeDir = path.join(request.worktreePath, ".opencode");
      await fs.mkdir(opencodeDir, { recursive: true });
      await fs.writeFile(
        path.join(opencodeDir, "config.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            permission: {
              bash: "allow",
              edit: "allow",
              read: "allow",
              todowrite: "allow",
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch {
      // Ignore worktree config setup errors
    }

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
      `\nPlease implement the requested modifications directly in the codebase now using file edit tools. Ensure all code compiles and adheres to instructions. Orchlet will run the automated verification suite upon completion.`
    );

    const fullPrompt = promptParts.join("\n\n");

    const args = [
      "run",
      "--dir",
      request.worktreePath,
      "-m",
      modelArg,
      "--auto", // Auto-approve permissions in isolated worktree
      "--format",
      "json",
      fullPrompt,
    ];

    try {
      const binName = await this.resolveOpenCodeBinary();
      const isCmd = binName.endsWith(".cmd") || binName.endsWith(".bat");

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        const cp = spawn(binName, args, {
          cwd: request.worktreePath,
          shell: isCmd,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          cp.kill();
          reject(new Error(`OpenCode execution timed out after 180000ms`));
        }, 180000);

        cp.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
        cp.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));

        cp.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        cp.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
          } else {
            const stderrStr = Buffer.concat(stderrChunks).toString("utf-8");
            reject(new Error(`OpenCode exited with code ${code}: ${stderrStr}`));
          }
        });
      });

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const durationMs = Date.now() - startTime;

      // Clean up temporary .opencode config in worktree so it doesn't pollute git commit
      await fs.rm(path.join(request.worktreePath, ".opencode"), { recursive: true, force: true }).catch(() => {});

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
      this.logger.error(`OpenCode execution failed for task ${request.taskId}:`, err);
      // Clean up temporary .opencode config in worktree
      await fs.rm(path.join(request.worktreePath, ".opencode"), { recursive: true, force: true }).catch(() => {});
      return {
        success: false,
        changedFiles: [],
        error: err.message || "Unknown OpenCode execution error",
        modelUsed: request.selectedModel.modelId,
        providerUsed: request.selectedModel.providerId,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async getChangedFiles(worktreePath: string): Promise<string[]> {
    try {
      const gitCp = spawn("git", ["status", "--porcelain"], {
        cwd: worktreePath,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      for await (const chunk of gitCp.stdout) stdout += chunk;
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.slice(3).trim());
    } catch {
      return [];
    }
  }
}

export const openCodeHarness = new OpenCodeHarness();
