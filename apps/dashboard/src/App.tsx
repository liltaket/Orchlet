import React, { useState, useEffect, useRef } from "react";

interface ModelUsageRecord {
  role: string;
  provider: string;
  model: string;
  durationMs: number;
  tokens?: number;
  costUsd?: number;
  timestamp: string;
}

interface VerificationResult {
  command: string;
  exitCode: number;
  durationMs: number;
  passed: boolean;
}

interface Task {
  id: string;
  intent: string;
  status: string;
  attentionState: "RUNNING" | "WAITING_ON_AGENTS" | "NEEDS_ATTENTION" | "SETTLED";
  routingMode: string;
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
  const [daemonUrl, setDaemonUrl] = useState(() => {
    return localStorage.getItem("orchlet_daemon_url") || (window.location.port === "4774" ? window.location.origin : "http://127.0.0.1:4774");
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

  // WebSocket real-time subscription
  useEffect(() => {
    fetchTasks();

    const connectWs = () => {
      try {
        const wsProtocol = cleanDaemonUrl.startsWith("https") ? "wss:" : "ws:";
        const host = cleanDaemonUrl.replace(/^https?:\/\//, "");
        const tokenParam = authToken ? `?token=${encodeURIComponent(authToken.trim())}` : "";
        const ws = new WebSocket(`${wsProtocol}//${host}/api/stream${tokenParam}`);
        wsRef.current = ws;

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          setTimeout(connectWs, 4000);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "notification") {
              const notif = msg.payload;
              setNotifications((prev) => [
                `[${new Date(notif.timestamp).toLocaleTimeString()}] ${notif.message}`,
                ...prev.slice(0, 19),
              ]);
              fetchTasks();
            }
          } catch {
            // Ignore non-json frames
          }
        };
      } catch {
        setWsConnected(false);
      }
    };

    connectWs();
    return () => {
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
        body: JSON.stringify({ intent, repoPath, routingMode }),
      });
      if (res.ok) {
        const newTask = await res.json();
        await fetch(`${cleanDaemonUrl}/api/tasks/${newTask.id}/start`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({}),
        });
        setIntent("");
        await fetchTasks();
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string, attention: string) => {
    let color = "#58a6ff";
    if (status === "READY_TO_MERGE") color = "#a371f7";
    else if (attention === "SETTLED") color = "#3fb950";
    else if (attention === "NEEDS_ATTENTION") color = "#f85149";
    else if (attention === "WAITING_ON_AGENTS") color = "#d29922";

    return (
      <span
        style={{
          display: "inline-block",
          padding: "4px 8px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: 600,
          backgroundColor: `${color}22`,
          color,
          border: `1px solid ${color}44`,
        }}
      >
        {status} • {attention}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: "1120px", margin: "0 auto", padding: "36px 20px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>⚡ Orchlet</span>
            <span style={{ fontSize: "14px", fontWeight: "normal", color: "#8b949e" }}>v0.1.0 Control Plane</span>
          </h1>
          <p style={{ margin: "6px 0 0 0", color: "#8b949e" }}>
            Autonomous coding-agent orchestrator: plan, execute, verify, independent review, and merge-ready PRs.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
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
            placeholder="e.g. Refactor authentication token verification, add test suites, and open verified PR"
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
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="Repository Path (e.g. . or /path/to/repo)"
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
              <option value="AUTO">AUTO (Cost-Performance Optimized)</option>
              <option value="CHEAP">CHEAP (Budget-Constrained)</option>
              <option value="QUALITY">QUALITY (High Capability)</option>
              <option value="BEST">BEST (Maximum Reasoning)</option>
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
                    <div>{getStatusBadge(task.status, task.attentionState)}</div>
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
                        {task.modelUsageAudit.map((m, idx) => (
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
                            <strong style={{ color: "#58a6ff" }}>{m.role}</strong>: {m.model} ({m.durationMs}ms{m.tokens ? ` • ${m.tokens} tok` : ""})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Verification Results */}
                  {task.verificationResults && task.verificationResults.length > 0 && (
                    <div style={{ fontSize: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
                      <span style={{ color: "#8b949e" }}>Verification:</span>
                      {task.verificationResults.map((v, i) => (
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
              height: "460px",
              overflowY: "auto",
              fontFamily: "ui-monospace, monospace",
              fontSize: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {notifications.length === 0 ? (
              <span style={{ color: "#484f58" }}>Waiting for attention stream events...</span>
            ) : (
              notifications.map((msg, index) => (
                <div key={index} style={{ color: msg.includes("ATTENTION") ? "#f85149" : msg.includes("SETTLED") ? "#3fb950" : "#8b949e" }}>
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
