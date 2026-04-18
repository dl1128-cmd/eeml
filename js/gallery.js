/* Gallery list page — 3×3 grid with pagination (9 per page) */
(function () {
  "use strict";

  const PER_PAGE = 9;

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("gallery-root");
    if (!root) return;
    try {
      const items = await SiteUtils.loadJSON("data/gallery.json");
      render(root, items);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<p style="color:var(--c-text-muted)">Failed to load gallery.</p>`;
    }
  });

  function getCurrentPage(totalPages) {
    const p = parseInt(new URLSearchParams(location.search).get("page"), 10);
    if (isNaN(p) || p < 1) return 1;
    return Math.min(p, Math.max(1, totalPages));
  }

  function render(root, items) {
    const lang = SiteUtils.getLang();
    const i18n = SiteUtils.getI18n();
    if (!items || items.length === 0) {
      root.innerHTML = `<p style="color:var(--c-text-muted);text-align:center;padding:var(--space-16) 0;">${(i18n?.gallery?.empty) || "No photos yet."}</p>`;
      return;
    }
    const sorted = items.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = getCurrentPage(totalPages);
    const start = (page - 1) * PER_PAGE;
    const pageItems = sorted.slice(start, start + PER_PAGE);

    root.innerHTML = `
      <div class="gallery-meta">
        <span class="gallery-count">Total <b>${total}</b></span>
        <span class="gallery-page-indicator">${page} / ${totalPages}</span>
      </div>
      <div class="gallery-grid">${
        pageItems.map(g => cardHtml(g, lang, i18n)).join("")
      }</div>
      ${totalPages > 1 ? paginationHtml(page, totalPages, i18n) : ""}
    `;
  }

  function cardHtml(g, lang, i18n) {
    const title = lang === "ko" ? (g.title_ko || g.title_en) : (g.title_en || g.title_ko);
    const summary = lang === "ko" ? (g.summary_ko || g.summary_en) : (g.summary_en || g.summary_ko);
    const cover = g.cover || ((g.images && g.images[0] && g.images[0].src) || "");
    return `
      <a class="gallery-card" href="gallery-detail.html?id=${encodeURIComponent(g.id)}">
        <div class="gallery-cover">
          ${cover ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(title || "")}" loading="lazy" />` : `<div class="gallery-cover-placeholder">EEML</div>`}
        </div>
        <div class="gallery-card-body">
          ${g.date ? `<div class="gallery-date">${escapeHtml(g.date)}</div>` : ""}
          <h3 class="gallery-title">${escapeHtml(title || "")}</h3>
          ${summary ? `<p class="gallery-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="gallery-cta">${(i18n?.gallery?.read_more) || "Read more →"}</div>
        </div>
      </a>`;
  }

  function paginationHtml(current, total, i18n) {
    const prevLabel = (i18n?.gallery?.prev_short) || "← Prev";
    const nextLabel = (i18n?.gallery?.next_short) || "Next →";
    const pages = pageNumbers(current, total);

    const btn = (p, label, { active = false, disabled = false, ariaLabel = "" } = {}) => {
      const cls = `gallery-page-btn${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`;
      if (disabled || active) {
        return `<span class="${cls}" ${ariaLabel ? `aria-label="${ariaLabel}"` : ""} aria-current="${active ? "page" : "false"}">${label}</span>`;
      }
      return `<a class="${cls}" href="?page=${p}" ${ariaLabel ? `aria-label="${ariaLabel}"` : ""}>${label}</a>`;
    };

    return `
      <nav class="gallery-pagination" aria-label="Gallery pagination">
        ${btn(current - 1, prevLabel, { disabled: current === 1, ariaLabel: "Previous page" })}
        ${pages.map(p => p === "…"
          ? `<span class="gallery-page-ellipsis">…</span>`
          : btn(p, String(p), { active: p === current, ariaLabel: `Page ${p}` })
        ).join("")}
        ${btn(current + 1, nextLabel, { disabled: current === total, ariaLabel: "Next page" })}
      </nav>`;
  }

  // Render compact page list with ellipsis when many pages exist
  // e.g. current=5/total=10 → [1, …, 4, 5, 6, …, 10]
  function pageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (current > 3) pages.push("…");
    const from = Math.max(2, current - 1);
    const to = Math.min(total - 1, current + 1);
    for (let p = from; p <= to; p++) pages.push(p);
    if (current < total - 2) pages.push("…");
    pages.push(total);
    return pages;
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return escapeHtml(s); }
})();
