import { prisma } from "../../lib/prisma";
import { password as passwordLib } from "../../lib/password";
import { accessToken } from "../../lib/jwt";
import { refreshToken as refreshTokenLib } from "../../lib/refreshToken";
import { Errors } from "../../errors/AppError";
import type { RegisterInput, LoginInput } from "./auth.validation";

interface Session {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; email: string; name: string | null };
}

async function issueSession(userId: string, email: string, name: string | null): Promise<Session> {
  const { raw, hash, expiresAt } = refreshTokenLib.generate();
  await prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } });

  return {
    accessToken: accessToken.sign(userId),
    refreshToken: raw,
    refreshTokenExpiresAt: expiresAt,
    user: { id: userId, email, name },
  };
}

export const authService = {
  /** Creates a User (merchant owner) and their first Tenant in one transaction. */
  async register(input: RegisterInput): Promise<Session> {
    const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingEmail) throw Errors.emailTaken();

    const existingSlug = await prisma.tenant.findUnique({ where: { slug: input.storeSlug } });
    if (existingSlug) throw Errors.slugTaken();

    const passwordHash = await passwordLib.hash(input.password);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email: input.email, passwordHash },
      });
      await tx.tenant.create({
        data: { name: input.storeName, slug: input.storeSlug, ownerId: createdUser.id },
      });
      return createdUser;
    });

    return issueSession(user.id, user.email, user.name);
  },

  async login(input: LoginInput): Promise<Session> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw Errors.invalidCredentials();

    const valid = await passwordLib.verify(input.password, user.passwordHash);
    if (!valid) throw Errors.invalidCredentials();

    return issueSession(user.id, user.email, user.name);
  },

  /** Rotates the refresh token: the old one is deleted so it can't be replayed. */
  async refresh(rawRefreshToken: string): Promise<Session> {
    const tokenHash = refreshTokenLib.hash(rawRefreshToken);
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.expiresAt < new Date()) {
      throw Errors.invalidRefreshToken();
    }

    await prisma.refreshToken.delete({ where: { id: existing.id } });
    return issueSession(existing.user.id, existing.user.email, existing.user.name);
  },

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = refreshTokenLib.hash(rawRefreshToken);
    // Deletes silently if already gone (e.g. double logout) — logout is idempotent.
    await prisma.refreshToken.deleteMany({ where: { tokenHash } });
  },
};
