// Copies the demo product pictures into the built site (dist/demo-assets/products), so a demo store
// can show them on a host whose own disk is temporary (backend/scripts/seed-demo.ts, DEMO_IMAGE_BASE_URL).
// Only used by the Vercel build. Skips quietly if the pictures are not available.
import fs from 'node:fs'
import path from 'node:path'

const frontend = path.resolve(import.meta.dirname, '..')
const from = path.resolve(frontend, '..', 'scripts', 'demo-videos', 'assets', 'products')
const to = path.join(frontend, 'dist', 'demo-assets', 'products')
if (!fs.existsSync(from)) {
  console.log('No demo product pictures found; skipping.')
  process.exit(0)
}
fs.mkdirSync(to, { recursive: true })
const files = fs.readdirSync(from).filter((f) => f.endsWith('.png'))
for (const f of files) fs.copyFileSync(path.join(from, f), path.join(to, f))
console.log(`Copied ${files.length} demo product pictures.`)
