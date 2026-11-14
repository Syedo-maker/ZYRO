// First, before anything it has to instrument is loaded.
import "./instrumentation";
import { app } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./lib/mongo";
import { prepareStorage } from "./lib/storage";
import { installCrashHandlers, installShutdown, registerConnectionClosers } from "./lib/lifecycle";
import { errorMessage, logger } from "./lib/logger";
import { closeQueuesOnShutdown, startWorkers } from "./workers";
import { checkAiProviders, describeAiHealth } from "./lib/aiHealth";

async function main() {
  installCrashHandlers();
  await connectMongo();
  await prepareStorage();
  registerConnectionClosers();
  closeQueuesOnShutdown();
  if (env.workers.inProcess) await startWorkers();
  // Which AI key works, logged once by variable name (never its value), so a rejected key is found
  // here instead of as every AI feature failing. In the background: the API does not wait for it.
  void checkAiProviders()
    .then((health) => {
      const working = health.some((h) => h.status === "ok");
      for (const h of health) if (h.status !== "missing" || !working) (h.status === "ok" ? logger.info : logger.warn).call(logger, `[ai] ${describeAiHealth(h)}`);
      if (!working) logger.warn("[ai] no AI provider key works: every AI feature will answer 'temporarily unavailable'");
    })
    .catch((err) => logger.warn({ err: errorMessage(err) }, "[ai] the AI key check could not run"));

  const server = app.listen(env.port, () => {
    logger.info({ port: env.port, workers: env.workers.inProcess ? "in this process" : "separate process", storage: env.storage.driver }, "ZYRO API listening");
  });
  // A port already in use is a setup mistake (usually a second copy already running), not a crash:
  // say so plainly instead of printing a stack trace.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: env.port }, `Port ${env.port} is already in use. Another ZYRO API is probably running: stop it, or start this one with a different PORT.`);
    } else {
      logger.fatal({ err: errorMessage(err) }, "the HTTP server could not start");
    }
    process.exit(1);
  });

  // Every request must end (lib/lifecycle.ts, middleware/timeout.middleware.ts). Node's own limits
  // are the outer bound: a client that never finishes sending its request is cut off, and idle
  // keep-alive connections outlast the load balancer's so it never reuses one the API just closed.
  server.requestTimeout = env.lifecycle.requestTimeoutMs + 30_000;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  installShutdown(server);
}

main().catch((err) => {
  logger.fatal({ err: errorMessage(err) }, "the API could not start");
  process.exit(1);
});
