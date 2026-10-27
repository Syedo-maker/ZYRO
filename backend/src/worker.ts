// First, before anything it has to instrument is loaded.
import "./instrumentation";
import { createServer } from "node:http";
import { env } from "./config/env";
import { connectMongo } from "./lib/mongo";
import { prepareStorage } from "./lib/storage";
import { installCrashHandlers, installShutdown, isDraining, readiness, registerConnectionClosers } from "./lib/lifecycle";
import { errorMessage, logger } from "./lib/logger";
import { closeQueuesOnShutdown, startWorkers } from "./workers";

/**
 * The background worker, as its own process: `npm run start:worker` (or `dev:worker`).
 *
 * In production it runs in its own container, apart from the API, so the two scale and restart
 * independently: a burst of AI generations adds worker replicas without adding API ones, and a
 * stuck job cannot slow the API's responses. It serves no traffic, only a small health endpoint for
 * the platform's probes.
 */
async function main() {
  installCrashHandlers();
  await connectMongo();
  await prepareStorage();
  registerConnectionClosers();
  closeQueuesOnShutdown();
  await startWorkers();

  const health = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: isDraining() ? "draining" : "ok" }));
      return;
    }
    if (req.url === "/ready") {
      const result = await readiness();
      res.writeHead(result.ready ? 200 : 503, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      return;
    }
    res.writeHead(404).end();
  });
  health.on("error", (err: NodeJS.ErrnoException) => {
    logger.fatal({ port: env.workers.healthPort, err: errorMessage(err) }, err.code === "EADDRINUSE" ? `Port ${env.workers.healthPort} is already in use: set WORKER_HEALTH_PORT` : "the health endpoint could not start");
    process.exit(1);
  });
  health.listen(env.workers.healthPort, () => logger.info({ healthPort: env.workers.healthPort }, "ZYRO worker running"));

  installShutdown(health);
}

main().catch((err) => {
  logger.fatal({ err: errorMessage(err) }, "the worker could not start");
  process.exit(1);
});
