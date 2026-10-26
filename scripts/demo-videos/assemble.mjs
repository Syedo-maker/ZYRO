// Turns a role's filmed chapters into one video (see README.md):
//   node scripts/demo-videos/assemble.mjs owner
// Each chapter is cut to where it starts, its captions are burned in (with the chapter's name above
// them), the title and end cards are added, and everything is joined into one silent H.264 mp4 with
// chapter markers. Also writes the chapter list with timestamps.
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync, statSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { FFMPEG, FFPROBE, OUT, SIZE, BAND, readJson, ensureDir } from './lib.mjs'

const role = process.argv[2]
const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', customer: 'Customer' }
if (!ROLE_NAMES[role]) {
  console.log('Usage: node scripts/demo-videos/assemble.mjs <owner|manager|cashier|customer>')
  process.exit(1)
}
const CARD_SECONDS = 6
const FPS = 30
const work = ensureDir(join(OUT, 'work', role))
// The caption font, copied next to the subtitles so ffmpeg finds it without a system font setup.
const fonts = ensureDir(join(work, 'fonts'))
for (const f of ['segoeui.ttf', 'segoeuib.ttf']) {
  const from = join(process.env.WINDIR ?? 'C:/Windows', 'Fonts', f)
  if (existsSync(from) && !existsSync(join(fonts, f))) copyFileSync(from, join(fonts, f))
}
const ff = (args, cwd) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
const duration = (file) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim())

// Same look as the cards: a deep green band across the bottom, cream text, the chapter's name in orange.
const assTime = (s) => {
  const t = Math.max(0, s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = (t % 60).toFixed(2).padStart(5, '0')
  return `${h}:${String(m).padStart(2, '0')}:${sec}`
}
const assText = (s) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, '\\N')
function captions(file, chapterLabel, cues, length) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Segoe UI,34,&H00EEF3F4,&H00EEF3F4,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,200,200,34,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = cues.map((c, i) => {
    const end = i + 1 < cues.length ? cues[i + 1].t : length
    return `Dialogue: 0,${assTime(c.t)},${assTime(end)},Caption,,0,0,0,,{\\fs24\\b1\\c&H3D70E8&}${assText(chapterLabel)}\\N{\\r}${assText(c.text)}`
  })
  writeFileSync(file, head + lines.join('\n') + '\n')
}

/**
 * Chapters filmed in the app window (1920x930) get the caption band added below them; older ones,
 * filmed at the full 1920x1080, get it drawn over their bottom edge (their pages were padded so
 * nothing important sits there).
 */
const height = (file) => Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'default=nw=1:nk=1', file]).toString().trim())
const frame = (file) =>
  height(file) >= SIZE.height
    ? `drawbox=x=0:y=ih-${BAND}:w=iw:h=${BAND}:color=0x0B3B33@0.95:t=fill`
    : `scale=${SIZE.width}:${SIZE.height - BAND},pad=${SIZE.width}:${SIZE.height}:0:0:color=0x0B3B33`

const chapters = readJson(join(OUT, `${role}-chapters.json`), null)
if (!chapters) {
  console.log(`Nothing filmed for ${role} yet: run record.mjs ${role} first.`)
  process.exit(1)
}
const parts = []
const marks = []
let at = CARD_SECONDS

// The title card.
const title = join(work, '00-title.mp4')
ff(['-loop', '1', '-t', String(CARD_SECONDS), '-i', join(OUT, 'cards', `title-${role}.png`), '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage', title])
parts.push(title)

for (const c of chapters) {
  const meta = readJson(join(OUT, 'clips', `${c.id}.json`), null)
  if (!meta || meta.error || !existsSync(meta.file)) {
    console.log(`  missing  ${c.id}: ${meta?.error ?? 'not filmed'}; left out`)
    continue
  }
  const length = meta.end - meta.start
  const ass = `${c.id}.ass`
  captions(join(work, ass), `${c.index} · ${c.title}`, meta.cues, length)
  const out = join(work, `${c.id}.mp4`)
  // Run from the work folder, so the subtitles filter gets a plain relative path (no drive colon to escape).
  ff(['-ss', meta.start.toFixed(2), '-i', meta.file, '-t', length.toFixed(2), '-vf', `fps=${FPS},${frame(meta.file)},subtitles=${ass}:fontsdir=fonts,format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', out], work)
  marks.push({ index: c.index, title: c.title, start: at })
  at += duration(out)
  parts.push(out)
  console.log(`  ready    ${c.id} (${length.toFixed(0)} s)`)
}

// The end card.
const end = join(work, '99-end.mp4')
ff(['-loop', '1', '-t', String(CARD_SECONDS), '-i', join(OUT, 'cards', 'end.png'), '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage', end])
parts.push(end)
const total = at + CARD_SECONDS

// Chapter markers, so a player (VLC, MPC, QuickTime) can jump straight to a feature.
const meta = [';FFMETADATA1', `title=ShopMind AI: ${ROLE_NAMES[role]} walkthrough`, 'artist=Muhammad Ibrahim and Syed Sikander Gillani']
const allMarks = [{ title: 'Title', start: 0 }, ...marks, { title: 'End', start: total - CARD_SECONDS }]
allMarks.forEach((m, i) => {
  const next = i + 1 < allMarks.length ? allMarks[i + 1].start : total
  meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(m.start * 1000)}`, `END=${Math.round(next * 1000)}`, `title=${m.index ? `${m.index}. ${m.title}` : m.title}`)
})
writeFileSync(join(work, 'chapters.ffmeta'), meta.join('\n') + '\n')
writeFileSync(join(work, 'parts.txt'), parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n') + '\n')

const video = join(OUT, `shopmind-ai-${role}-walkthrough.mp4`)
rmSync(video, { force: true })
ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'parts.txt'), '-i', join(work, 'chapters.ffmeta'), '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', video])

const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const list = [`# ShopMind AI: ${ROLE_NAMES[role]} walkthrough`, '', `Length ${stamp(total)}. Silent; the captions say what is happening.`, '', '| Time | Chapter |', '|---|---|', ...marks.map((m) => `| ${stamp(m.start)} | ${m.index}. ${m.title} |`), '']
writeFileSync(join(OUT, `shopmind-ai-${role}-chapters.md`), list.join('\n'))
writeFileSync(join(work, 'marks.json'), JSON.stringify({ video, total, marks }, null, 2))
console.log(`\n${video}\n${(statSync(video).size / 1024 / 1024).toFixed(1)} MB, ${stamp(total)}, ${marks.length} chapters`)
