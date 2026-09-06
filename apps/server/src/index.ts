import { createServer } from "./server.js";
import { AuthManager } from "./auth.js";
import { Logger } from "@orchlet/shared";

const logger = new Logger({ prefix: "Bootstrap" });
const PORT = Number(process.env.PORT) || 4774;
const HOST = process.env.HOST || "127.0.0.1";

async function main() {
  await AuthManager.getOrCreateToken();
  const server = await createServer();
  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info(`🚀 Orchlet Control Plane Daemon listening at http://${HOST}:${PORT}`);
    logger.info("Authentication token initialized at ~/.orchlet/auth-token");
    logger.info(`WebSocket stream endpoint available at ws://${HOST}:${PORT}/api/stream`);
  } catch (err) {
    logger.error("Failed to start Orchlet daemon:", err);
    process.exit(1);
  }
}

main();
