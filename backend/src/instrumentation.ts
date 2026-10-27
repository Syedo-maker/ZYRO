/**
 * Application Insights, through the Azure Monitor OpenTelemetry distro. Imported first by both entry
 * points (index.ts, worker.ts), before anything it has to instrument (http, Express, MongoDB, Redis)
 * is loaded, which is why it reads the environment itself rather than through config/env.
 *
 * Off unless APPLICATIONINSIGHTS_CONNECTION_STRING is set, so development and tests send nothing
 * anywhere. Each container names itself with OTEL_SERVICE_NAME (zyro-api, zyro-worker), which is
 * how the two show up separately on the Application Map.
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// The same file config/env.ts reads: backend/.env, by path.
loadDotenv({ path: path.resolve(__dirname, "../.env") });

let enabled = false;

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  // Required here, not imported at the top: without a connection string the distro is never loaded.
  const { useAzureMonitor } = require("@azure/monitor-opentelemetry") as typeof import("@azure/monitor-opentelemetry");
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    // 1 keeps every request. Lower it (0.2 keeps one in five) once traffic makes telemetry costly.
    samplingRatio: Number(process.env.APPLICATIONINSIGHTS_SAMPLING_RATIO ?? 1),
  });
  enabled = true;
}

/** Sends whatever telemetry is still buffered. Called on shutdown, so the last minute is not lost. */
export async function flushTelemetry(): Promise<void> {
  if (!enabled) return;
  const { shutdownAzureMonitor } = require("@azure/monitor-opentelemetry") as typeof import("@azure/monitor-opentelemetry");
  await shutdownAzureMonitor();
}
