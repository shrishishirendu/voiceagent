// Local Playwright smoke test — signs in via the magic-link console mock, then visits and
// screenshots the key screens (Tickets board+table+drawer, Customers → detail invoices,
// Outbound, Analytics, Forecasting) and collects any console/page errors.
//
//   DEVLOG=<path> SHOTDIR=<dir> node scripts/pw-smoke.mjs
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.env.BASE || 'http://localhost:3010'
const OWNER = process.env.OWNER || 'shreyank.sinha@isoftanz.com.au'
const DEVLOG = process.env.DEVLOG
const SHOTDIR = process.env.SHOTDIR || '.'
fs.mkdirSync(SHOTDIR, { recursive: true })

const errors = []
const shot = (page, name) => page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true }).then(() => console.log('shot:', name)).catch((e) => console.log('shot-fail', name, e.message))

async function findMagicLink(sinceOffset) {
  for (let i = 0; i < 60; i++) {
    const buf = fs.readFileSync(DEVLOG, 'utf8').slice(sinceOffset)
    const m = buf.match(/magic link for \S+?: (\S+)/)
    if (m) return m[1]
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('magic link line not found in dev log')
}

async function safe(name, fn) {
  try {
    await fn()
  } catch (e) {
    console.log(`STEP-FAIL ${name}: ${e.message}`)
    errors.push(`step ${name}: ${e.message}`)
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`api ${r.status()}: ${r.url()}`) })

// ── Sign in ───────────────────────────────────────────────────────────────────
const offset = DEVLOG && fs.existsSync(DEVLOG) ? fs.statSync(DEVLOG).size : 0
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#email', OWNER)
await page.click('button:has-text("Email me a sign-in link")')
const confirmUrl = await findMagicLink(offset)
const next = new URL(confirmUrl).searchParams.get('next')
console.log('completing sign-in via callback…')
await page.goto(next, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
console.log('after sign-in url:', page.url())

const gotoWait = async (route, apiSubstr) => {
  const wait = apiSubstr ? page.waitForResponse((r) => r.url().includes(apiSubstr) && r.request().method() === 'GET', { timeout: 30000 }).catch(() => null) : Promise.resolve()
  await page.goto(`${BASE}/app/${route}`, { waitUntil: 'domcontentloaded' })
  await wait
  await page.waitForTimeout(1200)
}

// ── Tickets: board, table, drawer ───────────────────────────────────────────────
await safe('tickets-board', async () => {
  await gotoWait('tickets', '/api/tickets')
  await page.waitForSelector('text=In progress', { timeout: 15000 })
  await page.waitForTimeout(500)
  await shot(page, '01-tickets-board')
})
await safe('tickets-table', async () => {
  await page.click('button:has-text("Table")')
  await page.waitForSelector('table', { timeout: 8000 })
  await page.waitForTimeout(500)
  await shot(page, '02-tickets-table')
})
await safe('tickets-drawer', async () => {
  await page.click('button:has-text("Board")')
  await page.waitForSelector('.row-card', { timeout: 8000 })
  await page.locator('.row-card').first().click()
  await page.waitForSelector('text=Summary', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)
  await shot(page, '03-ticket-drawer')
  await page.keyboard.press('Escape')
})

// ── Customers → detail invoices ────────────────────────────────────────────────
await safe('customers', async () => {
  await gotoWait('customers', '/api/customers')
  await page.waitForSelector('a[href^="/app/customers/"]', { timeout: 12000 })
  await page.waitForTimeout(500)
  await shot(page, '04-customers')
})
await safe('customer-detail', async () => {
  const resp = page.waitForResponse((r) => /\/api\/customers\/[^/?]+/.test(r.url()), { timeout: 20000 }).catch(() => null)
  await page.locator('a[href^="/app/customers/"]').first().click()
  await resp
  await page.waitForSelector('text=Outstanding', { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(800)
  await shot(page, '05-customer-invoices')
})

// ── Other dashboards ───────────────────────────────────────────────────────────
for (const [route, name, api] of [['outbound', '06-outbound', '/api/outbound/stats'], ['analytics', '07-analytics', '/api/analytics'], ['forecasting', '08-forecasting', '/api/forecasting'], ['queue', '09-queue', '/api/invoices']]) {
  await safe(name, async () => {
    await gotoWait(route, api)
    await page.waitForTimeout(700)
    await shot(page, name)
  })
}

console.log('\n=== ERRORS (' + errors.length + ') ===')
for (const e of errors) console.log('  - ' + e)
await browser.close()
process.exit(0)
