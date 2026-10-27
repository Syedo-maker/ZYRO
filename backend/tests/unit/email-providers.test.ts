/**
 * The email adapters behind lib/email.ts, with fetch replaced so nothing is sent: each makes the one
 * request its provider documents, reports a refusal by status and the provider's own message, and
 * never puts the key in an error. And choosing a provider names its own settings when they are missing.
 */
import { brevoGateway } from "../../src/lib/email.brevo";
import { sendgridGateway } from "../../src/lib/email.sendgrid";

const KEY = "xkeysib-this-must-never-appear";
const realFetch = global.fetch;
let requests: { url: string; init: RequestInit }[] = [];

function answerWith(status: number, body: string) {
  requests = [];
  global.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("Brevo", () => {
  const message = { to: "ayesha@example.com", subject: "You left something in your cart at Bazuka", text: "Your kettle is waiting." };

  it("sends one POST to the transactional email API, with the key in the api-key header", async () => {
    answerWith(201, JSON.stringify({ messageId: "<1@relay>" }));
    await brevoGateway(KEY, "finalyear860@gmail.com", "ZYRO").send(message);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(requests[0].init.method).toBe("POST");
    expect((requests[0].init.headers as Record<string, string>)["api-key"]).toBe(KEY);
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      sender: { email: "finalyear860@gmail.com", name: "ZYRO" },
      to: [{ email: "ayesha@example.com" }],
      subject: "You left something in your cart at Bazuka",
      textContent: "Your kettle is waiting.",
    });
  });

  it("a refusal is an error naming the status and Brevo's reason, never the key", async () => {
    answerWith(400, JSON.stringify({ code: "unauthorized", message: "Key not found" }));
    const err = await brevoGateway(KEY, "finalyear860@gmail.com", "ZYRO").send(message).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^Brevo responded 400: .*Key not found/);
    expect((err as Error).message).not.toContain(KEY);
  });
});

describe("SendGrid", () => {
  it("sends one POST to the mail send API, with the key as a bearer token", async () => {
    answerWith(202, "");
    await sendgridGateway("SG.test", "orders@example.com").send({ to: "a@example.com", subject: "Hi", text: "Hello" });
    expect(requests[0].url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer SG.test");
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({ from: { email: "orders@example.com" }, subject: "Hi" });
  });
});

describe("choosing a provider", () => {
  it("with EMAIL_PROVIDER=brevo, its own settings are the ones reported missing", async () => {
    const { env } = await import("../../src/config/env");
    const { emailStatus } = await import("../../src/lib/email");
    const saved = { ...env.email };
    Object.assign(env.email, { provider: "brevo", brevoApiKey: undefined, brevoFromEmail: undefined });
    expect(emailStatus()).toEqual({ configured: false, provider: "brevo", missing: ["BREVO_API_KEY", "BREVO_FROM_EMAIL"] });
    Object.assign(env.email, { brevoApiKey: KEY, brevoFromEmail: "finalyear860@gmail.com" });
    expect(emailStatus()).toEqual({ configured: true, provider: "brevo", missing: [] });
    expect(JSON.stringify(emailStatus())).not.toContain(KEY);
    Object.assign(env.email, saved);
  });
});
