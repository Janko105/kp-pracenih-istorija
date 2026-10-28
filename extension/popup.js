const $ = (id) => document.getElementById(id);
const isFull = location.hash === '#full';
if (isFull) document.body.classList.add('full');

let tab = 'removed';
let ads = {};
let prevSeenAt = 0;

const fmt = (ts) =>
  new Date(ts).toLocaleString('sr-RS', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// "danas 11:59", "juče 18:02", "pre 5 dana", pa datum – kao na KP-u.
function relative(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `danas ${time}`;
  if (days === 1) return `juče ${time}`;
  if (days < 7) return `pre ${days} dana`;
  return d.toLocaleDateString('sr-RS', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}
const ICON_PIN = 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
const ICON_IMG = 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01';
const ICON_X = 'M6 6l12 12M18 6L6 18';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function card(ad, isRemoved) {
  const li = el('li', 'card' + (isRemoved ? ' removed' : ''));
  if (isRemoved && ad.removedAt > prevSeenAt) li.classList.add('new');

  const thumb = el('div', 'thumb');
  if (ad.img) {
    const img = document.createElement('img');
    img.src = ad.img;
    img.alt = '';
    img.onerror = () => img.replaceWith(icon(ICON_IMG));
    thumb.append(img);
  } else {
    thumb.append(icon(ICON_IMG));
  }

  const body = el('div', 'body');
  const name = el('a', 'name', ad.name);
  name.title = ad.name;
  name.href = ad.url || '#';
  name.target = '_blank';
  body.append(name);
  if (ad.location) {
    const loc = el('div', 'loc');
    loc.append(icon(ICON_PIN), ad.location);
    body.append(loc);
  }
  const row = el('div', 'row');
  row.append(el('span', 'price', ad.price || ''));
  if (isRemoved) {
    const chip = el('span', 'chip red', `Nestao ${relative(ad.removedAt)}`);
    chip.title = fmt(ad.removedAt);
    row.append(chip);
  } else if (ad.state && ad.state !== 'active') {
    row.append(el('span', 'chip red', `status: ${ad.state}`));
  } else {
    const chip = el('span', 'chip', `prati se od ${relative(ad.firstSeen)}`);
    chip.title = fmt(ad.firstSeen);
    row.append(chip);
  }
  body.append(row);
  li.append(thumb, body);

  if (isRemoved) {
    const del = el('button', 'del');
    del.title = 'Ukloni iz istorije';
    del.append(icon(ICON_X));
    del.onclick = async () => {
      delete ads[ad.id];
      await chrome.storage.local.set({ ads });
      render();
    };
    li.append(del);
  }
  return li;
}

function render() {
  const all = Object.values(ads);
  const removed = all.filter((a) => a.removedAt).sort((a, b) => b.removedAt - a.removedAt);
  const active = all.filter((a) => !a.removedAt).sort((a, b) => b.firstSeen - a.firstSeen);
  $('cnt-removed').textContent = removed.length;
  $('cnt-active').textContent = active.length;

  const rows = tab === 'removed' ? removed : active;
  $('list').replaceChildren(...rows.map((ad) => card(ad, tab === 'removed')));
  $('empty').hidden = rows.length > 0;
  $('empty-text').textContent = tab === 'removed'
    ? 'Nijedan praćeni oglas još nije nestao.'
    : 'Nema sačuvanih oglasa. Otvori stranicu „Pratim“ na KP-u.';
}

const ISSUE_TEXT = {
  'no-items': (i) => `ekstenzija ne prepoznaje oglase na stranici Pratim (u meniju piše ${i.total}, pronađeno 0).`,
  'no-total': () => 'na stranici Pratim se ne vidi broj praćenih oglasa u meniju.',
  'too-many': (i) => `na stranici je pronađeno više oglasa (${i.count}) nego što piše u meniju (${i.total}).`,
};

async function load() {
  const data = await chrome.storage.local.get(['ads', 'lastScan', 'seenAt', 'lastIssue']);
  ads = data.ads || {};
  prevSeenAt = data.seenAt || 0;
  const s = data.lastScan;
  const issue = data.lastIssue;
  const info = $('scan-info');
  if (issue && issue.at > (s?.at || 0) && ISSUE_TEXT[issue.reason]) {
    // Novije od poslednjeg uspešnog pregleda – lista se trenutno ne može pročitati.
    info.textContent = `Problem ${relative(issue.at)}: ${ISSUE_TEXT[issue.reason](issue)} ` +
      `KP je možda promenio izgled sajta. Na stranici Pratim otvori meni ⋮ → Dijagnostika.` +
      (s ? ` Prikazano stanje je od ${relative(s.at)}.` : '');
    info.classList.add('warn');
  } else if (!s) {
    info.textContent = 'Još nije pregledana lista. Otvori kupujemprodajem.com/moj-kp/pratim.';
  } else if (s.complete) {
    const n = s.total, d = n % 10, dd = n % 100;
    const word = d === 1 && dd !== 11 ? 'praćen oglas' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'praćena oglasa' : 'praćenih oglasa';
    info.textContent = `Poslednja provera ${relative(s.at)} · ${n} ${word}`;
  } else {
    info.textContent = `Poslednja provera ${relative(s.at)} · viđeno ${s.seen} od ${s.total} – prođi kroz sve strane liste da bi se proverilo šta je nestalo.`;
    info.classList.add('warn');
  }
  render();
  await chrome.storage.local.set({ seenAt: Date.now() });
}

document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  })
);

