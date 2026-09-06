import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Logger, OrchletError } from "@orchlet/shared";
import type { IWorktreeManager } from "@orchlet/core";

const execFileAsync = promisify(execFile);

export class WorktreeManager implements IWorktreeManager {
  private logger = new Logger({ prefix: "WorktreeManager" });

  async createWorktree(
    repoPath: string,
    taskId: string,
    baseBranch = "main",
  ): Promise<{ worktreePath: string; branchName: string }> {
    const branchName = `orchlet/task-${taskId}`;
    const worktreesBase = path.join(repoPath, ".orchlet", "worktrees");
    const worktreePath = path.join(worktreesBase, `task-${taskId}`);

    await fs.mkdir(worktreesBase, { recursive: true });

    this.logger.info(`Creating isolated Git worktree at: ${worktreePath} on branch: ${branchName}`);
    try {
      await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreePath, baseBranch], {
        cwd: repoPath,
      });
    } catch (err: any) {
      // If branch already exists, checkout existing
      if (err.message?.includes("already exists")) {
        await execFileAsync("git", ["worktree", "add", worktreePath, branchName], {
          cwd: repoPath,
        });
      } else {
        throw new OrchletError(`Failed to create git worktree: ${err.message}`, "WORKTREE_CREATION_FAILED", err);
      }
    }

    return { worktreePath, branchName };
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    this.logger.info(`Removing worktree: ${worktreePath}`);
    const repoPath = path.resolve(worktreePath, "..", "..", "..");
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: repoPath,
      });
      await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath });
    } catch (err: any) {
      this.logger.warn(`Failed to clean worktree via git command, forcing directory delete: ${err.message}`);
      await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => {});
    }
  }

  async getDiff(worktreePath: string, baseBranch = "main"): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["diff", `${baseBranch}...HEAD`], {
        cwd: worktreePath,
      });
      return stdout;
    } catch (err: any) {
      // Fallback to git diff HEAD or uncommitted diff
      const { stdout } = await execFileAsync("git", ["diff", "HEAD"], { cwd: worktreePath }).catch(() => ({ stdout: "" }));
      return stdout;
    }
  }
}

export const worktreeManager = new WorktreeManager();
