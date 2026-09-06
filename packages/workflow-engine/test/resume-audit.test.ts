import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkflowEngine, TaskStore } from "../src/index.js";
import { mockAgentProvider } from "@orchlet/providers";

const execFileAsync = promisify(execFile);

describe("WorkflowEngine Resume Behavior & Crash Audit", () => {
  let tempRepo: string;
  let dbPath: string;

  beforeEach(async () => {
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-resume-test-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempRepo });
    await execFileAsync("git", ["config", "user.name", "Orchlet Bot"], { cwd: tempRepo });
    await execFileAsync("git", ["config", "user.email", "bot@orchlet.ai"], { cwd: tempRepo });
    await fs.writeFile(path.join(tempRepo, "README.md"), "# Initial Repo\n");
    await execFileAsync("git", ["add", "."], { cwd: tempRepo });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: tempRepo });

    dbPath = path.join(tempRepo, ".orchlet", "tasks.db");
  });

  afterEach(async () => {
    await fs.rm(tempRepo, { recursive: true, force: true }).catch(() => {});
  });

  it("durable state persistence: checkpoints and task state are persisted across store instances", async () => {
    const store1 = new TaskStore(dbPath);
    const engine1 = new WorkflowEngine({ store: store1, agentExecutor: mockAgentProvider });

    const task = await engine1.createTask("Test persistence", tempRepo, { executionMode: "MOCK" });
    expect(task.status).toBe("PENDING");

    // Close/simulate crash by creating a new engine instance with the same SQLite db
    const store2 = new TaskStore(dbPath);
    const engine2 = new WorkflowEngine({ store: store2, agentExecutor: mockAgentProvider });

    const retrieved = await engine2.getTask(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(task.id);
    expect(retrieved?.intent).toBe("Test persistence");
  });

  it("already COMPLETED task returns immediately on resume without re-running execution", async () => {
    const store = new TaskStore(dbPath);
    const engine = new WorkflowEngine({ store, agentExecutor: mockAgentProvider });

    const task = await engine.createTask("Complete task", tempRepo, { executionMode: "MOCK" });
    const executed = await engine.startTask(task.id);
    expect(executed.status).toBe("COMPLETED");
    const initialCommit = executed.commitSha;

    // Resuming an already completed task returns it without mutating or re-committing
    const resumed = await engine.resumeTask(task.id);
    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.commitSha).toBe(initialCommit);
  });

  it("audit: interruption before completion currently restarts execution sequence (substantiating Experimental phase-aware resume)", async () => {
    const store = new TaskStore(dbPath);
    let executeCalls = 0;
    const trackingExecutor = {
      ...mockAgentProvider,
      execute: async (req: any) => {
        executeCalls++;
        return mockAgentProvider.execute(req);
      },
    };

    const engine = new WorkflowEngine({ store, agentExecutor: trackingExecutor });
    const task = await engine.createTask("Interrupted task", tempRepo, { executionMode: "MOCK" });

    // Simulate task reaching IMPLEMENTING status but interrupted
    task.status = "IMPLEMENTING";
    store.saveTask(task);

    // When resumed, engine restarts pipeline (execute is called)
    await engine.resumeTask(task.id);
    expect(executeCalls).toBe(1);

    // This test proves that resume does NOT yet skip completed phases,
    // which confirms docs must truthfully designate phase-aware resume as Experimental.
  });
});
