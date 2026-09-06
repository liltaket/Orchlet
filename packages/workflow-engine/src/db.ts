import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { Logger } from "@orchlet/shared";
import type { Task, Checkpoint, TaskStatus } from "@orchlet/core";

export class TaskStore {
  private db: DatabaseSync;
  private logger = new Logger({ prefix: "TaskStore" });

  constructor(dbPath = ":memory:") {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.logger.debug(`Initialized SQLite database at: ${dbPath}`);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        attention_state TEXT NOT NULL,
        routing_mode TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        work_branch TEXT NOT NULL,
        worktree_path TEXT,
        plan_json TEXT,
        review_json TEXT,
        pr_number INTEGER,
        pr_url TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        git_ref TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks (id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints (task_id);
    `);
  }

  saveTask(task: Task): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, intent, status, attention_state, routing_mode,
        repo_path, base_branch, work_branch, worktree_path,
        plan_json, review_json, pr_number, pr_url, error,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        attention_state = excluded.attention_state,
        routing_mode = excluded.routing_mode,
        worktree_path = excluded.worktree_path,
        plan_json = excluded.plan_json,
        review_json = excluded.review_json,
        pr_number = excluded.pr_number,
        pr_url = excluded.pr_url,
        error = excluded.error,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      task.id,
      task.intent,
      task.status,
      task.attentionState,
      task.routingMode,
      task.repoPath,
      task.baseBranch,
      task.workBranch,
      task.worktreePath || null,
      task.plan ? JSON.stringify(task.plan) : null,
      task.latestReview ? JSON.stringify(task.latestReview) : null,
      task.prNumber || null,
      task.prUrl || null,
      task.error || null,
      task.createdAt,
      task.updatedAt,
    );
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapTaskRow(row);
  }

  listTasks(): Task[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`);
    const rows = stmt.all() as any[];
    return rows.map((r) => this.mapTaskRow(r));
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, task_id, step_index, status, git_ref, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      checkpoint.id,
      checkpoint.taskId,
      checkpoint.stepIndex,
      checkpoint.status,
      checkpoint.gitRef,
      JSON.stringify(checkpoint.snapshotData),
      checkpoint.createdAt,
    );
  }

  getLatestCheckpoint(taskId: string): Checkpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step_index DESC LIMIT 1
    `);
    const row = stmt.get(taskId) as any;
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      stepIndex: row.step_index,
      status: row.status,
      gitRef: row.git_ref,
      snapshotData: JSON.parse(row.snapshot_json),
      createdAt: row.created_at,
    };
  }

  private mapTaskRow(row: any): Task {
    return {
      id: row.id,
      intent: row.intent,
      status: row.status as TaskStatus,
      attentionState: row.attention_state,
      routingMode: row.routing_mode,
      repoPath: row.repo_path,
      baseBranch: row.base_branch,
      workBranch: row.work_branch,
      worktreePath: row.worktree_path || undefined,
      plan: row.plan_json ? JSON.parse(row.plan_json) : undefined,
      latestReview: row.review_json ? JSON.parse(row.review_json) : undefined,
      prNumber: row.pr_number || undefined,
      prUrl: row.pr_url || undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
