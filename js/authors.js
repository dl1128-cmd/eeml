/* EEML author rendering — shared by publications.js and home.js so the
   exact same emphasis rules apply on the listing page and on the home
   "Recent publications" cards.

   Rules:
   - "*" suffix     → corresponding author
   - "†" suffix     → co-first author
   - first entry (when no †) → first author
   - PI's name AND any current/past lab member name (any common
     abbreviation form) → always highlighted, regardless of position

   All key authors get the .pub-author-key class (bold + underline via
   style.css). The owner list is built once per page load from
   data/config.json (pi.name_*) and data/members.json. */
(function () {
  "use strict";

  let OWNER_PATTERNS = new Set(["d. lee"]); // sane fallback before load

  // Build the set of likely byline variants for a full name:
  //   "Jinhyung Kim"       → ["jinhyung kim", "j. kim", "j kim"]
  //   "Ashok Kumar Kakarla" → adds "a.k. kakarla" / "ak kakarla" / "a. kakarla"
  function variants(full) {
    const out = [];
    const t = String(full || "").trim();
    if (!t) return out;
    out.push(t.toLowerCase());
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return out;
    const last = parts[parts.length - 1];
    const givens = parts.slice(0, -1);
    const firstInit = givens[0][0];
    out.push(`${firstInit}. ${last}`.toLowerCase());
    out.push(`${firstInit} ${last}`.toLowerCase());
    if (givens.length >= 2) {
      const initials = givens.map(g => g[0]).join(".") + ".";
      const initialsNoDot = givens.map(g => g[0]).join("");
      out.push(`${initials} ${last}`.toLowerCase());
      out.push(`${initialsNoDot} ${last}`.toLowerCase());
      // Also "A. Kakarla" — sometimes only first given is used
      out.push(`${givens[0][0]}. ${last}`.toLowerCase());
    }
    return out;
  }

  function setOwnerAuthors(list) {
    const set = new Set();
    (list || []).forEach(name => variants(name).forEach(v => set.add(v)));
    if (set.size) OWNER_PATTERNS = set;
  }

  function isOwner(name) {
    const norm = String(name || "")
      .replace(/[\*†]+\s*$/g, "")
      .trim()
      .toLowerCase();
    return OWNER_PATTERNS.has(norm);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function formatAuthors(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const parts = s.split(",").map(t => t.trim()).filter(Boolean);
    const hasDagger = parts.some(p => /†\s*$/.test(p));
    return parts.map((tok, i) => {
      const corr = /\*\s*$/.test(tok);
      const dag = /†\s*$/.test(tok);
      const isFirst = dag || (!hasDagger && i === 0);
      const isKey = corr || isFirst || isOwner(tok);
      return isKey
        ? `<span class="pub-author-key">${escapeHtml(tok)}</span>`
        : escapeHtml(tok);
    }).join(", ");
  }

  // Cached promise so multiple consumers (publications.js, home.js) share
  // a single fetch of config + members.
  let ownerLoadPromise = null;
  function loadOwners() {
    if (ownerLoadPromise) return ownerLoadPromise;
    const fetchJSON = (window.SiteUtils && SiteUtils.loadJSON)
      || (path => fetch(path).then(r => r.ok ? r.json() : null));
    ownerLoadPromise = (async () => {
      try {
        const [cfg, members] = await Promise.all([
          Promise.resolve(fetchJSON("data/config.json")).catch(() => ({})),
          Promise.resolve(fetchJSON("data/members.json")).catch(() => [])
        ]);
        const names = [];
        if (cfg && cfg.lab && Array.isArray(cfg.lab.owner_authors)) {
          names.push(...cfg.lab.owner_authors);
        }
        if (cfg && cfg.pi) {
          if (cfg.pi.name_en) names.push(cfg.pi.name_en);
          if (cfg.pi.name_ko) names.push(cfg.pi.name_ko);
        }
        if (Array.isArray(members)) {
          // Include every member — current and alumni — because alumni
          // are still co-authors on older papers we want to highlight.
          members.forEach(m => {
            if (m && m.name_en) names.push(m.name_en);
            if (m && m.name_ko) names.push(m.name_ko);
          });
        }
        if (!names.length) names.push("D. Lee");
        setOwnerAuthors(names);
      } catch (err) {
        console.warn("AuthorsAPI.loadOwners failed:", err);
      }
    })();
    return ownerLoadPromise;
  }

  window.AuthorsAPI = { setOwnerAuthors, isOwner, formatAuthors, loadOwners };
})();
