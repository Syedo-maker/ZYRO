/**
 * The COD Trust Agent's rules (Part E). Cash on delivery is paid when the courier arrives, so a
 * refused parcel costs the merchant the delivery both ways. This scores how likely that is, with
 * plain code so every point can be explained, argued with and tested. The AI is never involved in
 * the decision: elsewhere in Part E it reads screenshots and writes messages, but a shopper is
 * never scored by a model.
 *
 * **What the rules may look at** is deliberately short, and `ALLOWED_INPUTS` is enforced by a test:
 * the order's own size, whether the shopper gave a reachable phone and a complete address, how this
 * store's own earlier COD orders to them went, and a platform-wide count of refusals for that phone
 * (shared as counts only, never with a store or an order attached).
 *
 * **What they may never look at**, and why:
 * - The shopper's name, or anything read from it. Names carry ethnicity, religion and caste in
 *   Pakistan; scoring on them would be discrimination, not risk.
 * - The area, city or postcode. Whole neighbourhoods would be marked down for where people live.
 * - Gender, age, or the language the shopper writes in.
 * - Device, IP address or browser fingerprint: not collected, and a poor guide to a cash payment
 *   that a different person often hands over at the door.
 *
 * A high score never cancels anything by itself. It decides what the checkout offers (COD hidden,
 * or a deposit asked for), and the merchant sees the reasons and can always overrule.
 */

export const ALLOWED_INPUTS = [
  "orderTotal",
  "storeAverageOrder",
  "itemCount",
  "hasPhone",
  "phoneLooksValid",
  "addressComplete",
  "storeHistory",
  "platformHistory",
] as const;

export type AllowedInput = (typeof ALLOWED_INPUTS)[number];

export interface CodRiskInputs {
  /** This order's total, in the store currency. */
  orderTotal: number;
  /** What this store's orders usually come to; null for a store with nothing to compare against. */
  storeAverageOrder: number | null;
  itemCount: number;
  hasPhone: boolean;
  /** A Pakistani mobile number, or another plausible international one (see looksLikePhone). */
  phoneLooksValid: boolean;
  /** Street line, city and a name to deliver to were all given. */
  addressComplete: boolean;
  /** How this store's own earlier COD orders to this shopper went. */
  storeHistory: { deliveredOrders: number; refusedOrders: number };
  /** Counts for this phone number across the platform, from CodPhoneSignal. No store, no order, no name. */
  platformHistory: { delivered: number; refused: number };
}

export interface CodRiskReason {
  code: string;
  points: number;
  detail: string;
}

export type RiskBand = "low" | "medium" | "high";

export interface CodRiskResult {
  score: number;
  band: RiskBand;
  reasons: CodRiskReason[];
}

/** Where the bands start. A score is clamped to 0 to 100. */
export const BANDS = { medium: 35, high: 65 } as const;

/** How many times the store average an order must be before its size counts against it. */
const BIG_ORDER_MULTIPLE = 3;
/** A store with fewer paid orders than this has no meaningful average yet. */
const MIN_ORDERS_FOR_AVERAGE = 5;

export function bandFor(score: number): RiskBand {
  if (score >= BANDS.high) return "high";
  if (score >= BANDS.medium) return "medium";
  return "low";
}

/**
 * A phone number good enough to ring before sending a courier. Pakistani mobiles are 03xx xxxxxxx,
 * or +92 3xx xxxxxxx; anything else is accepted only as a plain international number of 8 to 15
 * digits, because ZYRO stores sell abroad too. Spaces, dashes and brackets are ignored.
 */
export function looksLikePhone(raw: string | null | undefined): boolean {
  const digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (/^(\+92|0092|92)?3\d{9}$/.test(digits.replace(/^\+/, "+"))) return true;
  if (/^03\d{9}$/.test(digits)) return true;
  const bare = digits.replace(/^\+/, "");
  return /^\d{8,15}$/.test(bare);
}

/**
 * Scores one COD order. Points are added, never multiplied, so the reasons shown to a merchant add
 * up to the score exactly. Good history subtracts, so a regular customer stays low even on a big order.
 */
