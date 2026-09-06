import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { Logger } from "@orchlet/shared";
import { WorkflowEngine } from "@orchlet/workflow-engine";
import { usageManager } from "@orchlet/usage";
import { notificationManager } from "@orchlet/notifications";

export function createServer(engine = new WorkflowEngine()): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const sysLogger = new Logger({ prefix: "Server" });

  app.register(fastifyCors, { origin: true });
  app.register(fastifyWebsocket);

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
