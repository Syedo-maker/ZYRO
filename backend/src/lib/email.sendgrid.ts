import type { EmailGateway } from "./email";

/**
 * The SendGrid adapter behind lib/email.ts. The key is used only in the Authorization header; it is
 * never put in an error, a log line or a response.
 */
export function sendgridGateway(apiKey: string, fromEmail: string): EmailGateway {
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        // A recovery email is not worth holding a worker for: give up after 10 s and let the next
        // scan try again.
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
