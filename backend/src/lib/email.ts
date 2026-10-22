import { env } from "../config/env";
import { Errors } from "../errors/AppError";
import { sendgridGateway } from "./email.sendgrid";
import { brevoGateway } from "./email.brevo";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** What the rest of the app needs to send an email. Kept to one method, same shape as
 *  StripeGateway and AiProvider, so tests substitute a fake instead of sending real mail, and a
 *  feature that sends email never knows which provider is behind it. */
export interface EmailGateway {
  send(message: EmailMessage): Promise<void>;
}

/**
 * The providers the platform can send through, chosen with EMAIL_PROVIDER ("sendgrid", the default,
 * or "brevo").
 * Each names the settings it needs (read from backend/.env, see config/env.ts) and builds its gateway
 * from them. Adding a provider is one entry here and one adapter file; no feature changes.
 */
const PROVIDERS: Record<string, { settings: { name: string; value: () => string | undefined }[]; create: () => EmailGateway }> = {
  sendgrid: {
    settings: [
      { name: "SENDGRID_API_KEY", value: () => env.email.sendgridApiKey },
      { name: "SENDGRID_FROM_EMAIL", value: () => env.email.fromEmail },
    ],
    create: () => sendgridGateway(env.email.sendgridApiKey!, env.email.fromEmail!),
  },
  brevo: {
    settings: [
      { name: "BREVO_API_KEY", value: () => env.email.brevoApiKey },
      { name: "BREVO_FROM_EMAIL", value: () => env.email.brevoFromEmail },
    ],
    create: () => brevoGateway(env.email.brevoApiKey!, env.email.brevoFromEmail!, env.email.brevoFromName),
  },
};

export interface EmailStatus {
  configured: boolean;
  provider: string;
  /** The names of the settings still missing (never their values). */
  missing: string[];
}

/** Whether email can be sent, and if not, which settings are missing. Safe to show or log. */
export function emailStatus(): EmailStatus {
  if (override) return { configured: true, provider: "test", missing: [] };
  const provider = env.email.provider;
  const chosen = PROVIDERS[provider];
  if (!chosen) return { configured: false, provider, missing: ["EMAIL_PROVIDER"] };
  const missing = chosen.settings.filter((s) => !s.value()?.trim()).map((s) => s.name);
  return { configured: missing.length === 0, provider, missing };
}

function createRealGateway(): EmailGateway {
  const status = emailStatus();
  if (!status.configured) {
    throw Errors.serviceUnavailable(`Email sending is not set up (missing ${status.missing.join(" and ")})`);
  }
  return PROVIDERS[status.provider].create();
}

let override: EmailGateway | undefined;
let real: EmailGateway | undefined;

/** Tests and scripts inject a fake here; pass undefined to restore the real gateway. */
export function setEmailGateway(gateway: EmailGateway | undefined) {
  override = gateway;
}

export function getEmailGateway(): EmailGateway {
  if (override) return override;
  real ??= createRealGateway();
  return real;
}
