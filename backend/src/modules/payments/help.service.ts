import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { buildPrompt, checkHelpSentence, fallbackHelp, knownHelp, SYSTEM_PROMPT, type PaymentHelp } from "./payment.help";
import type { PaymentHelpInput } from "./payments.validation";

/**
 * The payment-failure helper (Part E). A known failure code is answered from the written table with
 * no AI call at all, which is most of the time. The AI is asked only when a gateway sends something
 * we have not seen before, and even then only to turn the bank's own words into one plain sentence;
 * the next step always comes from the table, and the sentence is checked before the shopper sees it.
 */
export const helpService = {
  async explain(tenantId: string, input: PaymentHelpInput): Promise<PaymentHelp> {
    const language = input.language ?? "en";

    const known = input.code ? knownHelp(input.code, language) : null;
    if (known) return known;

    const fallback = fallbackHelp(language);
    if (!input.providerMessage) return fallback;

    try {
      const result = await aiGenerate({
        tenantId,
        promptType: "payment_help",
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input.providerMessage, language),
        maxTokens: 150,
        // The platform pays: a shopper whose payment failed is not the merchant's AI allowance to spend.
        billedTo: "platform",
      });
      const sentence = checkHelpSentence(result.text);
      // A sentence that claims success, promises a refund or carries a number is thrown away.
      if (!sentence) return fallback;
      return { reason: sentence, nextStep: fallback.nextStep, tryAnotherMethod: fallback.tryAnotherMethod, source: "ai" };
    } catch {
      return fallback;
    }
  },
};
