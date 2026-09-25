import { app } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./lib/mongo";
import { startAiWorker } from "./lib/aiQueue";
import { scheduleCartRecoveryScan, startCartRecoveryWorker } from "./lib/cartRecoveryQueue";

async function main() {
  await connectMongo();
  // Single-process app (Implementation_Plan.md has no separate worker deployment yet): the
  // BullMQ workers that call the AI provider and scan for abandoned carts run alongside the
  // HTTP server, not as separate processes.
  startAiWorker();
  startCartRecoveryWorker();
  await scheduleCartRecoveryScan();
  app.listen(env.port, () => {
    console.log(`ZYRO API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
