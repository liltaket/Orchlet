import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine } from "../src/engine.js";
import { TaskStore } from "../src/db.js";
import { AgentExecutorRegistry } from "@orchlet/providers";
import type { AgentRequest, AgentResult, IAgentExecutor } from "@orchlet/core";

const execFileAsync = promisify(execFile);

async function createTestRepo(configData?: Record<string, unknown>): Promise<string> {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-dyn-repo-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "Dynamic Tester"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "tester@orchlet.dev"], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, "README.md"), "# Dynamic Harness Repo\n", "utf-8");

  if (configData) {
    const orchletDir = path.join(repoDir, ".orchlet");
    await fs.mkdir(orchletDir, { recursive: true });
    await fs.writeFile(
      path.join(orchletDir, "config.json"),
      JSON.stringify(configData, null, 2),
      "utf-8",
    );
  }

  await execFileAsync("git", ["add", "."], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "init repo"], { cwd: repoDir });
  return repoDir;
}

describe("Dynamic Harness & AgentExecutor Resolution", () => {
  it("resolves OpenCode executor dynamically when repo config has activeHarness='opencode' without passing config to constructor", async () => {
    const repoDir = await createTestRepo({
      activeHarness: "opencode",
      git: { push: false, openPr: false },
      reviewer: { allowStaticFallback: true },
    });

    const registry = new AgentExecutorRegistry();
    let executedHarness = "";

    const spyOpenCode: IAgentExecutor = {
      harnessName: "opencode",
      capabilities: {
        roles: ["executor", "repairer"],
        filesystem: true,
        shell: true,
        structuredOutput: true,
        streaming: true,
        modelSelection: true,
        providerSelection: true,
        isMock: false,
      },
      async execute(req: AgentRequest): Promise<AgentResult> {
        executedHarness = "opencode";
        const file = path.join(req.worktreePath, "dyn.txt");
        await fs.writeFile(file, "content from dynamic opencode harness\n");
        return {
          success: true,
          changedFiles: ["dyn.txt"],
          modelUsed: req.selectedModel.modelId,
          providerUsed: req.selectedModel.providerId,
          durationMs: 25,
        };
      },
    };

    registry.register("opencode", spyOpenCode);

    // Initialized cleanly WITHOUT config in constructor!
    const engine = new WorkflowEngine({
      store: new TaskStore(":memory:"),
      executorRegistry: registry,
    });

    const task = await engine.createTask("Test dynamic resolution", repoDir, {
      executionMode: "REAL",
    });

    const result = await engine.startTask(task.id);
    expect(result.status).toBe("COMPLETED");
    expect(executedHarness).toBe("opencode");

    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it("throws MOCK_NOT_PERMITTED when repo config requests mock harness but task executionMode is REAL", async () => {
    const repoDir = await createTestRepo({
      activeHarness: "mock",
      git: { push: false, openPr: false },
    });

    const engine = new WorkflowEngine({
      store: new TaskStore(":memory:"),
    });

    const task = await engine.createTask("Test mock refusal", repoDir, {
      executionMode: "REAL",
    });

    await expect(engine.startTask(task.id)).rejects.toThrow(/MOCK_NOT_PERMITTED|Refusing to execute mock in REAL mode/);

    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it("permits mock execution when task executionMode is explicitly MOCK", async () => {
    const repoDir = await createTestRepo({
      activeHarness: "mock",
      git: { push: false, openPr: false },
    });

    const engine = new WorkflowEngine({
      store: new TaskStore(":memory:"),
    });

    const task = await engine.createTask("Test mock allowed", repoDir, {
      executionMode: "MOCK",
    });

    const result = await engine.startTask(task.id);
    expect(result.status).toBe("COMPLETED");

    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);

  it("allows dependency-injected agentExecutor to override dynamic resolution for testing", async () => {
    const repoDir = await createTestRepo({
      activeHarness: "opencode",
    });

    let customExecuted = false;
    const customExecutor: IAgentExecutor = {
      harnessName: "custom-test-harness",
      capabilities: {
        roles: ["executor", "repairer"],
        filesystem: true,
        shell: false,
        structuredOutput: true,
        streaming: false,
        modelSelection: true,
        providerSelection: true,
        isMock: false,
      },
      async execute(req: AgentRequest): Promise<AgentResult> {
        customExecuted = true;
        await fs.writeFile(path.join(req.worktreePath, "custom.txt"), "custom content\n");
        return {
          success: true,
          changedFiles: ["custom.txt"],
          modelUsed: "custom-model",
          providerUsed: "custom-prov",
          durationMs: 10,
        };
      },
    };

    const engine = new WorkflowEngine({
      store: new TaskStore(":memory:"),
      agentExecutor: customExecutor,
      config: { git: { push: false, openPr: false } },
    });

    const task = await engine.createTask("Override test", repoDir);
    await engine.startTask(task.id);

    expect(customExecuted).toBe(true);

    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }, 15000);
});
