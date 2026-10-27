// Pulls frames out of a finished video to look at before using it (see README.md):
//   node scripts/demo-videos/check.mjs owner
// For every chapter: a frame early on and one near its end, and a frame at every click, field,
// scroll and result the recorder announced (while its label is on screen), into
// output/frames/<role>/, plus contact sheets of twelve. Look at them for a missing or unreadable
// indicator, anything covered or cut off, blank pages, error messages, spinners left on screen, or
// the wrong role's pages. Also lists what the recorder noticed while filming (script and server errors).
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
const frame = (t, file, width = 960) =>
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', marks.video, '-frames:v', '1', '-vf', `scale=${width}:-1`, file])

const chapters = readJson(join(OUT, `${role}-chapters.json`), [])
const ends = marks.marks.map((m, i) => (i + 1 < marks.marks.length ? marks.marks[i + 1].start : marks.total - 6))
let actions = 0
marks.marks.forEach((m, i) => {
  const n = String(m.index).padStart(2, '0')
  const length = ends[i] - m.start
  frame(m.start + Math.min(3, length * 0.2), join(dir, `${n}a.png`))
  frame(m.start + length * 0.85, join(dir, `${n}b.png`))
  // Every announced action, 0.6 s after its label appears (the label shows for about a second first).
  const c = chapters.find((x) => x.index === m.index)
  const clip = c && readJson(join(OUT, 'clips', `${c.id}.json`), null)
  for (const [k, a] of (clip?.marks ?? []).entries()) {
    frame(m.start + a.t + 0.6, join(dir, `${n}-${String(k + 1).padStart(2, '0')}.png`), 960)
    actions++
  }
})

// Contact sheets of twelve (4 x 3), each frame labelled with its chapter and action number.
const sheet = (files, name) => {
  const per = 12
  for (let i = 0; i < files.length; i += per) {
    const group = files.slice(i, i + per)
    const inputs = group.flatMap((f) => ['-i', join(dir, f)])
    const cells = group.map((f, k) => `[${k}:v]scale=480:-1,drawtext=text='${f.replace('.png', '')}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65:fontfile='C\\:/Windows/Fonts/segoeuib.ttf'[v${k}]`).join(';')
    const blanks = per - group.length
    const pads = blanks ? Array.from({ length: blanks }, (_, k) => `color=c=white:s=480x270:d=1[p${k}]`).join(';') + ';' : ''
    const order = [...group.map((_, k) => `[v${k}]`), ...Array.from({ length: blanks }, (_, k) => `[p${k}]`)].join('')
    const layout = Array.from({ length: per }, (_, k) => `${(k % 4) * 480}_${Math.floor(k / 4) * 270}`).join('|')
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${cells};${pads}${order}xstack=inputs=${per}:layout=${layout}[out]`, '-map', '[out]', '-frames:v', '1', join(dir, `${name}-${String(i / per + 1).padStart(2, '0')}.png`)])
  }
}
const all = readdirSync(dir)
sheet(all.filter((f) => /^\d+[ab]\.png$/.test(f)).sort(), 'sheet-chapters')
sheet(all.filter((f) => /^\d+-\d+\.png$/.test(f)).sort(), 'sheet-actions')
console.log(`${actions} announced actions. Frames and contact sheets in ${dir}.`)
for (const c of chapters) {
  const meta = readJson(join(OUT, 'clips', `${c.id}.json`), null)
  if (meta?.problems?.length) console.log(`  ${c.id}: ${meta.problems.join('; ')}`)
}
