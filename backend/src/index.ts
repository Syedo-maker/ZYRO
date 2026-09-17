import { app } from "./app";
import { env } from "./config/env";
import { connectMongo } from "./lib/mongo";

async function main() {
  await connectMongo();
  app.listen(env.port, () => {
    console.log(`ZYRO API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
