import { logger } from "../lib/logger";
import { envReport } from "./env";

/**
 * Says at startup what this deployment can and cannot do: optional features that are off because
 * their settings are missing, and settings worth a second look. Names only, never values.
 */
export function logEnvReport(service: "api" | "worker") {
  logger.info({ role: service, appEnv: envReport.appEnv }, "environment checked");
  for (const d of envReport.disabled) logger.warn({ feature: d.feature, missing: d.missing }, `feature off: ${d.feature}`);
  for (const w of envReport.warnings) logger.warn({ setting: w.name }, `${w.name}: ${w.message}`);
}
