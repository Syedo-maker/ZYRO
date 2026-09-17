import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth once the access token is verified. */
      userId?: string;
    }
  }
}
