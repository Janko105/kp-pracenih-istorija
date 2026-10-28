// End-to-end test ekstenzije: Chromium sa učitanom ekstenzijom, a KP stranice
// se serviraju iz fixture-pratim.html (bez pristupa pravom sajtu).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const FIXTURE = fs.readFileSync(path.join(here, 'fixture-pratim.html'), 'utf8');
const SHOTS = process.env.SHOTS_DIR || here;
const KP = 'https://www.kupujemprodajem.com';
const SECTION_RE = /<section class="[^"]*itemHolder[^"]*"[^>]*>[\s\S]*?<\/section>/g;
const ALL_IDS = [...FIXTURE.matchAll(SECTION_RE)].map((m) => /\/oglas\/(\d+)/.exec(m[0])[1]);

// HTML liste "Pratim" sa zadatim oglasima i brojem u meniju.
function favPage(ids, total = ids.length) {
  return FIXTURE.replace(SECTION_RE, (sec) => (ids.includes(/\/oglas\/(\d+)/.exec(sec)[1]) ? sec : ''))
    .replace('aria-label="Pratim 6"', `aria-label="Pratim ${total}"`);
}

// Ista lista posle "redizajna" KP-a: drugi tagovi, druge (heširane) klase, relativni linkovi,
// cena bez prepoznatljive klase. Ekstenzija ne sme da zavisi od toga.
function redesigned(html) {
  return html
    .replace(/<section class="[^"]*itemHolder[^"]*"([^>]*)><article>/g, '<li class="AdCardV2-module__k3Jx__card"$1><div>')
    .replace(/<\/article><\/section>/g, '</div></li>')
    .replace(/class="[^"]*__name"/g, 'class="AdCardV2-module__k3Jx__title"')
    .replace(/class="priceText [^"]*"/g, 'class="AdCardV2-module__k3Jx__amount"')
    .replace(/class="AdItem[^"]*__price(Holder)?"/g, 'class="AdCardV2-module__k3Jx__meta"')
    .replace(/href="https:\/\/www\.kupujemprodajem\.com\//g, 'href="/');
}

const pages = {}; // putanja+query -> HTML
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-ext-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route(`${KP}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/api/web/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  const html = pages[u.pathname + u.search];
  if (html) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.fulfill({ status: 404, body: '' });
});
// Zamenske slike oglasa (različita boja po oglasu) za screenshot-ove.
await ctx.route('https://images.kupujemprodajem.com/**', (route) => {
  const hue = (Number(/(\d{6,})/.exec(route.request().url())?.[1] || 0) * 67) % 360;
  route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(${hue} 45% 62%)"/><circle cx="150" cy="130" r="60" fill="hsl(${hue} 45% 80%)"/></svg>`,
  });
});

const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;
const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && !m.text().includes('ERR_FAILED') && console.log('  [page]', m.text()));

async function visitFav(query, ids, total, transform = (h) => h) {
  pages['/moj-kp/pratim' + query] = transform(favPage(ids, total));
  const before = (await store()).lastScan?.at || 0;
  await page.goto(`${KP}/moj-kp/pratim${query}`);
  await waitFor(async () => ((await store()).lastScan?.at || 0) > before, 'skeniranje liste');
  return store();
}

