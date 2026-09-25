import { env } from "../config/env";
import { Errors } from "../errors/AppError";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** What the rest of the app needs to send an email. Kept to one method, same shape as
 *  StripeGateway and AiProvider, so tests substitute a fake instead of sending real mail. */
export interface EmailGateway {
  send(message: EmailMessage): Promise<void>;
}

function createRealGateway(): EmailGateway {
  const { sendgridApiKey, fromEmail } = env.email;
  if (!sendgridApiKey || !fromEmail) {
    throw Errors.serviceUnavailable("Email is not configured (set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL)");
  }

  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${sendgridApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: fromEmail },
          subject,
          content: [{ type: "text/plain", value: text }],
        }),
      });
      if (!res.ok) {
        throw new Error(`SendGrid responded ${res.status}: ${(await res.text()).slice(0, 500)}`);
      }
    },
  };
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
