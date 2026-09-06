import type { Plan, PlanStep } from "@orchlet/core";

export class MockAgentProvider {
  async generatePlan(intent: string, taskId: string): Promise<Plan> {
    const steps: PlanStep[] = [
      {
        id: "step_1",
        order: 1,
        title: "Analyze workspace and requirements",
        description: `Analyze scope for: ${intent}`,
        status: "COMPLETED",
      },
      {
        id: "step_2",
        order: 2,
        title: "Implement code changes",
        description: "Write targeted code modifications in isolated worktree",
        status: "PENDING",
      },
      {
        id: "step_3",
        order: 3,
        title: "Verify tests and build",
        description: "Run automated test suites and linters",
        status: "PENDING",
      },
    ];

    return {
      id: `plan_${taskId}`,
      taskId,
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
