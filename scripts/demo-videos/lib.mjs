// Shared pieces of the walkthrough video toolkit (see README.md): where things live, the demo accounts,
// and the recorder that films one chapter at a time with the captions, typing and pauses a viewer needs.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '../..')
// Playwright is already installed for the frontend's browser tests; the toolkit borrows it.
const require = createRequire(join(REPO, 'frontend/package.json'))
export const { chromium } = require('playwright')

export const WEB = process.env.DEMO_WEB ?? 'http://localhost:5173'
export const API = process.env.DEMO_API ?? 'http://localhost:5000/api/v1'
export const FFMPEG = process.env.FFMPEG ?? resolve(REPO, '../tools/ffmpeg/bin/ffmpeg.exe')
export const FFPROBE = process.env.FFPROBE ?? resolve(REPO, '../tools/ffmpeg/bin/ffprobe.exe')
export const OUT = join(HERE, 'output')
export const ASSETS = join(HERE, 'assets')
/** The finished video's frame. */
export const SIZE = { width: 1920, height: 1080 }
/** The caption band under the app, at the bottom of every frame. */
export const BAND = 150
/**
 * The browser window a chapter is filmed in: the frame less the caption band, so the band sits
 * under the app and never covers a button (a full-height screen such as the register has its most
 * important controls at the bottom). Assembly adds the band below.
 */
export const APP = { width: SIZE.width, height: SIZE.height - BAND }

/**
 * The demo accounts. Every one ends in @demo.zyro.local (not a real domain, nothing can be emailed)
 * and starts with "video-", which is how `npm run demo:videos:remove` in backend/ finds them.
 * The password is a demo password for a demo store on a development machine, nothing else.
 */
export const DEMO = {
  password: 'Demo-Video-2026',
  owner: 'video-owner@demo.zyro.local',
  manager: 'video-manager@demo.zyro.local',
  cashier: 'video-cashier@demo.zyro.local',
  storeSlug: 'demo-scout-video-showcase',
  storeName: 'Demo: Chai & Clay Co.',
}

/** The title card text, the same on all four videos but for the role. */
export const CREDITS = {
  project: 'ShopMind AI',
  university: 'Shifa Tameer-e-Millat University',
  programme: 'Bachelor of Science in Artificial Intelligence',
  year: 'Final Year Project 2026',
  students: [
    ['Muhammad Ibrahim', 'BSAI-23F-0048'],
    ['Syed Sikander Gillani', 'BSAI-23F-0062'],
  ],
  supervisor: 'Mr. Saad Ilyas',
}

export const ensureDir = (d) => (existsSync(d) ? d : (mkdirSync(d, { recursive: true }), d))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback)
export const writeJson = (p, v) => (ensureDir(dirname(p)), writeFileSync(p, JSON.stringify(v, null, 2)))

/** The API, as the demo scripts use it (never printing a token). */
export async function api(method, path, { token, body, form } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }
  const res = await fetch(API + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  return { status: res.status, json: await res.json().catch(() => null) }
}

export async function login(email, password = DEMO.password) {
  const res = await api('POST', '/auth/login', { body: { email, password } })
  if (res.status !== 200) throw new Error(`Could not sign in as ${email} (${res.status}). Run "npm run demo:videos:add" in backend/ first.`)
  return res.json.accessToken
}

export async function showcaseStoreId() {
  const token = await login(DEMO.owner)
  const stores = (await api('GET', '/users/me/stores', { token })).json
  const store = stores.find((s) => s.slug === DEMO.storeSlug) ?? stores[0]
  return { token, storeId: store.id }
}

// ---------------------------------------------------------------------------------------------
// Recording one chapter
// ---------------------------------------------------------------------------------------------

/**
 * Films one chapter in its own browser window, so a chapter that fails can be filmed again on its
 * own (an AI chapter is never filmed twice just because a later one failed).
 *
 * The window is 1920x1080 and Playwright records it frame for frame. Captions are not drawn into
 * the page: `say()` writes a timed cue that the assembly step burns in, so they stay put across
 * page loads (the Stripe page included) and never cover what is being clicked.
 *
 * Returns the clip's file, where the useful part starts (after the first page has loaded), and the cues.
 */
