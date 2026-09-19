import bcrypt from "bcryptjs";

// Cost factor 12, per Implementation_Plan.md Phase 1.
const SALT_ROUNDS = 12;

// bcrypt only reads the first 72 bytes of a password, so anything longer would be silently
// truncated. Registration rejects longer passwords instead (auth.validation.ts).
export const MAX_PASSWORD_BYTES = 72;

let dummyHash: Promise<string> | undefined;

export const password = {
  hash: (plain: string): Promise<string> => bcrypt.hash(plain, SALT_ROUNDS),
  verify: (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash),

  /**
   * Spends the same time as a real password check. Called when a login names an email that
   * has no account, so the response time does not reveal which emails are registered.
   */
  async burnTime(plain: string): Promise<void> {
    dummyHash ??= bcrypt.hash("zyro-timing-equalizer", SALT_ROUNDS);
    await bcrypt.compare(plain, await dummyHash);
  },
};
