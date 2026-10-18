// Čita listu na /moj-kp/pratim, upoređuje sa sačuvanom i beleži nestale oglase.
const FAV_PATH = '/moj-kp/pratim';
const SEL = {
  item: 'section[class*="AdFollow"][class*="itemHolder"]',
  name: '[class*="AdItem"][class*="__name"]',
  price: '.priceText, [class*="__inlinePrice"]',
  location: '[class*="originAndPromoLocation"]',
  total: `a[href$="${FAV_PATH}"][aria-label]`,
};
const PARTIAL_TTL = 30 * 60 * 1000; // koliko dugo se skupljaju oglasi sa više strana liste

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function parseItem(sec) {
  const link = sec.querySelector('a[href*="/oglas/"]');
  const m = link && /\/oglas\/(\d+)/.exec(link.href);
  if (!m) return null;
  return {
    id: m[1],
    name: clean(sec.querySelector(SEL.name)?.textContent) || link.getAttribute('aria-label') || `Oglas ${m[1]}`,
    price: clean(sec.querySelector(SEL.price)?.textContent),
    location: clean(sec.querySelector(SEL.location)?.textContent),
    img: sec.querySelector('img')?.src || '',
    url: link.href,
    state: sec.dataset.state || '',
  };
}

function readItems() {
  const items = {};
  for (const sec of document.querySelectorAll(SEL.item)) {
    const it = parseItem(sec);
    if (it) items[it.id] = it;
  }
  return items;
}

function readTotal() {
  for (const a of document.querySelectorAll(SEL.total)) {
    const m = /(\d+)\s*$/.exec(a.getAttribute('aria-label'));
    if (m) return Number(m[1]);
  }
  return null;
}

async function applySnapshot(current, total) {
  const { ads = {} } = await get('ads');
  const now = Date.now();
  for (const [id, ad] of Object.entries(ads)) {
    if (!current[id] && !ad.removedAt) ad.removedAt = now;
  }
  for (const [id, it] of Object.entries(current)) {
    const prev = ads[id];
    ads[id] = { ...prev, ...it, firstSeen: prev?.firstSeen || now, lastSeen: now, removedAt: null };
  }
  await set({ ads, lastScan: { at: now, seen: Object.keys(current).length, total, complete: true } });
}

async function addWithoutDiff(items, total, seen) {
  // Lista nije kompletna (straničenje ili pretraga): samo dopuni podatke, ništa ne označavaj kao nestalo.
  const { ads = {} } = await get('ads');
  const now = Date.now();
  for (const [id, it] of Object.entries(items)) {
    const prev = ads[id];
    ads[id] = { ...prev, ...it, firstSeen: prev?.firstSeen || now, lastSeen: now, removedAt: null };
  }
  await set({ ads, lastScan: { at: now, seen, total, complete: false } });
}

async function scan() {
  const items = readItems();
  const total = readTotal();
  const count = Object.keys(items).length;
  // Broj u meniju i lista se ne osvežavaju istovremeno (npr. odmah posle lajka/skidanja lajka).
  // Takvo stanje preskačemo – ponovo se skenira kad se nešto od toga promeni.
  if (total === null || count > total || (count === 0 && total > 0)) return;

  if (count === total) {
    await set({ partial: null });
    return applySnapshot(items, total);
  }

  // Više strana: spajamo oglase sa svih strana viđenih u poslednjih 30 min.
  let { partial } = await get('partial');
  if (!partial || Date.now() - partial.startedAt > PARTIAL_TTL) partial = { startedAt: Date.now(), items: {} };
  Object.assign(partial.items, items);
  let union = Object.keys(partial.items).length;
  if (union > total) {
    // Skupljeno je više nego što ih ima – nešto se u međuvremenu promenilo, kreni ispočetka.
    partial = { startedAt: Date.now(), items };
    union = count;
  }
  if (union === total) {
    await set({ partial: null });
    return applySnapshot(partial.items, total);
  }
  await set({ partial });
  return addWithoutDiff(items, total, union);
}

// Sajt je SPA – umesto samo učitavanja pratimo adresu (uklj. ?page=2), broj oglasa
// u listi i broj u meniju; skeniramo kad se to smiri 1,5 s.
let lastSig = null;
let scanTimer = null;
setInterval(() => {
  if (location.pathname !== FAV_PATH) {
    lastSig = null;
    return;
  }
  const sig = `${location.href}|${document.querySelectorAll(SEL.item).length}|${readTotal()}`;
  if (sig === lastSig) return;
  lastSig = sig;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 1500);
}, 500);

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.data?.source !== 'kp-pratim-istorija') return;
  const { action, id } = e.data;
  const { ads = {}, partial } = await get(['ads', 'partial']);

  if (action === 'unfollow') {
    // Sam si skinuo lajk – to nije "nestao" oglas.
    delete ads[id];
    if (partial) delete partial.items[id];
    return set({ ads, partial: partial || null });
  }

  if (action === 'follow' && !ads[id]) {
    const link = document.querySelector(`a[href*="/oglas/${id}"][aria-label]`);
    const onAdPage = location.pathname.includes(`/oglas/${id}`);
    const now = Date.now();
    ads[id] = {
      id,
      name: link?.getAttribute('aria-label') ||
        (onAdPage && document.querySelector('meta[property="og:title"]')?.content) ||
        `Oglas ${id}`,
      price: '',
      location: '',
      img: (onAdPage && document.querySelector('meta[property="og:image"]')?.content) || '',
      url: onAdPage ? location.href : link?.href || '',
      state: 'active',
      firstSeen: now,
      lastSeen: now,
      removedAt: null,
    };
    return set({ ads });
  }
});
