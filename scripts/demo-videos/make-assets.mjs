// Makes everything the videos need that is not the app itself, all from code:
//   assets/products/*.png   simple product pictures for the demo store (an emoji on a soft background)
//   assets/receipt.png      a demo bank-transfer receipt a shopper uploads (fake bank, fake numbers)
//   assets/voice-note.wav   the owner's spoken voice note, from Windows' built-in offline speech
//   output/cards/*.png      the title card for each role and the end card
// Run: node scripts/demo-videos/make-assets.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, ASSETS, OUT, SIZE, CREDITS, FFMPEG, ensureDir } from './lib.mjs'

export const PRODUCTS = [
  { file: 'clay-chai-cup', emoji: '☕', from: '#f6e7d8', to: '#e9c9a8' },
  { file: 'copper-kettle', emoji: '🫖', from: '#f3e3d3', to: '#d9a27a' },
  { file: 'steel-pateela', emoji: '🍲', from: '#eceff1', to: '#c7cfd4' },
  { file: 'lawn-suit', emoji: '👗', from: '#fbe4ec', to: '#f2b8cb' },
  { file: 'embroidered-kurta', emoji: '👘', from: '#e3f0ea', to: '#a9d3c0' },
  { file: 'winter-shawl', emoji: '🧣', from: '#f8e1dc', to: '#e4a596' },
  { file: 'scented-candle', emoji: '🕯️', from: '#fdf3d8', to: '#f1d58e' },
  { file: 'brass-lamp', emoji: '🪔', from: '#fbecd2', to: '#e7bd6e' },
  // Uploaded live in the Owner video's "add a product" chapter.
  { file: 'tea-tray', emoji: '🍵', from: '#e8f1e4', to: '#b9d4ab' },
]

const ROLES = ['Owner', 'Manager', 'Cashier', 'Customer']

