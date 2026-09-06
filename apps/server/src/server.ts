import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { Logger } from "@orchlet/shared";
import { WorkflowEngine } from "@orchlet/workflow-engine";
import { usageManager, budgetTracker } from "@orchlet/usage";
import { notificationManager } from "@orchlet/notifications";
import { AuthManager } from "./auth.js";

const execFileAsync = promisify(execFile);

export async function createServer(engine = new WorkflowEngine()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const expectedToken = await AuthManager.getOrCreateToken();
  const sysLogger = new Logger({ prefix: "Server" });

  // Configurable CORS origins: allows localhost, 127.0.0.1, and ORCHLET_ALLOWED_ORIGINS (e.g. Tailscale domains)
  const configuredOrigins = (process.env.ORCHLET_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocalhost) {
        return cb(null, true);
      }
      if (configuredOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(
        new Error(
          `Origin '${origin}' not allowed by Orchlet CORS policy. Set ORCHLET_ALLOWED_ORIGINS to allow remote/Tailscale origins.`
        ),
        false,
      );
    },
  });

  app.register(fastifyWebsocket);

  // Authentication hook for protected routes
  app.addHook("onRequest", async (req, reply) => {
    // Health checks are public
    if (req.url === "/.well-known/orchlet/health" || req.url === "/health") {
      return;
    }

    // Header check
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (AuthManager.validateToken(token)) return;
    }

    // WebSocket ticket check (single-use, short-lived)
    const query = req.query as { ticket?: string; token?: string } | undefined;
    if (query?.ticket && AuthManager.validateAndConsumeWsTicket(query.ticket)) {
      return;
    }

    // Backward-compatible query param check (explicitly gated, default OFF)
    if (
      process.env.ORCHLET_ALLOW_LEGACY_QUERY_TOKEN === "true" &&
      query?.token &&
      AuthManager.validateToken(query.token)
    ) {
      return;
    }

    // In local dev/test if bypass is requested via environment
    if (process.env.ORCHLET_DISABLE_AUTH === "true") {
      return;
    }

    return reply.status(401).send({ error: "Unauthorized: valid Orchlet Bearer token required" });
  });

  // Health checks
  const healthHandler = async () => ({
    status: "ok",
    name: "Orchlet Control Plane Daemon",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
  app.get("/.well-known/orchlet/health", healthHandler);
  app.get("/health", healthHandler);

  // Issue short-lived WebSocket ticket for browser stream connection
  app.post("/api/auth/ws-ticket", async (req, reply) => {
    const ticket = AuthManager.createWsTicket();
    return { ticket, expiresInSeconds: 60 };
  });

  // Task APIs
  app.post("/api/tasks", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.intent || typeof body.intent !== "string" || !body.repoPath || typeof body.repoPath !== "string") {
      return reply.status(400).send({ error: "Missing required string 'intent' or 'repoPath'" });
    }

    const resolvedPath = path.resolve(body.repoPath);
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: `'repoPath' must be a valid directory: ${body.repoPath}` });
      }
    } catch {
      return reply.status(400).send({ error: `'repoPath' directory does not exist: ${body.repoPath}` });
    }

    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: resolvedPath,
      });
      if (stdout.trim() !== "true") {
        return reply.status(400).send({
          error: `'repoPath' must be a valid git repository: ${body.repoPath}`,
        });
      }
    } catch {
      return reply.status(400).send({
        error: `'repoPath' must be a valid git repository: ${body.repoPath}`,
      });
    }

    try {
      const task = await engine.createTask(body.intent, body.repoPath, {
        routingMode: body.routingMode,
        executionMode: body.executionMode,
        perTaskBudgetUsd: body.perTaskBudgetUsd,
        budget: body.budget,
        roleMappings: body.roleMappings,
      });
      // Start async in background
      engine.startTask(task.id).catch((err: any) => {
        sysLogger.error(`Task ${task.id} failed asynchronously:`, err);
      });

      return reply.status(202).send(task);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  app.get("/api/tasks", async () => {
    return engine.listTasks();
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await engine.getTask(id);
    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return task;
  });

  app.post("/api/tasks/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const resumed = await engine.resumeTask(id);
      return reply.send(resumed);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Quota and Usage API
  app.get("/api/usage", async () => {
    return {
      snapshots: usageManager.getAllSnapshots(),
      budgetSpend: budgetTracker.getSpendSummary(),
      timestamp: new Date().toISOString(),
    };
  });

  // Real-time Event Stream (WebSocket)
  app.get("/api/stream", { websocket: true }, (socket, req) => {
    sysLogger.info("Client connected to real-time notification stream.");

    // Initial snapshot of tasks
    try {
      const tasks = engine.listTasks();
      socket.send(JSON.stringify({ type: "SNAPSHOT", data: tasks }));
    } catch (err: any) {
      sysLogger.error("Failed to send initial snapshot:", err);
    }

    const unsubscribe = notificationManager.subscribe((event: any) => {
      try {
        socket.send(JSON.stringify({ type: "NOTIFICATION", data: event }));
      } catch (err) {
        // Socket closed
      }
    });

    const unsubscribeEngine = engine.subscribe((snapshot: any) => {
      try {
        socket.send(JSON.stringify({ type: "TASK_UPDATE", data: snapshot }));
      } catch (err) {
        // Socket closed
      }
    });

    socket.on("close", () => {
      sysLogger.info("Client disconnected from notification stream.");
      unsubscribe();
      unsubscribeEngine();
    });
  });

  return app;
}