async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout: ${what}`);
}

const xhr = (url) =>
  page.evaluate((u) => new Promise((res) => {
    const x = new XMLHttpRequest();
    x.open('GET', u);
    x.onload = res;
    x.send();
  }), url);

let ok = 0;
async function step(name, fn) {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
}

const [A, B, ...rest] = ALL_IDS;

await step('prvo otvaranje: sačuvano svih 6 oglasa', async () => {
  const s = await visitFav('', ALL_IDS);
  assert.equal(Object.keys(s.ads).length, 6);
  assert.ok(s.lastScan.complete);
  const a = s.ads[A];
  assert.ok(a.name && a.price && a.url.includes(`/oglas/${A}`) && a.img, JSON.stringify(a));
  assert.ok(Object.values(s.ads).every((x) => x.removedAt === null));
});

await step('KP promeni izgled (drugi tagovi i klase) -> oglasi se i dalje prepoznaju', async () => {
  const before = (await store()).ads;
  const s = await visitFav('', ALL_IDS, ALL_IDS.length, redesigned);
  assert.equal(s.lastScan.complete, true);
  assert.equal(Object.keys(s.ads).length, 6);
  for (const id of ALL_IDS) {
    assert.equal(s.ads[id].removedAt, null);
    assert.equal(s.ads[id].name, before[id].name, `naziv ${id}`);
    assert.equal(s.ads[id].price, before[id].price, `cena ${id}`);
    assert.ok(s.ads[id].url.startsWith(`${KP}/`) && s.ads[id].img, JSON.stringify(s.ads[id]));
  }
});

await step('oglas nestao iz liste -> označen kao nestao', async () => {
  const s = await visitFav('', [B, ...rest]);
  assert.ok(s.ads[A].removedAt > 0);
  assert.equal(Object.values(s.ads).filter((x) => x.removedAt).length, 1);
});

await step('skidanje lajka (XHR .../unfollow) -> oglas obrisan, nije "nestao"', async () => {
  await xhr(`/api/web/v1/eds/${B}/unfollow`);
  await waitFor(async () => !(await store()).ads[B], 'brisanje posle unfollow');
  const s = await visitFav('', rest);
  assert.equal(s.ads[B], undefined);
  assert.equal(Object.values(s.ads).filter((x) => x.removedAt).length, 1);
});

await step('oglas se vratio u listu -> skinuta oznaka nestao', async () => {
  const s = await visitFav('', [A, ...rest]);
  assert.equal(s.ads[A].removedAt, null);
});

await step('lista na 2 strane: bez lažnih nestanaka, poređenje tek kad se vide sve', async () => {
  const ids = [A, ...rest];
  let s = await visitFav('?page=1', ids.slice(0, 3), ids.length);
  assert.equal(s.lastScan.complete, false);
  assert.ok(Object.values(s.ads).every((x) => x.removedAt === null));
  s = await visitFav('?page=2', ids.slice(3), ids.length);
  assert.equal(s.lastScan.complete, true);
  assert.ok(Object.values(s.ads).every((x) => x.removedAt === null));
});

await step('broj u meniju kasni za listom -> nema "viđeno 6 od 5", skenira se kad se uskladi', async () => {
  const ids = [A, ...rest];
  const before = (await store()).lastScan.at;
  pages['/moj-kp/pratim'] = favPage(ids, ids.length - 1);
  await page.goto(`${KP}/moj-kp/pratim`);
  await page.waitForTimeout(3000);
  assert.equal((await store()).lastScan.at, before, 'nekonzistentno stanje ne sme da se zapiše');
  await page.evaluate((n) => {
    document.querySelector('a[href$="/moj-kp/pratim"][aria-label]').setAttribute('aria-label', `Pratim ${n}`);
  }, ids.length);
  await waitFor(async () => (await store()).lastScan.at > before, 'skeniranje posle usklađivanja');
  const s = await store();
  assert.equal(s.lastScan.complete, true);
  assert.equal(s.lastScan.seen, ids.length);
});

await step('skidanje lajka na samoj stranici Pratim -> lista se smanji, bez lažnog nestanka', async () => {
  const C = rest[0];
  const before = (await store()).lastScan.at;
  await xhr(`/api/web/v1/eds/${C}/unfollow`);
  await page.evaluate((id) => {
    document.querySelector(`a[href*="/oglas/${id}"]`).closest('section').remove();
    const a = document.querySelector('a[href$="/moj-kp/pratim"][aria-label]');
    a.setAttribute('aria-label', `Pratim ${Number(/\d+/.exec(a.getAttribute('aria-label'))[0]) - 1}`);
  }, C);
  await waitFor(async () => (await store()).lastScan.at > before, 'skeniranje posle skidanja lajka');
  const s = await store();
  assert.equal(s.ads[C], undefined);
  assert.ok(Object.values(s.ads).every((x) => x.removedAt === null));
});

await step('lajk na stranici oglasa -> odmah upisan sa nazivom', async () => {
  pages['/test/oglas/999'] =
    '<!doctype html><html><head><meta property="og:title" content="Test oglas bicikl"></head><body>oglas</body></html>';
  await page.goto(`${KP}/test/oglas/999`);
  await page.waitForTimeout(300);
  await xhr('/api/web/v1/eds/999/follow');
  await waitFor(async () => (await store()).ads['999'], 'upis posle follow');
  assert.equal((await store()).ads['999'].name, 'Test oglas bicikl');
});

await step('lajkovan oglas kojeg nema u listi -> nestao + broj na ikonici', async () => {
  const s = await visitFav('', [A, ...rest]);
  assert.ok(s.ads['999'].removedAt > 0);
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '1');
});

await step('popup prikazuje nestale i resetuje broj na ikonici', async () => {
  const p = await ctx.newPage();
  // Još jedan nestali oglas sa slikom i cenom, da screenshot liči na stvarnu upotrebu.
  await visitFav('', rest);
  await p.setViewportSize({ width: 440, height: 600 });
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await p.waitForSelector('#list li');
  assert.match(await p.textContent('#list'), /Test oglas bicikl/);
  await p.locator('body').screenshot({ path: path.join(SHOTS, 'popup-nestali.png') });
  const tabWidths = () => p.$$eval('nav button', (bs) => bs.map((b) => b.getBoundingClientRect().width));
  const [w1, w2] = await tabWidths();
  assert.equal(w1, w2, 'tabovi moraju biti iste širine');
  await p.click('nav button[data-tab="active"]');
  assert.deepEqual(await tabWidths(), [w1, w2], 'širina tabova se ne sme menjati pri prebacivanju');
  assert.equal(await p.locator('#list li').count(), 4);
  await p.locator('body').screenshot({ path: path.join(SHOTS, 'popup-aktivni.png') });
  await p.click('#menu-btn');
  assert.equal(await p.isVisible('#export'), true);
  await p.locator('body').screenshot({ path: path.join(SHOTS, 'popup-meni.png') });
  await p.keyboard.press('Escape');
  assert.equal(await p.isVisible('#menu'), false);
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.click('nav button[data-tab="removed"]');
  await p.locator('body').screenshot({ path: path.join(SHOTS, 'popup-tamna.png') });
  await waitFor(async () => (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '', 'reset ikonice');
});

await step('dijagnostika: content script javlja šta vidi na stranici', async () => {
  await visitFav('', rest);
  const diag = await sw.evaluate(async () => {
    for (const t of await chrome.tabs.query({})) {
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type: 'diag' });
        if (r) return r;
      } catch {}
    }
  });
  assert.equal(diag.brojUMeniju, rest.length);
  assert.equal(diag.pronadjenoOglasa, rest.length);
  assert.match(diag.htmlPrveKartice, /\/oglas\/\d+/);
});

await step('lista se ne prepoznaje -> popup upozorava umesto da ćuti', async () => {
  const before = (await store()).lastIssue?.at || 0;
  // Broj u meniju postoji, ali oglasa nema nigde na stranici.
  pages['/moj-kp/pratim'] = favPage([], 4);
  await page.goto(`${KP}/moj-kp/pratim`);
  await waitFor(async () => ((await store()).lastIssue?.at || 0) > before, 'beleženje problema');
  assert.equal((await store()).lastIssue.reason, 'no-items');
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await p.waitForSelector('#scan-info.warn');
  assert.match(await p.textContent('#scan-info'), /ne prepoznaje oglase.*Dijagnostika/);
  // Čim lista ponovo može da se pročita, upozorenje nestaje.
  await visitFav('', rest);
  await p.reload();
  await p.waitForSelector('#scan-info:not(.warn)');
});

await ctx.close();
fs.rmSync(userDir, { recursive: true, force: true });
console.log(`\nSvi testovi prošli (${ok}).`);
