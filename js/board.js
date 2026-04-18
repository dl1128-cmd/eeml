/* News page — category tabs + item list linking to detail page */
(function () {
  "use strict";
  const TABS = [
    { id: "all", k: "all" },
    { id: "news", k: "news" },
    { id: "notice", k: "notice" },
    { id: "seminar", k: "seminar" },
  ];
  // Category badge auto-hides for items older than this many days
  const BADGE_MAX_DAYS = 30;

  let items = [];
  let cur = "all";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("board-root");
    if (!root) return;
    try {
      items = await SiteUtils.loadJSON("data/news.json");
      items.sort((a, b) => (a.date < b.date ? 1 : -1));
      renderTabs(root);
      renderList(root);
    } catch (err) {
      console.error(err);
    }
  });

  function renderTabs(root) {
    const i18n = SiteUtils.getI18n();
    const wrap = document.createElement("div");
    wrap.className = "board-tabs";
    TABS.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "board-tab" + (t.id === cur ? " active" : "");
      btn.textContent = t.id === "all"
        ? (SiteUtils.getLang() === "ko" ? "전체" : "All")
        : (i18n?.board?.[t.k] || t.k);
      btn.onclick = () => {
        cur = t.id;
        wrap.querySelectorAll(".board-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderList(root);
      };
      wrap.appendChild(btn);
    });
    root.appendChild(wrap);
    const host = document.createElement("div");
    host.id = "board-list";
    root.appendChild(host);
  }

  function renderList(root) {
    const host = root.querySelector("#board-list");
    const lang = SiteUtils.getLang();
    const filtered = cur === "all" ? items : items.filter((x) => x.category === cur);
    if (!filtered.length) {
      host.innerHTML =
        `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0">No items.</p>`;
      return;
    }
    host.innerHTML = `<ul class="news-list">${filtered
      .map((n) => renderItem(n, lang))
      .join("")}</ul>`;
  }

  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    if (isNaN(d)) return Infinity;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  }

  function renderItem(n, lang) {
    const title = escapeHtml(lang === "ko" ? (n.title_ko || n.title_en) : (n.title_en || n.title_ko));
    const body = lang === "ko"
      ? (n.body_ko || n.body_en || "")
      : (n.body_en || n.body_ko || "");
    const excerpt = truncate(stripTags(body), 140);
    const showBadge = !!n.category && daysSince(n.date) <= BADGE_MAX_DAYS;

    return `
      <li class="news-item">
        <div class="date">${escapeHtml(n.date || "")}</div>
        <div class="body">
          <a class="news-link" href="board-detail.html?id=${encodeURIComponent(n.id)}">
            <div class="news-head">
              <div class="title">${title}</div>
              ${showBadge ? `<span class="news-cat">${escapeHtml(n.category)}</span>` : ""}
            </div>
            ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ""}
          </a>
        </div>
      </li>`;
  }

  function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
  function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
