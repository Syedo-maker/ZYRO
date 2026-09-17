import bcrypt from "bcryptjs";

// Cost factor 12, per Implementation_Plan.md Phase 1.
const SALT_ROUNDS = 12;

export const password = {
  hash: (plain: string): Promise<string> => bcrypt.hash(plain, SALT_ROUNDS),
  verify: (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash),
};
