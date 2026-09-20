import type { DiscountType } from "@prisma/client";
import { discountCentsFor } from "../commerce/pricing.service";

/**
 * The rules a discount code must pass, as a pure function: no database, no clock of its
 * own, so every rule can be tested in isolation. One code per order, no stacking, and no
 * partial application: a code either applies to the whole order or is refused.
 */
export interface DiscountCodeState {
  type: DiscountType;
  value: number;
  active: boolean;
  expiresAt: Date | null;
  minSubtotalCents: number | null;
  /** Null means unlimited. */
  usageLimit: number | null;
  /** Orders that have already used the code. */
  usageCount: number;
  /** Checkouts in progress that will use it (they hold a use until they finish or lapse). */
  reserved: number;
}

export type DiscountRejection = "inactive" | "expired" | "used_up" | "below_minimum";

export type DiscountVerdict =
  | { ok: true; discountCents: number }
  | { ok: false; reason: DiscountRejection; message: string };

/** Codes are typed by people: case and stray spaces must not matter. */
export const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

/** How many more times a code can be used right now, or null when it has no limit. */
export function usesLeft(state: Pick<DiscountCodeState, "usageLimit" | "usageCount" | "reserved">): number | null {
  return state.usageLimit === null ? null : Math.max(0, state.usageLimit - state.usageCount - state.reserved);
}

export function evaluateDiscountCode(state: DiscountCodeState, subtotalCents: number, now: Date): DiscountVerdict {
  if (!state.active) return { ok: false, reason: "inactive", message: "This discount code is no longer available." };
  if (state.expiresAt && state.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired", message: "This discount code has expired." };
  }
  if (usesLeft(state) === 0) {
    return { ok: false, reason: "used_up", message: "This discount code has reached its usage limit." };
  }
  if (state.minSubtotalCents !== null && subtotalCents < state.minSubtotalCents) {
    return {
      ok: false,
      reason: "below_minimum",
      message: `This discount code needs a subtotal of at least ${(state.minSubtotalCents / 100).toFixed(2)}.`,
    };
  }
  const discountCents = discountCentsFor({ type: state.type, value: state.value }, subtotalCents);
  return { ok: true, discountCents };
}

/** Where a code stands, for the merchant's list. */
export type DiscountStatus = "active" | "inactive" | "expired" | "used_up";

export function statusOf(state: Omit<DiscountCodeState, "reserved" | "minSubtotalCents">, now: Date): DiscountStatus {
  if (!state.active) return "inactive";
  if (state.expiresAt && state.expiresAt.getTime() <= now.getTime()) return "expired";
  if (state.usageLimit !== null && state.usageCount >= state.usageLimit) return "used_up";
  return "active";
}
