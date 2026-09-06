import React, { useState, useEffect, useRef } from "react";

interface Task {
  id: string;
  intent: string;
  status: string;
  attentionState: "RUNNING" | "WAITING_ON_AGENTS" | "NEEDS_ATTENTION" | "SETTLED";
  routingMode: string;
  repoPath: string;
  workBranch: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  updatedAt: string;
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [intent, setIntent] = useState("");
  const [repoPath, setRepoPath] = useState(".");
  const [routingMode, setRoutingMode] = useState("AUTO");
  const [authToken, setAuthToken] = useState(
    () => localStorage.getItem("orchlet_token") || "",
  );
  const [loading, setLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken.trim()}`;
    }
    return headers;
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch("http://127.0.0.1:4774/api/tasks", {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch {
      // Daemon may not be running yet
    }
  };

  // WebSocket real-time subscription
  useEffect(() => {
    fetchTasks();

    const connectWs = () => {
      const tokenParam = authToken ? `?token=${encodeURIComponent(authToken.trim())}` : "";
      const ws = new WebSocket(`ws://127.0.0.1:4774/api/stream${tokenParam}`);
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
    };

    connectWs();
    return () => {
      wsRef.current?.close();
    };
  }, [authToken]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:4774/api/tasks", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ intent, repoPath, routingMode }),
      });
      if (res.ok) {
        const newTask = await res.json();
        await fetch(`http://127.0.0.1:4774/api/tasks/${newTask.id}/start`, {
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
    if (attention === "SETTLED") color = "#3fb950";
    if (attention === "NEEDS_ATTENTION") color = "#f85149";
    if (attention === "WAITING_ON_AGENTS") color = "#d29922";

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
    <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "36px 20px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "28px", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "10px" }}>
            <span>⚡ Orchlet</span>
            <span style={{ fontSize: "14px", fontWeight: "normal", color: "#8b949e" }}>v0.1.0 Control Plane</span>
          </h1>
          <p style={{ margin: "6px 0 0 0", color: "#8b949e" }}>
            State intent once. Orchlet plans, models, executes, reviews, and babysits PRs to clean merge.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
              width: "140px",
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
                color: "#c9d1d9",
                padding: "8px 10px",
                fontSize: "13px",
              }}
            >
              <option value="AUTO">AUTO (Cost & Quality Optimal)</option>
              <option value="CHEAP">CHEAP (Fastest & Minimal Cost)</option>
              <option value="QUALITY">QUALITY (Balanced & Strong Review)</option>
              <option value="BEST">BEST (Maximum Reasoning)</option>
            </select>
            <button
              type="submit"
              disabled={loading || !intent.trim()}
              style={{
                backgroundColor: "#238636",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 20px",
                fontWeight: 600,
                fontSize: "14px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "Launching..." : "Launch Task"}
            </button>
          </div>
        </form>
      </section>

      {notifications.length > 0 && (
        <section style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "16px", marginBottom: "28px" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", color: "#8b949e", textTransform: "uppercase" }}>Live Event Feed</h3>
          <div style={{ maxHeight: "120px", overflowY: "auto", fontSize: "13px", color: "#c9d1d9", display: "flex", flexDirection: "column", gap: "4px" }}>
            {notifications.map((msg, idx) => (
              <div key={idx} style={{ fontFamily: "monospace" }}>{msg}</div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: "20px", color: "#f0f6fc", marginBottom: "16px" }}>Active Orchestration Tasks</h2>
        {tasks.length === 0 ? (
          <div style={{ backgroundColor: "#161b22", border: "1px dashed #30363d", borderRadius: "8px", padding: "32px", textAlign: "center", color: "#8b949e" }}>
            No active tasks. Enter an intent above to start autonomous execution.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  backgroundColor: "#161b22",
                  border: "1px solid #30363d",
                  borderRadius: "8px",
                  padding: "16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600, color: "#f0f6fc" }}>{task.intent}</span>
                    {getStatusBadge(task.status, task.attentionState)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e", display: "flex", gap: "16px" }}>
                    <span>Task ID: <code>{task.id}</code></span>
                    <span>Branch: <code>{task.workBranch}</code></span>
                    <span>Mode: <code>{task.routingMode}</code></span>
                    {task.prUrl && (
                      <span>
                        PR: <a href={task.prUrl} target="_blank" rel="noreferrer" style={{ color: "#58a6ff" }}>#{task.prNumber}</a>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
