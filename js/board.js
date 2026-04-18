/* News page — category tabs + expandable rich-body items with images */
(function () {
  "use strict";
  const TABS = [
    { id: "all", k: "all" },
    { id: "news", k: "news" },
    { id: "notice", k: "notice" },
    { id: "seminar", k: "seminar" },
  ];
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

    host.querySelectorAll("[data-action=toggle-news]").forEach((btn) => {
      btn.onclick = () => {
        const li = btn.closest(".news-item");
        if (!li) return;
        li.classList.toggle("is-open");
        btn.textContent = li.classList.contains("is-open")
          ? (lang === "ko" ? "접기 ▲" : "Collapse ▲")
          : (lang === "ko" ? "본문 보기 ▼" : "Read more ▼");
      };
    });
  }

  function renderItem(n, lang) {
    const title = escapeHtml(lang === "ko" ? (n.title_ko || n.title_en) : (n.title_en || n.title_ko));
    const body = lang === "ko"
      ? (n.body_ko || n.body_en || "")
      : (n.body_en || n.body_ko || "");
    const images = Array.isArray(n.images) ? n.images : [];
    const hasRich = body.trim().length > 0 || images.length > 0;

    // Short excerpt from body (strip tags + truncate)
    const excerpt = truncate(stripTags(body), 140);

    return `
      <li class="news-item">
        <div class="date">${escapeHtml(n.date || "")}</div>
        <div class="body">
          <div class="news-head">
            <div class="title">${title}</div>
            ${n.category ? `<span class="news-cat">${escapeHtml(n.category)}</span>` : ""}
          </div>
          ${excerpt ? `<div class="excerpt">${escapeHtml(excerpt)}</div>` : ""}
          ${hasRich ? `
            <div class="news-detail">
              ${body ? `<div class="news-body">${body}</div>` : ""}
              ${images.length ? `
                <div class="news-images">
                  ${images.map(im => {
                    const cap = escapeHtml(lang === "ko"
                      ? (im.caption_ko || im.caption_en || "")
                      : (im.caption_en || im.caption_ko || ""));
                    return `<figure><img src="${escapeAttr(im.src)}" alt="${escapeAttr(cap)}" loading="lazy" />${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
                  }).join("")}
                </div>` : ""}
            </div>
            <button class="news-toggle" data-action="toggle-news">${lang === "ko" ? "본문 보기 ▼" : "Read more ▼"}</button>
          ` : ""}
        </div>
      </li>`;
  }

  function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
  function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
