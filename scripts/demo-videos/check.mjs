// Pulls frames out of a finished video to look at before using it (see README.md):
//   node scripts/demo-videos/check.mjs owner
// For every chapter: one frame early on and one near the end, into output/frames/<role>/. Look at
// them for blank pages, error messages, spinners left on screen, or the wrong role's pages. Also
// lists what the recorder noticed while filming (script errors, server errors).
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { rmSync, readdirSync } from 'node:fs'
import { FFMPEG, OUT, readJson, ensureDir } from './lib.mjs'

const role = process.argv[2]
const marks = readJson(join(OUT, 'work', role ?? '', 'marks.json'), null)
if (!marks) {
  console.log('Usage: node scripts/demo-videos/check.mjs <owner|manager|cashier|customer> (after assemble.mjs)')
  process.exit(1)
}
const dir = join(OUT, 'frames', role)
rmSync(dir, { recursive: true, force: true })
ensureDir(dir)
const chapters = readJson(join(OUT, `${role}-chapters.json`), [])
const ends = marks.marks.map((m, i) => (i + 1 < marks.marks.length ? marks.marks[i + 1].start : marks.total - 6))
marks.marks.forEach((m, i) => {
  const length = ends[i] - m.start
  for (const [tag, t] of [['a', m.start + Math.min(3, length * 0.2)], ['b', m.start + length * 0.85]]) {
    const file = join(dir, `${String(m.index).padStart(2, '0')}${tag}.png`)
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', marks.video, '-frames:v', '1', '-vf', 'scale=960:-1', file])
  }
})
// Contact sheets: eight frames to an image, in chapter order, for a quick look at the whole video.
const files = readdirSync(dir).filter((f) => /^\d+[ab]\.png$/.test(f)).sort()
for (let i = 0; i < files.length; i += 8) {
  const group = files.slice(i, i + 8)
  const inputs = group.flatMap((f) => ['-i', join(dir, f)])
  const label = (k, f) => `[${k}:v]scale=480:-1,drawtext=text='${f.replace('.png', '')}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:fontfile='C\\:/Windows/Fonts/segoeuib.ttf'[v${k}]`
  const cells = group.map((f, k) => label(k, f)).join(';')
  const pads = group.length < 8 ? Array.from({ length: 8 - group.length }, (_, k) => `color=c=white:s=480x270:d=1[p${k}]`).join(';') + ';' : ''
  const order = [...group.map((_, k) => `[v${k}]`), ...Array.from({ length: 8 - group.length }, (_, k) => `[p${k}]`)].join('')
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${cells};${pads}${order}xstack=inputs=8:layout=0_0|480_0|960_0|1440_0|0_270|480_270|960_270|1440_270[out]`, '-map', '[out]', '-frames:v', '1', join(dir, `sheet-${String(i / 8 + 1).padStart(2, '0')}.png`)])
}
console.log(`Frames and contact sheets in ${dir} (a = early in the chapter, b = near its end).`)
for (const c of chapters) {
  const meta = readJson(join(OUT, 'clips', `${c.id}.json`), null)
  if (meta?.problems?.length) console.log(`  ${c.id}: ${meta.problems.join('; ')}`)
}
