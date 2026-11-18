// Scans the built site (frontend/dist, after `npm run build`) for names, academic wording and email
// addresses, so nothing reaches visitors through a file the browser tests do not open.
import fs from 'node:fs'
import path from 'node:path'
import { BANNED_IN_BUNDLE, EMAIL, findBanned } from './banned-public-terms.mjs'

const dist = path.resolve(import.meta.dirname, '..', process.argv[2] ?? 'dist')
if (!fs.existsSync(dist)) {
  console.error(`No build at ${dist}: run npm run build first.`)
  process.exit(1)
}
const files = fs
  .readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(html|js|css|svg|txt|json|xml|webmanifest)$/.test(e.name))
  .map((e) => path.join(e.parentPath, e.name))
let failures = 0
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  const hits = [...findBanned(text, BANNED_IN_BUNDLE), ...new Set(text.match(EMAIL) ?? [])]
  if (hits.length) {
    failures += 1
    console.log(`FAIL  ${path.relative(dist, f)}: ${hits.slice(0, 5).join(', ')}`)
  }
}
console.log(failures ? `\n${failures} built file(s) contain banned text.` : `The built site is clean (${files.length} files scanned).`)
process.exit(failures ? 1 : 0)
