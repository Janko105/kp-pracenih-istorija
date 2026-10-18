// Broj novih nestalih oglasa (od poslednjeg otvaranja popupa) na ikonici.
async function updateBadge() {
  const { ads = {}, seenAt = 0 } = await chrome.storage.local.get(['ads', 'seenAt']);
  const n = Object.values(ads).filter((a) => a.removedAt && a.removedAt > seenAt).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.ads || changes.seenAt)) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
