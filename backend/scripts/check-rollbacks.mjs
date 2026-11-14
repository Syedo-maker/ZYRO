// CI check that the migration rollbacks work (production readiness, 2026-11).
//
// On a DISPOSABLE database that already has every migration applied: runs each rollback file in
// prisma/rollbacks from newest to oldest, then applies the migrations again with `prisma migrate
// deploy`, then checks the database matches schema.prisma exactly. A rollback that fails, leaves
// something behind, or cannot be re-applied fails the check.
//
// It drops tables, so it refuses to run unless ZYRO_DISPOSABLE_DB=1 is set. Never point it at a
// database with real data.
//
//   ZYRO_DISPOSABLE_DB=1 DATABASE_URL=postgresql://... node scripts/check-rollbacks.mjs
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

if (process.env.ZYRO_DISPOSABLE_DB !== '1') {
  console.error('Refusing to run: this drops tables. Set ZYRO_DISPOSABLE_DB=1 only for a throwaway database (CI).')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const prisma = (...args) => execFileSync('npx', ['prisma', ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' })
const files = readdirSync('prisma/rollbacks').filter((f) => f.endsWith('.down.sql')).sort().reverse()

for (const file of files) {
  prisma('db', 'execute', '--file', `prisma/rollbacks/${file}`, '--schema', 'prisma/schema.prisma')
  console.log(`rolled back  ${file.replace('.down.sql', '')}`)
}
prisma('migrate', 'deploy')
console.log(`re-applied   ${files.length} migration(s)`)
try {
  prisma('migrate', 'diff', '--from-url', process.env.DATABASE_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code')
  console.log('The database matches schema.prisma: every rollback undid its migration cleanly.')
} catch {
  console.error('FAIL: after rolling back and re-applying, the database does not match schema.prisma.')
  process.exit(1)
}