$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(ads, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kp-pratim-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

function setMenu(open) {
  $('menu').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', String(open));
}
$('menu-btn').onclick = (e) => {
  e.stopPropagation();
  setMenu($('menu').hidden);
};
$('menu').addEventListener('click', () => setMenu(false));
document.addEventListener('click', (e) => !$('menu').contains(e.target) && setMenu(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

$('open-full').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#full') });

// Pita content.js u aktivnom tabu šta vidi na stranici i kopira to u clipboard.
$('diag').onclick = async () => {
  const info = $('scan-info');
  info.classList.add('warn');
  const [tabInfo] = await chrome.tabs.query({ active: true, currentWindow: true });
  let diag;
  try {
    diag = await chrome.tabs.sendMessage(tabInfo.id, { type: 'diag' });
  } catch {
    info.textContent = 'Dijagnostika radi samo na KP stranici Pratim. Otvori je (ili je osveži ako je već otvorena), pa klikni ikonicu ekstenzije → ⋮ → Dijagnostika.';
    return;
  }
  const { lastScan, lastIssue } = await chrome.storage.local.get(['lastScan', 'lastIssue']);
  await navigator.clipboard.writeText(JSON.stringify({ ...diag, lastScan, lastIssue }, null, 2));
  info.classList.remove('warn');
  info.textContent = `Dijagnostika kopirana u clipboard (pronađeno ${diag.pronadjenoOglasa}, u meniju ${diag.brojUMeniju}). Nalepi je gde treba.`;
};

// Popup se zatvori kad se otvori dijalog za fajl, pa uvoz radi u zasebnom tabu.
$('import').onclick = () => {
  if (!isFull) return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#full') });
  $('import-file').click();
};

$('import-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const { ads: current = {} } = await chrome.storage.local.get('ads');
    let added = 0;
    for (const [id, ad] of Object.entries(imported)) {
      if (!current[id] && ad && ad.id && ad.name) {
        current[id] = ad;
        added++;
      }
    }
    await chrome.storage.local.set({ ads: current });
    ads = current;
    render();
    $('scan-info').textContent = `Uvezeno ${added} novih oglasa.`;
  } catch {
    $('scan-info').textContent = 'Fajl nije ispravan JSON.';
  }
  e.target.value = '';
};

load();