export async function filmChapter(browser, { id, title, storageState, permissions, onState }, run) {
  const dir = ensureDir(join(OUT, 'clips'))
  const context = await browser.newContext({
    viewport: APP,
    deviceScaleFactor: 1,
    recordVideo: { dir: ensureDir(join(OUT, 'raw')), size: APP },
    ...(storageState ? { storageState } : {}),
    ...(permissions ? { permissions } : {}),
  })
  // Room at the bottom of the app's pages, so the last section can scroll clear of the caption band
  // the assembly step draws over the bottom 150 pixels. Nothing else on the page changes.
  await context.addInitScript((origin) => {
    if (location.origin !== origin) return
    const style = document.createElement('style')
    style.textContent = 'body::after{content:"";display:block;height:180px}'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  }, new URL(WEB).origin)
  // The drawn cursor, click ripples and labels (overlay.js), on every page the chapter opens.
  await context.addInitScript({ path: join(HERE, 'overlay.js') })
  const page = await context.newPage()
  // Slow set-up (API calls) belongs in the chapter's `before` hook, before this page exists: done in `run`
  // before the first page load, it costs the video frames and puts the marks out of step.
  const t0 = Date.now()
  const problems = []
  page.on('pageerror', (e) => problems.push(`script error: ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api\/v1/, '')}`)
  })
  const cues = []
  const marks = []
  let started = null
  const now = () => (Date.now() - t0) / 1000
  const overlay = (fn, ...args) => page.evaluate(([name, a]) => window.__demoOverlay?.[name]?.(...a), [fn, args]).catch(() => {})

  /**
   * Brings an element into view, saying so when the page has to scroll to reach it, so no scroll
   * goes unannounced.
   */
  async function ensureVisible(locator, label) {
    await locator.waitFor({ state: 'visible', timeout: 20000 })
    const box = await locator.boundingBox()
    const view = page.viewportSize()
    // In view when its top is on screen and it fits below (an element taller than the screen counts
    // as in view once its top is showing): then no scroll, and nothing to announce.
    if (box && box.y >= 0 && box.y + Math.min(box.height, view.height * 0.8) <= view.height - 8) return
    const down = !box || box.y + Math.min(box.height, view.height) / 2 > view.height / 2
    await overlay('hint', (down ? 'Scroll down ↓' : 'Scroll up ↑') + '\n' + label)
    marks.push({ t: now(), label: 'Scroll: ' + label })
    await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    await sleep(1200)
    await overlay('hide')
  }

  /** Moves the drawn cursor to the element, outlines it and labels it ("Click: Add product"). */
  async function point(locator, label) {
    await ensureVisible(locator, label.replace(/^\w+: /, ''))
    const box = await locator.boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const from = await page.evaluate(() => window.__demoOverlay?.position ?? { x: 0, y: 0 }).catch(() => ({ x: 0, y: 0 }))
    const ms = Math.round(Math.max(450, Math.min(1100, 350 + Math.hypot(x - from.x, y - from.y) * 0.55)))
    await overlay('move', x, y, ms)
    await page.mouse.move(x, y, { steps: 8 })
    await sleep(ms + 100)
    await overlay('show', { x: box.x, y: box.y, width: box.width, height: box.height }, label)
    marks.push({ t: now(), label })
    await sleep(1000)
    return { x, y }
  }

  const film = {
    page,
    context,
    /** Marks where the chapter really starts: the first page is up, nothing blank before it. */
    start() {
      started = now()
    },
    /** A caption: what to do and why, in plain words. It stays until the next one, held long enough to read. */
    async say(text, holdMs) {
      if (started === null) started = now()
      cues.push({ t: now(), text })
      await sleep(holdMs ?? Math.max(2400, Math.min(5500, 1000 + text.length * 40)))
    },
    pause: (ms = 900) => sleep(ms),
    /** clickWithIndicator: cursor, outline and "Click: ..." for a second, a ripple, the click, then its result. */
    async click(locator, label, opts = {}) {
      const at = await point(locator, 'Click: ' + label)
      await overlay('ripple', at.x, at.y)
      await locator.click(opts)
      await sleep(350)
      await overlay('hide')
      await sleep(900)
    },
    /** chooseWithIndicator, for radio buttons, check boxes and switches. */
    async choose(locator, label) {
      const at = await point(locator, 'Choose: ' + label)
      await overlay('ripple', at.x, at.y)
      await locator.click()
      await sleep(350)
      await overlay('hide')
      await sleep(700)
    },
    /** typeWithIndicator: outlines the field, labels it "Type: ...", and types at a readable speed. */
    async type(locator, text, label, delay = 70) {
      const at = await point(locator, 'Type: ' + label)
      await overlay('ripple', at.x, at.y)
      await locator.click()
      await locator.fill('')
      await locator.pressSequentially(String(text), { delay })
      await sleep(450)
      await overlay('hide')
      await sleep(400)
    },
    /** selectWithIndicator: a dropdown, with the option chosen in the label. */
    async select(locator, option, label, shown) {
      const at = await point(locator, 'Select: ' + label + ' → ' + (shown ?? (typeof option === 'string' ? option : option.label)))
      await overlay('ripple', at.x, at.y)
      await locator.selectOption(option)
      await sleep(600)
      await overlay('hide')
      await sleep(600)
    },
    /** uploadWithIndicator: points at the visible upload control, then gives the file to its input. */
    async upload(target, input, files, label) {
      const at = await point(target, 'Upload: ' + label)
      await overlay('ripple', at.x, at.y)
      await input.setInputFiles(files)
      await sleep(1500)
      await overlay('hide')
      await sleep(500)
    },
    /** pressWithIndicator: a key, shown on the element it goes to (or mid-screen when none). */
    async press(key, locator, label) {
      if (locator) await point(locator, 'Press: ' + key + (label ? ' (' + label + ')' : ''))
      else {
        await overlay('hint', 'Press: ' + key)
        marks.push({ t: now(), label: 'Press: ' + key })
        await sleep(1000)
      }
      await page.keyboard.press(key)
      await sleep(400)
      await overlay('hide')
      await sleep(700)
    },
    /** hoverWithIndicator. */
    async hover(locator, label, holdMs = 1800) {
      await point(locator, 'Hover: ' + label)
      await sleep(holdMs)
      await overlay('hide')
    },
    /** Scrolls to an element, announced ("Scroll down ↓ ..."). */
    async scrollTo(locator, label) {
      const box = await locator.boundingBox().catch(() => null)
      const down = !box || box.y + Math.min(box.height, page.viewportSize().height) / 2 > page.viewportSize().height / 2
      await overlay('hint', (down ? 'Scroll down ↓' : 'Scroll up ↑') + '\n' + label)
      marks.push({ t: now(), label: 'Scroll: ' + label })
      await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {})
      await sleep(1300)
      await overlay('hide')
    },
    /** Scrolls the page by dy pixels, announced. */
    async scrollBy(dy, label) {
      await overlay('hint', (dy > 0 ? 'Scroll down ↓' : 'Scroll up ↑') + '\n' + label)
      marks.push({ t: now(), label: 'Scroll: ' + label })
      await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), dy)
      await sleep(1300)
      await overlay('hide')
    },
    /** Shows each field of a form for a moment before anything is filled in. */
    async fields(list) {
      for (const [locator, label] of list) {
        if (!(await locator.isVisible().catch(() => false))) continue
        await ensureVisible(locator, label)
        const box = await locator.boundingBox()
        await overlay('show', { x: box.x, y: box.y, width: box.width, height: box.height }, 'Field: ' + label)
        marks.push({ t: now(), label: 'Field: ' + label })
        await sleep(900)
      }
      await overlay('hide')
      await sleep(300)
    },
    /** Holds on an important result, outlined, so the viewer can take it in. */
    async result(locator, label, holdMs = 3500) {
      await ensureVisible(locator, label)
      const box = await locator.boundingBox()
      await overlay('show', { x: box.x, y: box.y, width: box.width, height: box.height }, 'Result: ' + label)
      marks.push({ t: now(), label: 'Result: ' + label })
      await sleep(holdMs)
      await overlay('hide')
    },
    problems,
  }

  let error = null
  try {
    await run(film)
    await sleep(1200)
  } catch (err) {
    error = err
  }
  const end = now()
  // Signing in rotates the session cookie on every page load, so the next chapter starts from this
  // chapter's last session, not the first one.
  if (onState) onState(await context.storageState().catch(() => storageState))
  await context.close()
  const raw = await page.video().path()
  const file = join(dir, `${id}.webm`)
  const { renameSync, rmSync } = await import('node:fs')
  rmSync(file, { force: true })
  renameSync(raw, file)
  // A video shorter than the take lost frames before the first page load: the marks would be late.
  const lost = end - Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim())
  if (lost > 0.4) problems.push(`the video lost ${lost.toFixed(1)}s of frames: move set-up into the chapter's before hook`)
  const meta = { id, title, file, start: started ?? 0, end, cues: cues.map((c) => ({ ...c, t: c.t - (started ?? 0) })), marks: marks.map((m) => ({ ...m, t: m.t - (started ?? 0) })), problems, error: error ? String(error.message).split('\n')[0] : null }
  writeJson(join(dir, `${id}.json`), meta)
  return meta
}

