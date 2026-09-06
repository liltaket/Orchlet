import { createServer } from "./server.js";
import { Logger } from "@orchlet/shared";

const logger = new Logger({ prefix: "Bootstrap" });
const PORT = Number(process.env.PORT) || 4774;
const HOST = process.env.HOST || "127.0.0.1";

async function main() {
  const server = createServer();
  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info(`🚀 Orchlet Control Plane Daemon listening at http://${HOST}:${PORT}`);
    logger.info(`WebSocket stream available at ws://${HOST}:${PORT}/api/stream`);
  } catch (err) {
    logger.error("Failed to start Orchlet daemon:", err);
    process.exit(1);
  }
}

main();
