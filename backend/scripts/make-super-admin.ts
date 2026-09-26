/**
 * Makes an existing user a platform administrator (can open the /platform view of per-store
 * totals). This is the only way to grant the role; the API cannot.
 * Usage: npx tsx scripts/make-super-admin.ts someone@example.com
 *        npx tsx scripts/make-super-admin.ts someone@example.com --remove
 */
import { prismaUnscoped } from "../src/lib/prisma";

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: npx tsx scripts/make-super-admin.ts <email> [--remove]");
    process.exit(1);
  }
  const role = flag === "--remove" ? "USER" : "SUPER_ADMIN";
  const result = await prismaUnscoped.user.updateMany({ where: { email }, data: { platformRole: role } });
  console.log(result.count === 0 ? `No user with the email ${email}` : `${email} is now ${role}`);
  await prismaUnscoped.$disconnect();
  process.exit(result.count === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
