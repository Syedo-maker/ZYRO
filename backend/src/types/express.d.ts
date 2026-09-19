import "express";
import type { CartOwner } from "../modules/cart/cart.service";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth once the access token is verified. */
      userId?: string;
      /** Set by resolveCartOwner: the logged-in user or the guest session that owns the cart. */
      cartOwner?: CartOwner;
    }
  }
}
