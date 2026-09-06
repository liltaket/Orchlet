import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OrchletError } from "@orchlet/shared";

const execFileAsync = promisify(execFile);

export interface GitHubRepoIdentity {
  owner: string;
  repo: string;
}

/**
 * Parses a Git remote URL into GitHub owner and repository name.
 * Supports:
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo
 * - https://user:token@github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - git@github.com:owner/repo
 * - ssh://git@github.com/owner/repo.git
 */
export function parseGitHubRemoteUrl(url: string): GitHubRepoIdentity {
  const trimmed = url.trim();

  // HTTPS / SSH regex patterns for github.com
  const httpsPattern = /^https?:\/\/(?:[^@:]+(?::[^@:]+)?@)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?$/i;
  const sshPattern = /^(?:ssh:\/\/)?git@github\.com[:\/]([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?$/i;

  const httpsMatch = trimmed.match(httpsPattern);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = trimmed.match(sshPattern);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new OrchletError(
    `Remote URL '${trimmed}' is not a recognized GitHub repository. Expected https://github.com/owner/repo or git@github.com:owner/repo.`,
    "INVALID_REMOTE",
  );
}

/**
 * Discovers the GitHub repository identity (owner and repo name)
 * by reading 'git remote get-url origin' from the given repository path.
 */
export async function getGitHubRepoIdentity(repoPath: string): Promise<GitHubRepoIdentity> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
    });
    return parseGitHubRemoteUrl(stdout.trim());
  } catch (err: any) {
    throw new OrchletError(
      `Failed to determine GitHub repository origin from '${repoPath}': ${err.message}`,
      "REMOTE_DISCOVERY_FAILED",
    );
  }
}
