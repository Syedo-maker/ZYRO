import { app } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./lib/mongo";
import { startAiWorker } from "./lib/aiQueue";

async function main() {
  await connectMongo();
  // Single-process app (Implementation_Plan.md has no separate worker deployment yet): the
  // BullMQ worker that actually calls the AI provider runs alongside the HTTP server.
  startAiWorker();
  app.listen(env.port, () => {
    console.log(`ZYRO API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
