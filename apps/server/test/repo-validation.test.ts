import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuthManager } from "../src/auth.js";
import { createServer } from "../src/server.js";

const execFileAsync = promisify(execFile);

describe("POST /api/tasks Repo Validation & Usage Spend", () => {
  let token: string;
  let tempDir: string;

  beforeEach(async () => {
    process.env.ORCHLET_AUTH_TOKEN = "test-secret-token-for-repo-validation";
    token = await AuthManager.getOrCreateToken();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-repo-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects non-existent directory with 400", async () => {
    const server = await createServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        intent: "Test non-existent dir",
        repoPath: path.join(tempDir, "does-not-exist"),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("directory does not exist");
    await server.close();
  });

  it("rejects directory that is not a git repository with 400", async () => {
    const server = await createServer();
    const nonGitDir = path.join(tempDir, "plain-dir");
    await fs.mkdir(nonGitDir);

    const res = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        intent: "Test non-git dir",
        repoPath: nonGitDir,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("must be a valid git repository");
    await server.close();
  });

  it("accepts valid git repository and forwards budget fields", async () => {
    const gitDir = path.join(tempDir, "valid-git-repo");
    await fs.mkdir(gitDir);
    await execFileAsync("git", ["init"], { cwd: gitDir });
    await execFileAsync("git", ["config", "user.name", "Orchlet Tester"], { cwd: gitDir });
    await execFileAsync("git", ["config", "user.email", "test@orchlet.local"], { cwd: gitDir });
    await fs.writeFile(path.join(gitDir, "README.md"), "# Test Repo\n");
    await execFileAsync("git", ["add", "."], { cwd: gitDir });
    await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: gitDir });

    const server = await createServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        intent: "Test valid git repo with budget",
        repoPath: gitDir,
        routingMode: "CHEAP",
        executionMode: "MOCK",
        perTaskBudgetUsd: 0.5,
      },
    });

    expect(res.statusCode).toBe(202);
    const task = res.json();
    expect(task.id).toBeDefined();
    expect(task.routingMode).toBe("CHEAP");
    expect(task.perTaskBudgetUsd).toBe(0.5);
    await server.close();
  });

  it("GET /api/usage returns budgetSpend summary", async () => {
    const server = await createServer();
    const res = await server.inject({
      method: "GET",
      url: "/api/usage",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budgetSpend).toBeDefined();
    expect(typeof body.budgetSpend.todayUsd).toBe("number");
    expect(typeof body.budgetSpend.monthUsd).toBe("number");
    await server.close();
  });
});
