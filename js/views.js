/* EEML view counter client — talks to /api/views/* (Mac mini self-hosted).
   Fails gracefully: if service is down/unreachable, badges simply stay hidden. */
(function () {
  "use strict";
  const BASE = "/api/views";
  const TIMEOUT_MS = 3000;

  function fetchJSON(url, opts) {
    return new Promise(resolve => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }))
        .then(r => (r && r.ok) ? r.json() : null)
        .then(j => resolve(j))
        .catch(() => resolve(null))
        .finally(() => clearTimeout(t));
    });
  }

  function format(n) {
    if (n == null || isNaN(n)) return "";
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1) + "k";
    return Math.round(n / 1000) + "k";
  }

  async function getAll(type) {
    const r = await fetchJSON(`${BASE}/${encodeURIComponent(type)}`);
    return (r && typeof r === "object" && !Array.isArray(r)) ? r : null;
  }

  // Increment once per session per item; subsequent views just GET the count.
  async function bumpAndGet(type, id) {
    if (!type || !id) return null;
    const key = `viewed:${type}:${id}`;
    const seen = sessionStorage.getItem(key);
    const url = `${BASE}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
    if (seen) {
      const r = await fetchJSON(url);
      return r && typeof r.count === "number" ? r.count : null;
    }
    const r = await fetchJSON(url, { method: "POST" });
    if (r && typeof r.count === "number") {
      try { sessionStorage.setItem(key, "1"); } catch (e) { /* private mode */ }
      return r.count;
    }
    return null;
  }

  // Bulk-fill placeholder spans on a list page.
  // Each placeholder: <span class="view-count" data-views-<type>="<id>" hidden></span>
  async function populate(root, type) {
    const map = await getAll(type);
    if (!map) return; // service down → leave hidden
    const sel = `[data-views-${type}]`;
    (root || document).querySelectorAll(sel).forEach(el => {
      const id = el.getAttribute(`data-views-${type}`);
      const n = (id in map && typeof map[id] === "number") ? map[id] : 0;
      el.textContent = format(n);
      el.removeAttribute("hidden");
    });
  }

  // Increment and fill a single placeholder (detail pages).
  async function bumpInto(el, type, id) {
    if (!el || !type || !id) return;
    const n = await bumpAndGet(type, id);
    if (n != null) {
      el.textContent = format(n);
      el.removeAttribute("hidden");
    }
  }

  window.ViewsAPI = { format, getAll, bumpAndGet, populate, bumpInto };
})();
