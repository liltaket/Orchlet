import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Logger } from "@orchlet/shared";
import type {
  IAgentExecutor,
  AgentRequest,
  AgentResult,
  Plan,
  PlanStep,
} from "@orchlet/core";

export class MockAgentProvider implements IAgentExecutor {
  private logger = new Logger({ prefix: "MockAgentProvider" });

  async execute(request: AgentRequest): Promise<AgentResult> {
    const startTime = Date.now();
    this.logger.info(
      `Executing mocked agent action for role=${request.role} (model=${request.selectedModel.providerId}/${request.selectedModel.modelId})`
    );

    // Apply real file changes to the worktree path so a genuine git diff is created
    if (request.worktreePath) {
      try {
        const srcDir = path.join(request.worktreePath, "src");
        await fs.mkdir(srcDir, { recursive: true });
        const filePath = path.join(srcDir, "generated_change.txt");
        await fs.writeFile(
          filePath,
          `# Automated changes for task: ${request.taskId}\nRole: ${request.role}\nObjective: ${request.userObjective}\nTimestamp: ${new Date().toISOString()}\n`,
        );
      } catch {
        // Ignore write failures in memory-only tests
      }
    }

    // Simulate work duration
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      success: true,
      textResponse: `Mock agent successfully fulfilled objective: "${request.userObjective}"`,
      changedFiles: ["src/generated_change.txt"],
      usage: {
        promptTokens: 450,
        completionTokens: 120,
        totalTokens: 570,
        costEstimateUsd: 0.0004,
      },
      modelUsed: request.selectedModel.modelId,
      providerUsed: request.selectedModel.providerId,
      durationMs: Date.now() - startTime,
    };
  }

  async generatePlan(intent: string, taskId: string): Promise<Plan> {
    const steps: PlanStep[] = [
      {
        id: "step_1",
        description: `Analyze scope for: ${intent}`,
        status: "COMPLETED",
      },
      {
        id: "step_2",
        description: "Write targeted code modifications in isolated worktree",
        status: "PENDING",
      },
      {
        id: "step_3",
        description: "Run automated test suites and linters",
        status: "PENDING",
      },
    ];

    return {
      id: `plan_${taskId}`,
      title: `Execution Plan: ${intent.slice(0, 50)}`,
      summary: `Automated plan generated for: ${intent}`,
      steps,
      architectVerdict: "APPROVED",
      architectNotes: "Architect verified plan adheres to safety guidelines and monorepo boundaries.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export const mockAgentProvider = new MockAgentProvider();
