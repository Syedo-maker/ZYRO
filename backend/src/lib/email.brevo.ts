import type { EmailGateway } from "./email";

/**
 * The Brevo adapter behind lib/email.ts: one call to Brevo's transactional email API
 * (POST /v3/smtp/email, developers.brevo.com/reference/sendtransacemail). The key is used only in
 * the api-key header; it is never put in an error, a log line or a response.
 */
export function brevoGateway(apiKey: string, fromEmail: string, fromName: string): EmailGateway {
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        // A recovery email is not worth holding a worker for: give up after 10 s and let the next
        // scan try again.
        signal: AbortSignal.timeout(10_000),
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { email: fromEmail, name: fromName },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
      });
      if (!res.ok) {
        // Brevo answers an error with { code, message }, which names the problem without the key.
        throw new Error(`Brevo responded ${res.status}: ${(await res.text()).slice(0, 500)}`);
      }
    },
  };
}
