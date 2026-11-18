// CI check of the database migrations (production readiness, 2026-11).
//
// A migration that destroys data (drops a table or a column, deletes or truncates rows, changes a
// column's type) must say so in a line starting with "-- destructive:" and explaining why, so it is
// never merged by accident. Dropping an index or a constraint loses no data and needs no note.
// Every migration must also have a rollback file in prisma/rollbacks unless it is listed below as
// predating that rule.
//
//   node scripts/check-migrations.mjs        exit 0 when every migration passes, 1 otherwise
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../prisma/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const migrations = join(root, 'migrations')
const rollbacks = join(root, 'rollbacks')

// Written and applied before these rules existed. Editing an applied migration would change its
// checksum and break `prisma migrate deploy`, so they are accepted as they are.
const BEFORE_DESTRUCTIVE_NOTES = new Set(['20261022000000_remove_bargaining'])
const FIRST_WITH_ROLLBACK_RULE = '20261101000000'

const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i,
  /\bDROP\s+TYPE\b/i,
]

let problems = 0
const dirs = readdirSync(migrations, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
for (const name of dirs) {
  const sql = readFileSync(join(migrations, name, 'migration.sql'), 'utf8')
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const hits = DESTRUCTIVE.filter((re) => re.test(code))
  if (hits.length > 0 && !/^--\s*destructive:\s*\S/im.test(sql) && !BEFORE_DESTRUCTIVE_NOTES.has(name)) {
    console.log(`FAIL  ${name}: destroys data (${hits.map((h) => h.source.replace(/\\[sbW]\+?/g, ' ').replace(/\s+/g, ' ').trim()).join(', ')}) without a "-- destructive: <why>" line`)
    problems++
  }
  if (name >= FIRST_WITH_ROLLBACK_RULE && !existsSync(join(rollbacks, `${name}.down.sql`))) {
    console.log(`FAIL  ${name}: no rollback file prisma/rollbacks/${name}.down.sql`)
    problems++
  }
}
console.log(problems === 0 ? `All ${dirs.length} migrations pass.` : `${problems} problem(s).`)
process.exit(problems === 0 ? 0 : 1)