export function assessCodRisk(inputs: CodRiskInputs): CodRiskResult {
  const reasons: CodRiskReason[] = [];
  const add = (code: string, points: number, detail: string) => reasons.push({ code, points, detail });

  // ---- The shopper can be reached ----
  if (!inputs.hasPhone) {
    add("no_phone", 30, "No phone number was given, so the courier cannot call before delivering.");
  } else if (!inputs.phoneLooksValid) {
    // A made-up number is at least as bad as none: it took effort, and the courier still cannot call.
    add("phone_invalid", 30, "The phone number does not look like a real number.");
  }
  if (!inputs.addressComplete) {
    add("address_incomplete", 25, "The delivery address is missing a street, a city or a name.");
  }

  // ---- This store's own experience of this shopper ----
  const { deliveredOrders, refusedOrders } = inputs.storeHistory;
  if (refusedOrders > 0) {
    // The strongest signal there is: this shopper has already cost this merchant a wasted delivery.
    // One refusal can be an accident, so it stops short of high on its own; two does not.
    const points = Math.min(65, 45 + (refusedOrders - 1) * 20);
    add("store_refusals", points, `This shopper has refused ${refusedOrders} cash ${refusedOrders === 1 ? "delivery" : "deliveries"} from your store before.`);
  }
  if (deliveredOrders > 0 && refusedOrders === 0) {
    const points = deliveredOrders >= 3 ? -20 : -10;
    add("store_good_history", points, `This shopper has taken ${deliveredOrders} cash ${deliveredOrders === 1 ? "delivery" : "deliveries"} from your store without trouble.`);
  }

  // ---- What the platform has seen for this phone number, as counts only ----
  const { delivered, refused } = inputs.platformHistory;
  if (refused > 0 && refusedOrders === 0) {
    // Only when this store has no refusals of its own, so one refusal is never counted twice.
    const points = Math.min(30, 15 + (refused - 1) * 8);
    add("platform_refusals", points, `This phone number has refused ${refused} cash ${refused === 1 ? "delivery" : "deliveries"} at shops on ZYRO.`);
  }
  if (delivered >= 3 && refused === 0 && deliveredOrders === 0) {
    add("platform_good_history", -10, "This phone number has a clean record of taking cash deliveries at shops on ZYRO.");
  }

  // ---- The order itself ----
  const avg = inputs.storeAverageOrder;
  if (avg !== null && avg > 0 && inputs.orderTotal >= avg * BIG_ORDER_MULTIPLE) {
    const times = Math.floor(inputs.orderTotal / avg);
    add("unusually_large", 20, `This order is about ${times} times your usual order size, so more cash is at risk if it is refused.`);
  }
  if (inputs.itemCount >= 10) {
    add("many_items", 10, `The order has ${inputs.itemCount} items, which is a large parcel to send out unpaid.`);
  }

  // A first-time shopper is not suspicious on its own, but it is worth saying why the score is not lower.
  if (deliveredOrders === 0 && refusedOrders === 0 && delivered === 0 && refused === 0) {
    add("no_history", 10, "This is a first cash-on-delivery order from this shopper, so there is nothing to go on yet.");
  }

  // A band with no reasons behind it would be exactly the unexplained number this part is meant to
  // avoid, so a quiet order says so. It happens when nothing stands out and there is a little clean
  // history: not enough to count in the shopper's favour, but enough that "no history" is untrue.
  if (reasons.length === 0) {
    add("nothing_of_concern", 0, "Nothing about this order stands out, and this shopper has no refused deliveries on record.");
  }

  const raw = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, band: bandFor(score), reasons };
}

/** What the store should do with a band, given its settings. */
export function outcomeFor(
  band: RiskBand,
  settings: { codBlockBand: string; codAdvancePercent: number }
): "allowed" | "blocked" | "advance_required" {
  const order: RiskBand[] = ["low", "medium", "high"];
  const blockFrom = order.indexOf(settings.codBlockBand as RiskBand);
  if (blockFrom >= 0 && order.indexOf(band) >= blockFrom) {
    return settings.codAdvancePercent > 0 ? "advance_required" : "blocked";
  }
  return "allowed";
}
