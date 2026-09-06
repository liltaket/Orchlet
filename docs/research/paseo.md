# Paseo Architecture & Worktree Isolation: Architectural Research

## 1. Executive Summary

Paseo (`getpaseo/paseo`, MIT/Apache-2.0 licensed) is an open-source BYOK (Bring Your Own Key) agent orchestrator designed around autonomous tasks, client/daemon separation, and strict workspace isolation. This document examines Paseo's Git worktree management, multi-agent coordination, and lifecycle hooks, and defines Orchlet's workspace sandboxing model.

---

## 2. Client / Daemon Architecture

Paseo separates user interaction from agent execution:
- **`paseod` (Daemon)**: Long-running background process managing task queues, LLM connections, tool execution, and workspace lifecycle.
- **Client (CLI / GUI)**: Connects to the daemon via WebSocket or local UNIX domain socket / named pipe. Dispatches tasks, streams agent thought processes, and responds to human-in-the-loop approvals.

### Crash Recovery & Session Persistence
Because the daemon runs independently of the UI:
- Terminal closures or browser refreshes do not terminate active agent tasks.
- The daemon checkpoints task state (turns, tool invocations, git refs) to local SQLite storage.
- Clients re-attach seamlessly via subscription streams (`subscribeTask`).

---

## 3. Git Worktree Isolation Pattern

A critical vulnerability in naive multi-agent systems is **filesystem write contention**: when multiple agents or the developer and an agent work concurrently in the same directory, edits overwrite each other, file watchers trigger unnecessary builds, and git staging gets corrupted.

Paseo solves this through **ephemeral Git worktrees**:

```
<project-root>/ (.git)
 ├── User Primary Checkout (clean, untouched by agents)
 └── .orchlet/worktrees/
      ├── task-881a-refactor-auth/   (git worktree on branch: orchlet/task-881a)
      └── task-881b-add-unit-tests/  (git worktree on branch: orchlet/task-881b)
```

### Worktree Lifecycle:

1. **Provisioning**:
   ```bash
   git worktree add -b orchlet/<task-id> <worktree-path> <base-branch>
   ```
2. **Environment & Setup Hook**:
   - Copies required local configurations (`.env.local`, `.npmrc`) with secret redaction.
   - Executes fast dependency linking (e.g. symlinking `node_modules` or running workspace package builds).
3. **Isolated Agent Execution**:
   - The agent's tools (`run_command`, `file_edit`, `create_file`) are sandboxed to execute strictly with `cwd: <worktree-path>`.
   - The developer can continue editing in their primary workspace without interference.
4. **Diff Extraction & Review**:
   - Unified diff is computed: `git diff <base-branch>...HEAD`.
   - Independent review agent analyzes the diff in isolation.
5. **Teardown & Cleanup**:
   - If merged or abandoned:
     ```bash
     git worktree remove --force <worktree-path>
     git worktree prune
     ```

---

## 4. Architectural Adaptations for Orchlet

Orchlet adopts and refines Paseo's worktree model within `@orchlet/context`:
- **Default Worktree Isolation**: All autonomous execution tasks automatically spawn in dedicated worktrees unless the user explicitly chooses `in-place` execution.
- **Atomic Rollback**: If an agent produces failing code or review rejects the changes, the worktree and branch are simply pruned without polluting `git status` in the developer's working directory.
- **Parallel Subagent Swarms**: Multiple subagents (e.g. planner, executor, test generator) can work concurrently across independent worktrees.
