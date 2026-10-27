// Films a role's chapters into output/clips/ (see README.md).
//   node scripts/demo-videos/record.mjs owner                      films the chapters not filmed yet
//   node scripts/demo-videos/record.mjs owner --only categories,orders   films just these (again)
//   node scripts/demo-videos/record.mjs owner --redo orders        films the missing ones, and this one again
// A chapter that worked is kept, so an AI chapter is filmed once unless it is asked for again.
import { runChapters } from './lib.mjs'

const role = process.argv[2]
const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1].split(',').map((s) => s.trim()) : undefined
}
const ROLES = ['owner', 'manager', 'cashier', 'customer']
if (!ROLES.includes(role)) {
  console.log(`Usage: node scripts/demo-videos/record.mjs <${ROLES.join('|')}> [--only a,b] [--redo a,b]`)
  process.exit(1)
}
const { chapters } = await import(`./roles/${role}.mjs`)
const only = flag('only')
const redo = flag('redo')
const unknown = [...(only ?? []), ...(redo ?? [])].filter((s) => !chapters.some((c) => c.slug === s))
if (unknown.length) {
  console.log(`No such chapter: ${unknown.join(', ')}. Chapters: ${chapters.map((c) => c.slug).join(', ')}`)
  process.exit(1)
}
console.log(`Filming the ${role} walkthrough (${chapters.length} chapters)`)
const results = await runChapters(role, chapters, { only, redo })
// The Owner video signs up a store live, which cannot carry the demo prefix: remove it straight away,
// so it never counts as a real shop.
if (role === 'owner' && results.some((r) => r && r.id?.endsWith('-sign-up') && !r.error && (!only || only.includes('sign-up')))) {
  const { execFileSync } = await import('node:child_process')
  const { join } = await import('node:path')
  const { REPO } = await import('./lib.mjs')
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/demo-videos.ts', 'remove-signups'], { cwd: join(REPO, 'backend'), stdio: 'inherit', shell: process.platform === 'win32' })
}
const failed = results.filter((r) => r && r.error)
console.log(failed.length ? `\n${failed.length} chapter(s) failed: ${failed.map((r) => r.id).join(', ')}. Film them again with --only.` : '\nAll chapters filmed.')
process.exit(failed.length ? 1 : 0)