const card = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:${SIZE.width}px;height:${SIZE.height}px;background:#0B3B33;color:#F4F3EE;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 160px;position:relative;overflow:hidden}
  .ring{position:absolute;right:-220px;top:-220px;width:760px;height:760px;border-radius:50%;border:90px solid rgba(232,112,61,.16)}
  .ring2{position:absolute;right:120px;bottom:-300px;width:520px;height:520px;border-radius:50%;background:rgba(221,227,219,.06)}
  .uni{font-size:30px;font-weight:600;letter-spacing:.04em;color:#DDE3DB;text-transform:uppercase}
  .prog{font-size:26px;color:#DDE3DB;opacity:.85;margin-top:10px}
  h1{font-size:132px;font-weight:800;letter-spacing:-.02em;margin-top:48px;line-height:1}
  .role{display:inline-block;margin-top:28px;background:#E8703D;color:#0B3B33;font-size:46px;font-weight:800;padding:10px 30px;border-radius:14px}
  .sub{font-size:30px;margin-top:22px;color:#DDE3DB}
  .people{margin-top:64px;display:flex;gap:80px;font-size:28px;line-height:1.5}
  .people b{display:block;font-size:34px;color:#F4F3EE}
  .people span{color:#DDE3DB;opacity:.9}
  .foot{position:absolute;left:160px;bottom:70px;font-size:22px;color:#DDE3DB;opacity:.75}
</style></head><body><div class="ring"></div><div class="ring2"></div>${body}</body></html>`

const credits = () => `
  <div class="people">
    ${CREDITS.students.map(([n, id]) => `<div><b>${n}</b><span>${id}</span></div>`).join('')}
    <div><b>${CREDITS.supervisor}</b><span>Supervisor</span></div>
  </div>`

const titleCard = (role) =>
  card(`
  <div class="uni">${CREDITS.university}</div>
  <div class="prog">${CREDITS.programme} &middot; ${CREDITS.year}</div>
  <h1>${CREDITS.project}</h1>
  <div><span class="role">${role} walkthrough</span></div>
  <div class="sub">Commerce, point of sale and AI for small shops, recorded from the running app</div>
  ${credits()}
  <div class="foot">Demo store and demo accounts only. No real shop, customer or key is shown.</div>`)

const endCard = () =>
  card(`
  <div class="uni">${CREDITS.university}</div>
  <h1 style="font-size:120px">Thank you</h1>
  <div class="sub">${CREDITS.project} &middot; ${CREDITS.year} &middot; ${CREDITS.programme}</div>
  ${credits()}
  <div class="foot">Every scene was filmed with Playwright from the running app; captions added with ffmpeg. No AI video generation.</div>`)

const productTile = (p) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:800px;height:800px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 35% 30%, ${p.from}, ${p.to})}
  span{font-size:420px;line-height:1;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif;filter:drop-shadow(0 30px 40px rgba(0,0,0,.18))}
</style></head><body><span>${p.emoji}</span></body></html>`

const receipt = () => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:720px;height:1100px;background:#f2f4f7;font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:flex-start;padding-top:60px}
  .r{width:600px;background:#fff;border-radius:22px;padding:44px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
  .ok{width:90px;height:90px;border-radius:50%;background:#16a34a;color:#fff;font-size:56px;display:flex;align-items:center;justify-content:center;margin:0 auto}
  h2{text-align:center;margin:22px 0 4px;font-size:30px}.amt{text-align:center;font-size:52px;font-weight:800;margin:10px 0 30px}
  dl{display:grid;grid-template-columns:1fr auto;gap:14px;font-size:22px;margin:0}dt{color:#667085}dd{margin:0;font-weight:600;text-align:right}
  .demo{margin-top:34px;text-align:center;color:#b42318;font-weight:700;font-size:20px}
</style></head><body><div class="r"><div class="ok">✓</div><h2>Transfer successful</h2><div class="amt">Rs 6,250</div>
<dl><dt>To</dt><dd>Chai &amp; Clay Co. (demo)</dd><dt>Bank</dt><dd>Demo Bank</dd><dt>Account</dt><dd>PK00 DEMO 0000 0000</dd><dt>Reference</dt><dd>DEMO-48213</dd><dt>Date</dt><dd>Today</dd></dl>
<div class="demo">DEMO RECEIPT, NOT A REAL TRANSFER</div></div></body></html>`

/** The voice note, spoken by Windows' built-in speech synthesizer (offline, no AI service). */
function voiceNote(file) {
  const text = 'Set the price of brass lamp to seven thousand five hundred rupees.'
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1;` +
    ` $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono);` +
    ` $s.SetOutputToWaveFile('${file.replace(/'/g, "''")}', $f); $s.Speak('${text}'); $s.Dispose()`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
  // Chrome's fake microphone plays the file in a loop: a second and a half of silence after the
  // sentence lets the recording stop before it starts again.
  const padded = file.replace(/\.wav$/, '-padded.wav')
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', 'apad=pad_dur=1.5', padded])
  renameSync(padded, file)
}

async function main() {
  ensureDir(join(ASSETS, 'products'))
  ensureDir(join(OUT, 'cards'))
  const browser = await chromium.launch()
  const shot = async (html, path, size) => {
    const page = await browser.newPage({ viewport: size })
    await page.setContent(html)
    await page.waitForTimeout(300)
    await page.screenshot({ path })
    await page.close()
  }
  for (const p of PRODUCTS) {
    const f = join(ASSETS, 'products', `${p.file}.png`)
    if (!existsSync(f)) await shot(productTile(p), f, { width: 800, height: 800 })
  }
  if (!existsSync(join(ASSETS, 'receipt.png'))) await shot(receipt(), join(ASSETS, 'receipt.png'), { width: 720, height: 1100 })
  for (const role of ROLES) await shot(titleCard(role), join(OUT, 'cards', `title-${role.toLowerCase()}.png`), SIZE)
  await shot(endCard(), join(OUT, 'cards', 'end.png'), SIZE)
  await browser.close()
  if (!existsSync(join(ASSETS, 'voice-note.wav'))) voiceNote(join(ASSETS, 'voice-note.wav'))
  console.log('Assets ready: product pictures, receipt, voice note, title and end cards.')
}

if (process.argv[1] && process.argv[1].endsWith('make-assets.mjs')) main().catch((e) => { console.error(e); process.exit(1) })
