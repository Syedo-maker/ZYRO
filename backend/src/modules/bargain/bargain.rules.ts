/**
 * The haggling rules (Part G, "bhao-taao"). Pure arithmetic, no database and no AI.
 *
 * **The safety property this file exists to guarantee: the shop can never offer below the merchant's
 * floor price, whatever the shopper types.**
 *
 * That is not achieved by telling a model not to. It is achieved by never giving the model a way to
 * say a number at all. The assistant chooses one word from `MOVES`; this code turns that word into a
 * price, from the list price and the floor, and clamps the result. A completely compromised model,
 * one that has been talked into anything by any prompt injection, can still only pick one of six
 * words, and all six map to a price at or above the floor.
 *
 * The floor itself never appears in a prompt, so it cannot be leaked by the model either.
 */

/** The only things the assistant may decide. Anything else is read as "hold". */
export const MOVES = ["hold", "small_concession", "meet_middle", "final_offer", "accept", "decline"] as const;
export type Move = (typeof MOVES)[number];

/** How many times a shopper may push before the shop stops moving. Keeps a long chat from grinding the price down. */
export const MAX_ROUNDS = 6;

/** A small concession is this share of the gap between what is on offer now and the floor. */
const SMALL_STEP = 0.25;
/** A final offer goes this far down the remaining gap; never the whole way, so the floor stays the merchant's. */
const FINAL_STEP = 0.8;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BargainState {
  listPrice: number;
  floorPrice: number;
  /** The best price the shop has offered so far. Starts at the list price. */
  currentOffer: number;
  /** What the shopper last asked to pay, when they named a number. */
  shopperOffer: number | null;
  rounds: number;
}

export interface BargainDecision {
  move: Move;
  /** What the shop will now accept. Always between the floor and the current offer, inclusive. */
  price: number;
  /** True when the haggling is over: the shopper's number was met, or the shop has stopped. */
  settled: boolean;
  outcome: "open" | "agreed" | "declined";
}

/**
 * Turns the assistant's chosen move into a price.
 *
 * Every path is clamped to the floor at the end, so no combination of move, state or arithmetic can
 * produce a number below it. `accept` is only ever honoured when the shopper's own offer is at or
 * above the floor; otherwise it is treated as a final offer, because a model that has been persuaded
 * to "accept" a 1-rupee offer must not be able to.
 */
export function applyMove(move: Move, state: BargainState): BargainDecision {
  const floor = state.floorPrice;
  const current = state.currentOffer;
  const clamp = (n: number) => round2(Math.min(Math.max(n, floor), state.listPrice));

  // Out of rounds: the shop holds wherever it is, whatever the assistant said.
  if (state.rounds >= MAX_ROUNDS && move !== "accept") {
    return { move: "final_offer", price: clamp(current), settled: true, outcome: "declined" };
  }

  switch (move) {
    case "accept": {
      const asked = state.shopperOffer;
      // The shopper's number is only acceptable if it clears the floor. Otherwise this is a final offer.
      if (asked !== null && asked >= floor && asked <= state.listPrice) {
        return { move: "accept", price: clamp(asked), settled: true, outcome: "agreed" };
      }
      return { move: "final_offer", price: clamp(floor), settled: true, outcome: "open" };
    }
    case "decline":
      return { move: "decline", price: clamp(current), settled: true, outcome: "declined" };
    case "small_concession":
      return { move, price: clamp(current - (current - floor) * SMALL_STEP), settled: false, outcome: "open" };
    case "meet_middle": {
      // Half way between what is on offer and what the shopper asked, never below the floor.
      const target = state.shopperOffer !== null ? (current + Math.max(state.shopperOffer, floor)) / 2 : current - (current - floor) / 2;
      return { move, price: clamp(target), settled: false, outcome: "open" };
    }
    case "final_offer":
      return { move, price: clamp(current - (current - floor) * FINAL_STEP), settled: true, outcome: "open" };
    case "hold":
    default:
      return { move: "hold", price: clamp(current), settled: false, outcome: "open" };
  }
}

/** Reads the assistant's reply as a move. Anything unrecognised is "hold": the safest thing to do. */
export function parseMove(text: string): Move {
  const found = text.toLowerCase().match(/\b(hold|small_concession|meet_middle|final_offer|accept|decline)\b/);
  return (found?.[1] as Move) ?? "hold";
}

/**
 * The number a shopper named, if any, from what they typed. Used only to decide whether their offer
 * clears the floor; it is never trusted as a price to charge.
 */
export function parseShopperOffer(text: string, listPrice: number): number | null {
  const cleaned = text.replace(/,/g, "");
  const numbers = (cleaned.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return null;
  // The largest plausible number: shoppers write "2000 kardo" and sometimes a quantity too.
  const plausible = numbers.filter((n) => n <= listPrice * 2);
  return plausible.length > 0 ? round2(Math.max(...plausible)) : null;
}

/**
 * What the assistant is allowed to know. Deliberately no floor, no cost, no margin: there is nothing
 * here that could leak a number the merchant would not want a shopper to see, because the only
 * numbers are the list price and the shopper's own offer, both of which the shopper already knows.
 */
export function describeForAssistant(state: BargainState, productTitle: string, currency: string): string {
  const lines = [
    `Product: ${productTitle}`,
    `Listed price: ${currency} ${state.listPrice.toFixed(2)}`,
    `Price the shop has offered so far: ${currency} ${state.currentOffer.toFixed(2)}`,
    state.shopperOffer !== null ? `What the shopper is asking to pay: ${currency} ${state.shopperOffer.toFixed(2)}` : "The shopper has not named a price yet.",
    `Rounds of haggling so far: ${state.rounds} of ${MAX_ROUNDS}`,
  ];
  return lines.join("\n");
}
