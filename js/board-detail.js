/* News detail page — renders full body + images for a single news item */
(function () {
  "use strict";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("news-detail-root");
    if (!root) return;
    try {
      const items = await SiteUtils.loadJSON("data/news.json");
      render(root, items);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<section class="section"><div class="container-narrow"><p>Failed to load news entry.</p></div></section>`;
    }
  });

  function render(root, items) {
    const lang = SiteUtils.getLang();
    const id = new URLSearchParams(location.search).get("id");
    const sorted = (items || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const entry = sorted.find(n => n.id === id) || sorted[0];
    if (!entry) {
      root.innerHTML = `
        <section class="section">
          <div class="container-narrow">
            <div class="eyebrow"><a href="board.html" style="color:inherit">${lang === "ko" ? "← News" : "← News"}</a></div>
            <h1>Not Found</h1>
            <p style="color:var(--c-text-muted)">${lang === "ko" ? "뉴스를 찾을 수 없습니다." : "News item not found."}</p>
          </div>
        </section>`;
      return;
    }
    const idx = sorted.findIndex(n => n.id === entry.id);
    const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
    const next = sorted[(idx + 1) % sorted.length];

    const title = lang === "ko" ? (entry.title_ko || entry.title_en) : (entry.title_en || entry.title_ko);
    const body = lang === "ko" ? (entry.body_ko || entry.body_en || "") : (entry.body_en || entry.body_ko || "");
    const images = Array.isArray(entry.images) ? entry.images : [];

    document.title = `${title || "News"} · EEML`;

    root.innerHTML = `
      <section class="page-header">
        <div class="container-narrow">
          <div class="eyebrow"><a href="board.html" style="color:inherit">${lang === "ko" ? "← News" : "← News"}</a></div>
          <h1>${escapeHtml(title || "")}</h1>
          <div class="news-detail-meta">
            ${entry.date ? `<span class="news-detail-date">${escapeHtml(entry.date)}</span>` : ""}
            ${entry.category ? `<span class="news-cat">${escapeHtml(entry.category)}</span>` : ""}
          </div>
        </div>
      </section>

      <section class="section" style="padding-top: var(--space-8);">
        <div class="container-narrow">
          ${body ? `<div class="news-body">${body}</div>` : ""}
          ${images.length ? `
            <div class="news-images" style="margin-top: var(--space-8);">
              ${images.map(im => {
                const cap = escapeHtml(lang === "ko"
                  ? (im.caption_ko || im.caption_en || "")
                  : (im.caption_en || im.caption_ko || ""));
                return `<figure><img src="${escapeAttr(im.src)}" alt="${escapeAttr(cap)}" loading="lazy" />${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
              }).join("")}
            </div>` : ""}

          <hr class="divider" />
          <div class="topic-nav">
            <a class="topic-nav-link prev" href="board-detail.html?id=${encodeURIComponent(prev.id)}">
              <span class="topic-nav-dir">${lang === "ko" ? "← 이전" : "← Previous"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? (prev.title_ko || prev.title_en) : (prev.title_en || prev.title_ko))}</span>
            </a>
            <a class="topic-nav-link next" href="board-detail.html?id=${encodeURIComponent(next.id)}">
              <span class="topic-nav-dir">${lang === "ko" ? "다음 →" : "Next →"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? (next.title_ko || next.title_en) : (next.title_en || next.title_ko))}</span>
            </a>
          </div>
        </div>
      </section>`;
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return escapeHtml(s); }
})();
