export interface BackoffConfig {
  initialIntervalMs: number; // e.g. 15,000
  maxIntervalMs: number;     // e.g. 120,000
  backoffFactor: number;     // e.g. 1.35
  jitterRatio: number;       // e.g. 0.15 (±15%)
}

export function computeNextPollInterval(
  attempt: number,
  rateLimitRemaining = 5000,
  config: BackoffConfig = {
    initialIntervalMs: 15_000,
    maxIntervalMs: 120_000,
    backoffFactor: 1.35,
    jitterRatio: 0.15,
  }
): number {
  if (rateLimitRemaining < 200) return 180_000;
  if (rateLimitRemaining < 500) return 90_000;

  let baseInterval = config.initialIntervalMs * Math.pow(config.backoffFactor, attempt);
  baseInterval = Math.min(baseInterval, config.maxIntervalMs);

  const jitterMultiplier = (1 - config.jitterRatio) + Math.random() * (2 * config.jitterRatio);
  return Math.round(baseInterval * jitterMultiplier);
}

export function sanitizeAndExtractErrorWindow(rawLog: string, maxTailLines = 100): string {
  // 1. Strip ANSI escape codes
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  let clean = rawLog.replace(ansiRegex, "");

  // 2. Strip GitHub Actions ISO-8601 timestamps
  const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/gm;
  clean = clean.replace(timestampRegex, "");

  const lines = clean.split(/\r?\n/);
  const errorPattern = /(?:FAIL|FAILED|FATAL|Error:|AssertionError|CompileError|TypeError|SyntaxError|process completed with exit code [1-9])/i;

  let firstErrorIdx = -1;
  let lastErrorIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (errorPattern.test(lines[i])) {
      if (firstErrorIdx === -1) firstErrorIdx = i;
      lastErrorIdx = i;
    }
  }

  if (firstErrorIdx !== -1) {
    const start = Math.max(0, firstErrorIdx - 15);
    const end = Math.min(lines.length, Math.max(lastErrorIdx + 25, start + maxTailLines));
    return lines.slice(start, end).join("\n");
  }

  return lines.slice(-maxTailLines).join("\n");
}