/** Signs in through the real login form and returns the session to start later chapters from. */
export async function signedInState(browser, email, { path = '/login', password = DEMO.password, landing = '**/admin/**' } = {}) {
  const context = await browser.newContext({ viewport: APP })
  const page = await context.newPage()
  await page.goto(WEB + path)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL(landing, { timeout: 30000 })
  const state = await context.storageState()
  await context.close()
  return state
}

/**
 * Blurs every card in a list except the ones mentioning `keep`, and keeps doing so as the list
 * changes (a search redraws it). For the shop directory: the demo store stays readable, real
 * shops are not shown.
 */
export async function blurCardsExcept(page, cardSelector, keep) {
  await page.evaluate(
    ({ cardSelector, keep }) => {
      const where = location.pathname
      const apply = () => {
        // Only on the page it was set on: an in-app link to the shop must not blur the shop.
        if (location.pathname !== where) return
        for (const el of document.querySelectorAll(cardSelector)) {
          const mine = (el.textContent || '').includes(keep)
          el.style.filter = mine ? '' : 'blur(9px)'
          el.style.pointerEvents = mine ? '' : 'none'
        }
      }
      apply()
      new MutationObserver(apply).observe(document.body, { childList: true, subtree: true, characterData: true })
    },
    { cardSelector, keep },
  )
}

