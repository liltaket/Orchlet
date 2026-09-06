import React, { useState, useEffect, useRef } from "react";

export type ExecutionMode = "REAL" | "MOCK";
export type AttentionState = "RUNNING" | "WAITING_ON_AGENTS" | "NEEDS_ATTENTION" | "SETTLED";
export type TaskStatus =
  | "PENDING"
  | "PLANNING"
  | "PLAN_APPROVED"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "REVIEWING"
  | "REPAIRING"
  | "COMMITTED"
  | "PR_BABYSITTING"
  | "READY_TO_MERGE"
  | "COMPLETED"
  | "FAILED";

export interface ModelUsageRecord {
  role: string;
  provider: string;
  model: string;
  durationMs: number;
  tokens?: number;
  costUsd?: number;
  timestamp: string;
}

export interface VerificationResult {
  command: string;
  exitCode: number;
  durationMs: number;
  passed: boolean;
}

export interface Task {
  id: string;
  intent: string;
  status: TaskStatus;
  attentionState: AttentionState;
  routingMode: string;
  executionMode?: ExecutionMode;
  repoPath: string;
  workBranch: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  modelUsageAudit?: ModelUsageRecord[];
  verificationResults?: VerificationResult[];
  updatedAt: string;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [intent, setIntent] = useState("");
  const [repoPath, setRepoPath] = useState(".");
  const [routingMode, setRoutingMode] = useState("AUTO");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("REAL");
  const [daemonUrl, setDaemonUrl] = useState(() => {
    return (
      localStorage.getItem("orchlet_daemon_url") ||
      (window.location.port === "4774" ? window.location.origin : "http://127.0.0.1:4774")
    );
  });
  const [authToken, setAuthToken] = useState(
    () => localStorage.getItem("orchlet_token") || "",
  );
  const [loading, setLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const cleanDaemonUrl = daemonUrl.replace(/\/+$/, "");

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken.trim()}`;
    }
    return headers;
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${cleanDaemonUrl}/api/tasks`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch {
      // Daemon may not be reachable
    }
  };

  // WebSocket real-time subscription with ticket-based auth
  useEffect(() => {
    fetchTasks();

    let isMounted = true;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectWs = async () => {
      try {
        const wsProtocol = cleanDaemonUrl.startsWith("https") ? "wss:" : "ws:";
        const host = cleanDaemonUrl.replace(/^https?:\/\//, "");
        let wsUrl = `${wsProtocol}//${host}/api/stream`;

        if (authToken) {
          try {
            const ticketRes = await fetch(`${cleanDaemonUrl}/api/auth/ws-ticket`, {
              method: "POST",
              headers: getHeaders(),
            });
            if (ticketRes.ok) {
              const data = await ticketRes.json();
              wsUrl += `?ticket=${data.ticket}`;
            } else {
              console.warn("Could not acquire WS ticket from daemon; will retry.");
              return;
            }
          } catch (err) {
            console.warn("Failed to request WS ticket:", err);
            return;
          }
        }

        if (!isMounted) return;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isMounted) setWsConnected(true);
        };
        ws.onclose = () => {
          if (isMounted) {
            setWsConnected(false);
            reconnectTimeout = setTimeout(connectWs, 4000);
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "NOTIFICATION" || msg.type === "notification") {
              const notif = msg.data || msg.payload;
              if (notif?.message) {
                setNotifications((prev) => [
                  `[${new Date().toLocaleTimeString()}] ${notif.message}`,
                  ...prev.slice(0, 19),
                ]);
              }
              fetchTasks();
            } else if (msg.type === "TASK_UPDATE" || msg.type === "SNAPSHOT") {
              fetchTasks();
            }
          } catch {
            // Ignore non-json frames
          }
        };
      } catch {
        if (isMounted) setWsConnected(false);
      }
    };

    connectWs();
    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [authToken, daemonUrl]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`${cleanDaemonUrl}/api/tasks`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          intent,
          repoPath,
          routingMode,
          executionMode,
        }),
      });

      if (res.ok) {
        setIntent("");
        await fetchTasks();
      } else {
        const err = await res.json();
        alert(`Failed to create task: ${err.error || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Error connecting to daemon: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: TaskStatus, attention: AttentionState) => {
    const isSettled = attention === "SETTLED";
    const isNeedsAttention = attention === "NEEDS_ATTENTION";
    const isFailed = status === "FAILED";

    let bg = "#1f6feb";
    if (isFailed) bg = "#da3633";
    else if (isSettled) bg = "#238636";
    else if (isNeedsAttention) bg = "#d29922";

    return (
      <span
        style={{
          padding: "4px 8px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 600,
          backgroundColor: bg,
          color: "#ffffff",
        }}
      >
        {status} • {attention}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px", fontFamily: "system-ui, sans-serif", color: "#c9d1d9" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", borderBottom: "1px solid #30363d", paddingBottom: "16px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "#f0f6fc", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>Orchlet</span>
            <span style={{ fontSize: "12px", fontWeight: 400, padding: "2px 8px", backgroundColor: "#21262d", borderRadius: "12px", border: "1px solid #30363d" }}>
              V1 Control Plane
            </span>
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "#8b949e", fontSize: "14px" }}>
            Autonomous coding agent orchestration with adversarial review and merge gates
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Daemon URL"
            value={daemonUrl}
            onChange={(e) => {
              setDaemonUrl(e.target.value);
              localStorage.setItem("orchlet_daemon_url", e.target.value);
            }}
            style={{
              backgroundColor: "#161b22",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "6px 10px",
              color: "#c9d1d9",
              fontSize: "12px",
              width: "160px",
            }}
          />
          <input
            type="password"
            placeholder="Bearer Token"
            value={authToken}
            onChange={(e) => {
              setAuthToken(e.target.value);
              localStorage.setItem("orchlet_token", e.target.value);
            }}
            style={{
              backgroundColor: "#161b22",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "6px 10px",
              color: "#c9d1d9",
              fontSize: "12px",
              width: "130px",
            }}
          />
          <span
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              backgroundColor: wsConnected ? "#238636" : "#6e7681",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {wsConnected ? "● Live Stream" : "○ Disconnected"}
          </span>
        </div>
      </header>

      <section style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "24px", marginBottom: "28px" }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "#f0f6fc" }}>Dispatch New Autonomous Outcome</h2>
        <form onSubmit={handleCreateTask} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <textarea
            rows={3}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. Add clamp(value, min, max) utility with unit tests, execute verification, and open PR"
            style={{
              width: "100%",
              padding: "12px",
              backgroundColor: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              color: "#c9d1d9",
              fontSize: "14px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="Repository Path (e.g. . or /repos/my-project)"
              style={{
                backgroundColor: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "8px 12px",
                color: "#c9d1d9",
                fontSize: "13px",
              }}
            />
            <select
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value)}
              style={{
                backgroundColor: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "8px 12px",
                color: "#c9d1d9",
                fontSize: "13px",
              }}
            >
              <option value="AUTO">AUTO (Balanced)</option>
              <option value="CHEAP">CHEAP (Budget)</option>
              <option value="QUALITY">QUALITY (High)</option>
              <option value="BEST">BEST (Max Reasoning)</option>
            </select>
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
              style={{
                backgroundColor: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "8px 12px",
                color: "#c9d1d9",
                fontSize: "13px",
              }}
            >
              <option value="REAL">REAL (OpenCode / AI)</option>
              <option value="MOCK">MOCK (Test Sandbox)</option>
            </select>
            <button
              type="submit"
              disabled={loading || !intent.trim()}
              style={{
                backgroundColor: "#238636",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                fontWeight: 600,
                padding: "8px 20px",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Dispatching..." : "Launch Workflow"}
            </button>
          </div>
        </form>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px", color: "#f0f6fc" }}>Active & Settled Workflows ({tasks.length})</h2>
            <button
              onClick={fetchTasks}
              style={{
                backgroundColor: "transparent",
                border: "1px solid #30363d",
                color: "#8b949e",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              ↻ Refresh
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {tasks.length === 0 ? (
              <div style={{ color: "#8b949e", padding: "32px", textAlign: "center", backgroundColor: "#161b22", borderRadius: "8px", border: "1px solid #30363d" }}>
                No active workflows recorded. Dispatch an intent above to start orchestration.
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    backgroundColor: "#161b22",
                    border: "1px solid #30363d",
                    borderRadius: "8px",
                    padding: "18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ fontWeight: 600, color: "#f0f6fc", fontSize: "15px" }}>{task.intent}</div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: task.executionMode === "REAL" ? "#1f6feb22" : "#8957e522",
                          color: task.executionMode === "REAL" ? "#58a6ff" : "#d2a8ff",
                          border: `1px solid ${task.executionMode === "REAL" ? "#1f6feb66" : "#8957e566"}`,
                          fontWeight: 600,
                        }}
                      >
                        {task.executionMode || "REAL"}
                      </span>
                      {getStatusBadge(task.status, task.attentionState)}
                    </div>
                  </div>

                  <div style={{ fontSize: "12px", color: "#8b949e", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                    <span>ID: <code style={{ color: "#79c0ff" }}>{task.id}</code></span>
                    <span>Branch: <code style={{ color: "#7ee787" }}>{task.workBranch}</code></span>
                    {task.commitSha && (
                      <span>Commit: <code style={{ color: "#d2a8ff" }}>{task.commitSha.slice(0, 7)}</code></span>
                    )}
                    {task.prNumber && (
                      <span>
                        PR: <a href={task.prUrl} target="_blank" rel="noreferrer" style={{ color: "#58a6ff" }}>#{task.prNumber}</a>
                      </span>
                    )}
                  </div>

                  {/* Model Execution Audit Trail */}
                  {task.modelUsageAudit && task.modelUsageAudit.length > 0 && (
                    <div style={{ marginTop: "4px", backgroundColor: "#0d1117", borderRadius: "6px", padding: "8px 12px", border: "1px solid #21262d" }}>
                      <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px", fontWeight: 600 }}>ROUTED AGENTS & MODELS AUDIT:</div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {task.modelUsageAudit.map((m: ModelUsageRecord, idx: number) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: "11px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              backgroundColor: "#1f242c",
                              color: "#c9d1d9",
                              border: "1px solid #30363d",
                            }}
                          >
                            <strong style={{ color: "#58a6ff" }}>{m.role}</strong>: {m.provider}/{m.model} ({m.durationMs}ms{m.tokens ? ` • ${m.tokens} tok` : ""})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Verification Results */}
                  {task.verificationResults && task.verificationResults.length > 0 && (
                    <div style={{ fontSize: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
                      <span style={{ color: "#8b949e" }}>Verification:</span>
                      {task.verificationResults.map((v: VerificationResult, i: number) => (
                        <span
                          key={i}
                          style={{
                            color: v.passed ? "#3fb950" : "#f85149",
                            fontWeight: 600,
                          }}
                        >
                          {v.passed ? "✓" : "✗"} {v.command} ({v.durationMs}ms)
                        </span>
                      ))}
                    </div>
                  )}

                  {task.error && (
                    <div style={{ color: "#f85149", fontSize: "12px", backgroundColor: "#ffebe911", padding: "8px", borderRadius: "4px", border: "1px solid #f8514933" }}>
                      Error: {task.error}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "#f0f6fc" }}>Live Orchestration Stream</h2>
          <div
            style={{
              backgroundColor: "#161b22",
              border: "1px solid #30363d",
              borderRadius: "8px",
              padding: "16px",
              height: "400px",
              overflowY: "auto",
              fontFamily: "monospace",
              fontSize: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {notifications.length === 0 ? (
              <span style={{ color: "#484f58" }}>Waiting for event stream notifications...</span>
            ) : (
              notifications.map((msg, i) => (
                <div key={i} style={{ color: "#8b949e", borderBottom: "1px solid #21262d", paddingBottom: "4px" }}>
                  {msg}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
