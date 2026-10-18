// Radi u kontekstu same stranice (world: MAIN). Sajt šalje API pozive
// .../{id}/follow i .../{id}/unfollow (axios -> XHR); kad uspeju,
// javljamo content.js-u preko postMessage.
(() => {
  const RE = /\/(\d+)\/(follow|unfollow)(?:[/?#]|$)/;

  const report = (url) => {
    try {
      const m = RE.exec(new URL(url, location.href).pathname);
      if (m) window.postMessage({ source: 'kp-pratim-istorija', action: m[2], id: m[1] }, location.origin);
    } catch {}
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('load', () => {
      if (this.status >= 200 && this.status < 300) report(url);
    });
    return open.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const url = typeof input === 'string' ? input : input?.url;
    return origFetch.apply(this, arguments).then((res) => {
      if (res.ok) report(url);
      return res;
    });
  };
})();