/** Runs a role's chapters, skipping those already filmed unless asked, and reports each one. */
export async function runChapters(role, chapters, { only, redo } = {}) {
  const browser = await chromium.launch({
    // A fake microphone that plays the voice note recorded in assets/ (the voice notes chapter).
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(ASSETS, 'voice-note.wav')}`],
  })
  const results = []
  const ctx = {}
  try {
    for (const [index, chapter] of chapters.entries()) {
      const id = `${role}-${String(index + 1).padStart(2, '0')}-${chapter.slug}`
      const metaFile = join(OUT, 'clips', `${id}.json`)
      const already = readJson(metaFile, null)
      const wanted = only ? only.includes(chapter.slug) : !(already && !already.error && !(redo ?? []).includes(chapter.slug))
      if (chapter.setup) await chapter.setup(ctx, browser)
      if (!wanted) {
        if (already) console.log(`  kept    ${id}`)
        results.push(already)
        continue
      }
      process.stdout.write(`  filming ${id} ... `)
      // Set-up for this take only (API calls), done before the page and its video exist.
      if (chapter.before) await chapter.before(ctx)
      const meta = await filmChapter(browser, { id, title: chapter.title, ...(chapter.options ? chapter.options(ctx) : {}) }, (film) => chapter.run(film, ctx))
      console.log(meta.error ? `FAILED: ${meta.error}` : meta.problems.length ? `done, with ${meta.problems.length} problem(s): ${meta.problems[0]}` : 'done')
      results.push(meta)
    }
  } finally {
    await browser.close()
  }
  writeJson(join(OUT, `${role}-chapters.json`), chapters.map((c, i) => ({ index: i + 1, slug: c.slug, title: c.title, id: `${role}-${String(i + 1).padStart(2, '0')}-${c.slug}` })))
  return results
}

/** A link in the admin's left-hand menu (the sidebar). */
export const sidebar = (page, name) => page.locator('aside').getByRole('link', { name, exact: true })
