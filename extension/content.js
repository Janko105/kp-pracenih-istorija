// Čita listu na /moj-kp/pratim, upoređuje sa sačuvanom i beleži nestale oglase.
//
// KP menja (heširane) CSS klase, pa oglase NE tražimo po klasi kartice, nego po
// linkovima /oglas/{id}: kartica je najveći predak linka koji sadrži samo taj oglas.
// Klase ispod se koriste samo kao prvi izbor za naziv/cenu/lokaciju, uz rezervne načine.
const FAV_PATH = '/moj-kp/pratim';
const SEL = {
  adLink: 'a[href*="/oglas/"]',
  name: '[class*="__name"]',
  price: '[class*="priceText"], [class*="inlinePrice"], [class*="price" i]',
  location: '[class*="ocation" i]',
  total: `a[href$="${FAV_PATH}"][aria-label]`,
};
const PRICE_RE = /\d[\d.,]*\s*(din|€|eur|rsd)\b|dogovor|kontakt|pozvati|besplatno|kupujem/i;
const PARTIAL_TTL = 30 * 60 * 1000; // koliko dugo se skupljaju oglasi sa više strana liste

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const adId = (a) => /\/oglas\/(\d+)/.exec(a.href)?.[1];

function adLinksById(root = document) {
  const byId = new Map();
  for (const a of root.querySelectorAll(SEL.adLink)) {
    const id = adId(a);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(a);
  }
  return byId;
}

function cardFor(link, id) {
  let card = link;
  for (let p = card.parentElement; p && p !== document.body; p = p.parentElement) {
    const other = [...p.querySelectorAll(SEL.adLink)].some((a) => adId(a) && adId(a) !== id);
    if (other) break;
    card = p;
  }
  return card;
}

function parseCard(card, id, links) {
  const named = links.find((a) => a.getAttribute('aria-label'));
  const priceEl = card.querySelector(SEL.price);
  const price = clean(priceEl?.textContent) || clean(PRICE_RE.exec(card.textContent)?.[0]);
  return {
    id,
    name: clean(card.querySelector(SEL.name)?.textContent) || named?.getAttribute('aria-label') ||
      clean(links.map((a) => a.textContent).find((t) => clean(t))) || `Oglas ${id}`,
    price: price.length <= 40 ? price : '',
    location: clean(card.querySelector(SEL.location)?.textContent),
    img: card.querySelector('img')?.src || '',
    url: links[0].href,
    state: (card.closest('[data-state]') || card.querySelector('[data-state]'))?.dataset.state || '',
  };
}

function readItems() {
  const items = {};
  for (const [id, links] of adLinksById()) items[id] = parseCard(cardFor(links[0], id), id, links);
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

// Kad lista ne može da se pročita, to beležimo da bi popup upozorio (umesto da ćuti).
// Uspešan pregled posle toga ima noviji datum, pa popup tada upozorenje ne prikazuje.
function reportIssue(reason, count, total) {
  return set({ lastIssue: { at: Date.now(), reason, count, total } });
}

async function scan() {
  const items = readItems();
  const total = readTotal();
  const count = Object.keys(items).length;
  // Broj u meniju i lista se ne osvežavaju istovremeno (npr. odmah posle lajka/skidanja lajka).
  // Takvo stanje preskačemo – ponovo se skenira kad se nešto od toga promeni.
  if (total === null) return reportIssue('no-total', count, total);
  if (count === 0 && total > 0) return reportIssue('no-items', count, total);
  if (count > total) return reportIssue('too-many', count, total);

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
  const sig = `${location.href}|${adLinksById().size}|${readTotal()}`;
  if (sig === lastSig) return;
  lastSig = sig;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 1500);
}, 500);

// Dijagnostika (meni ⋮ u popup-u): šta ekstenzija vidi na ovoj stranici.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'diag') return;
  const items = readItems();
  const firstId = Object.keys(items)[0];
  const firstCard = firstId && cardFor(adLinksById().get(firstId)[0], firstId);
  reply({
    url: location.href,
    verzija: chrome.runtime.getManifest().version,
    brojUMeniju: readTotal(),
    linkoviPratim: [...document.querySelectorAll(`a[href*="${FAV_PATH}"]`)].map((a) => a.getAttribute('aria-label')),
    pronadjenoOglasa: Object.keys(items).length,
    oglasi: Object.values(items).map(({ id, name, price, state }) => ({ id, name: name.slice(0, 50), price, state })),
    htmlPrveKartice: firstCard
      ? firstCard.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/user2Id=\d+/g, 'user2Id=0').slice(0, 4000)
      : null,
  });
});

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
