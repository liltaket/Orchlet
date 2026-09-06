export class OrchletError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "OrchletError";
  }
}

export class ValidationError extends OrchletError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class QuotaExhaustedError extends OrchletError {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly retryDelayMs?: number,
  ) {
    super(message, "QUOTA_EXHAUSTED", { providerId, retryDelayMs });
    this.name = "QuotaExhaustedError";
  }
}

export class TaskFailedError extends OrchletError {
  constructor(message: string, public readonly taskId: string, details?: unknown) {
    super(message, "TASK_FAILED", { taskId, details });
    this.name = "TaskFailedError";
  }
}

export class ReviewBlockedError extends OrchletError {
  constructor(message: string, public readonly findings: unknown[]) {
    super(message, "REVIEW_BLOCKED", { findings });
    this.name = "ReviewBlockedError";
  }
}
