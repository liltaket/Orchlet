import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { Logger } from "@orchlet/shared";
import { WorkflowEngine } from "@orchlet/workflow-engine";
import { usageManager } from "@orchlet/usage";
import { notificationManager } from "@orchlet/notifications";
import { AuthManager } from "./auth.js";

export async function createServer(engine = new WorkflowEngine()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const expectedToken = await AuthManager.getOrCreateToken();
  const sysLogger = new Logger({ prefix: "Server" });

  // Restrict CORS strictly to loopback origins (localhost and 127.0.0.1)
  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isLocalhost) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by Orchlet loopback CORS policy"), false);
      }
    },
  });

  app.register(fastifyWebsocket);

  // Authentication hook for protected routes
  app.addHook("onRequest", async (req, reply) => {
    // Health check is public
    if (req.url === "/.well-known/orchlet/health") {
      return;
    }

    // Header check
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (AuthManager.validateToken(token)) return;
    }

    // Query param check (useful for WebSocket connection initial handshake)
    const query = req.query as { token?: string } | undefined;
    if (query?.token && AuthManager.validateToken(query.token)) {
      return;
    }

    // In local dev/test if bypass is requested via environment
    if (process.env.ORCHLET_DISABLE_AUTH === "true") {
      return;
    }

    return reply.status(401).send({ error: "Unauthorized: valid Orchlet Bearer token required" });
  });

  // Health check
  app.get("/.well-known/orchlet/health", async () => {
    return {
      status: "ok",
      name: "Orchlet Control Plane Daemon",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    };
  });

  // Task APIs
  app.post("/api/tasks", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.intent || !body.repoPath) {
      return reply.status(400).send({ error: "Missing required 'intent' or 'repoPath'" });
    }
    const task = await engine.createTask(body.intent, body.repoPath, {
      routingMode: body.routingMode,
    });
    return reply.status(201).send(task);
  });

  app.post("/api/tasks/:id/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    // Run in background and return immediate ACK
    engine.startTask(id).catch((err) => {
      sysLogger.error(`Task ${id} execution error:`, err);
    });
    const task = await engine.getTask(id);
    return reply.status(202).send(task);
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await engine.getTask(id);
    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return task;
  });

  app.get("/api/tasks", async () => {
    return engine.listTasks();
  });

  app.post("/api/tasks/:id/pause", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await engine.pauseTask(id);
    return task;
  });

  app.post("/api/tasks/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await engine.resumeTask(id);
    return task;
  });

  // Usage & Quota snapshots
  app.get("/api/usage", async () => {
    return {
      providers: usageManager.getAllSnapshots(),
    };
  });

  // Real-time WebSocket streaming for UI / CLI
  app.register(async function (fastify) {
    fastify.get("/api/stream", { websocket: true }, (socket, req) => {
      sysLogger.debug("WebSocket client connected to /api/stream");

      const unsubscribeNotifications = notificationManager.subscribe((event) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: "notification", payload: event }));
        }
      });

      const unsubscribeUsage = usageManager.subscribe((snapshot) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: "usage", payload: snapshot }));
        }
      });

      socket.on("close", () => {
        sysLogger.debug("WebSocket client disconnected");
        unsubscribeNotifications();
        unsubscribeUsage();
      });
    });
  });

  return app;
}
