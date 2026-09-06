export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  maskSensitive?: boolean;
}

const SENSITIVE_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,                     // GitHub PAT
  /gho_[a-zA-Z0-9]{36}/g,                     // GitHub OAuth token
  /github_pat_[a-zA-Z0-9_]{82}/g,             // GitHub fine-grained PAT
  /sk-[a-zA-Z0-9]{32,}/g,                     // OpenAI / OpenRouter key
  /AIza[0-9A-Za-z-_]{35}/g,                   // Google API Key
  /Bearer\s+[a-zA-Z0-9_.-]+/gi,               // Bearer Tokens
];

export function maskSensitiveData(text: string): string {
  let masked = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, "[REDACTED_SECRET]");
  }
  return masked;
}

export class Logger {
  private levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(private readonly options: LoggerOptions = {}) {}

  private shouldLog(level: LogLevel): boolean {
    const minLevel = this.options.level || "info";
    return this.levelOrder[level] >= this.levelOrder[minLevel];
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const prefix = this.options.prefix ? `[${this.options.prefix}] ` : "";
    const cleanMsg = this.options.maskSensitive !== false ? maskSensitiveData(message) : message;
    
    let metaStr = "";
    if (meta !== undefined) {
      const rawMeta = typeof meta === "string" ? meta : JSON.stringify(meta);
      metaStr = " " + (this.options.maskSensitive !== false ? maskSensitiveData(rawMeta) : rawMeta);
    }

    return `[${timestamp}] [${level.toUpperCase()}] ${prefix}${cleanMsg}${metaStr}`;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog("debug")) {
      console.debug(this.format("debug", message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog("info")) {
      console.info(this.format("info", message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog("warn")) {
      console.warn(this.format("warn", message, meta));
    }
  }

  error(message: string, meta?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(this.format("error", message, meta));
    }
  }

  child(prefix: string): Logger {
    return new Logger({
      ...this.options,
      prefix: this.options.prefix ? `${this.options.prefix}:${prefix}` : prefix,
    });
  }
}

export const logger = new Logger({ level: "info" });
