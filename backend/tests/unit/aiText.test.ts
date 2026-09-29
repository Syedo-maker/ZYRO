/** Unit tests for how AI text is tidied (no em dashes) and how prices are given to the AI (in the store's currency). */
import { tidyText } from "../../src/modules/ai/ai.orchestrator";
import { formatPrice } from "../../src/modules/ai-content/ai-content.service";

const EM = "—";

describe("tidyText: the AI's em dashes become plain dashes", () => {
  it.each([
    [`a winner with customers${EM}it sold 5 times`, "a winner with customers - it sold 5 times"],
    [`reorder soon ${EM} demand is there`, "reorder soon - demand is there"],
    [`one${EM}two${EM}three`, "one - two - three"],
  ])("%s", (input, expected) => {
    expect(tidyText(input)).toBe(expected);
  });

  it("leaves text without em dashes exactly as it was, including hyphens, en dashes and line breaks", () => {
    const text = "Hand-painted cup, 10–20% off.\n#ChaiTime";
    expect(tidyText(text)).toBe(text);
  });
});

describe("formatPrice: prices carry the store's currency", () => {
  it("rupees for a Pakistani store", () => {
    expect(formatPrice(450, "PKR")).toBe("Rs 450.00");
  });

  it("dollars are marked as US dollars", () => {
    expect(formatPrice(12.5, "USD")).toBe("US$12.50");
  });

  it("a currency code Intl does not know is still named, never dropped", () => {
    expect(formatPrice(9, "ZZZ1")).toBe("ZZZ1 9.00");
  });
});
