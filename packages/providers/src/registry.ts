import { Logger, OrchletError } from "@orchlet/shared";
import type { AgentRole, ExecutionMode, IAgentExecutor } from "@orchlet/core";
import { openCodeHarness } from "./opencode.js";
import { mockAgentProvider } from "./mock.js";

export class AgentExecutorRegistry {
  private executors = new Map<string, IAgentExecutor>();
  private logger = new Logger({ prefix: "AgentExecutorRegistry" });

  constructor() {
    this.register("opencode", openCodeHarness);
    this.register("mock", mockAgentProvider);
  }

  register(name: string, executor: IAgentExecutor): void {
    this.executors.set(name.toLowerCase(), executor);
    this.logger.debug(`Registered executor harness: ${name}`);
  }

  get(name: string): IAgentExecutor | undefined {
    return this.executors.get(name.toLowerCase());
  }

  listRegistered(): string[] {
    return Array.from(this.executors.keys());
  }

  resolve(
    harnessName: string = "opencode",
    role: AgentRole = "executor",
    executionMode: ExecutionMode = "REAL",
  ): IAgentExecutor {
    const normalized = harnessName.toLowerCase();

    // If harness is mock or explicit mock requested
    if (normalized === "mock") {
      if (executionMode === "REAL") {
        throw new OrchletError(
          "Configured activeHarness is 'mock' but task executionMode is 'REAL'. Refusing to execute mock in REAL mode.",
          "MOCK_NOT_PERMITTED",
        );
      }
      return mockAgentProvider;
    }

    const executor = this.executors.get(normalized);
    if (!executor) {
      throw new OrchletError(
        `Configured agent harness '${harnessName}' is not registered. Available harnesses: ${Array.from(this.executors.keys()).join(", ")}`,
        "HARNESS_NOT_FOUND",
      );
    }

    if (executor.capabilities.isMock && executionMode === "REAL") {
      throw new OrchletError(
        `Resolved executor '${harnessName}' is marked as a mock, but task executionMode is 'REAL'.`,
        "MOCK_NOT_PERMITTED",
      );
    }

    if (!executor.capabilities.roles.includes(role)) {
      throw new OrchletError(
        `Resolved executor '${harnessName}' does not support role '${role}'. Supported roles: ${executor.capabilities.roles.join(", ")}`,
        "UNSUPPORTED_ROLE",
      );
    }

    return executor;
  }
}

export const agentExecutorRegistry = new AgentExecutorRegistry();
