/* Research detail page — renders one topic from research_topics.json based on ?id= */
(function () {
  "use strict";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("research-detail-root");
    if (!root) return;
    try {
      const [topics, pubs] = await Promise.all([
        SiteUtils.loadJSON("data/research_topics.json"),
        SiteUtils.loadJSON("data/publications.json").catch(() => [])
      ]);
      render(root, topics, pubs);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<section class="section"><div class="container-narrow"><p>Failed to load research topic.</p></div></section>`;
    }
  });

  function render(root, topics, pubs) {
    const lang = SiteUtils.getLang();
    const id = new URLSearchParams(location.search).get("id");
    const topic = topics.find(t => t.id === id) || topics[0];
    if (!topic) {
      root.innerHTML = renderNotFound(topics, lang);
      return;
    }
    const sorted = topics.slice().sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(t => t.id === topic.id);
    const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
    const next = sorted[(idx + 1) % sorted.length];

    const name = lang === "ko" ? topic.title_ko : topic.title_en;
    const summary = lang === "ko" ? topic.summary_ko : topic.summary_en;
    const heading = lang === "ko" ? (topic.heading_ko || topic.heading_en || "") : (topic.heading_en || topic.heading_ko || "");
    const subheading = lang === "ko" ? (topic.subheading_ko || topic.subheading_en || "") : (topic.subheading_en || topic.subheading_ko || "");
    const detail = lang === "ko" ? (topic.detail_body_ko || "") : (topic.detail_body_en || "");
    const images = Array.isArray(topic.images) ? topic.images : [];
    const repPapers = topic.representative_papers || [];

    // Auto-set document title
    document.title = `${name} · Research · EEML`;

    root.innerHTML = `
      <section class="page-header">
        <div class="container-narrow">
          <div class="eyebrow"><a href="research.html" style="color:inherit">← Research</a></div>
          <h1>${escapeHtml(name)}</h1>
          <p style="max-width: 680px;">${escapeHtml(summary)}</p>
        </div>
      </section>

      <section class="section" style="padding-top: var(--space-12);">
        <div class="container-narrow">
          ${images.length ? `
            <div class="research-hero-images">
              ${images.map(src => `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(name)}" loading="lazy" /></figure>`).join("")}
            </div>` : `<div class="topic-hero-svg">${topic.svg || ""}</div>`}

          ${heading ? `
            <div class="research-heading-block">
              <h2 class="research-heading">${escapeHtml(heading)}</h2>
              ${subheading ? `<p class="research-subheading">${escapeHtml(subheading)}</p>` : ""}
            </div>` : ""}

          ${(topic.keywords || []).length ? `
            <div class="keywords" style="margin: var(--space-8) 0;">
              ${topic.keywords.map(k => `<span class="kw">${escapeHtml(k)}</span>`).join("")}
            </div>` : ""}

          ${detail ? `<div class="detail-body">${detail.split("\n\n").map(p => `<p>${escapeHtml(p)}</p>`).join("")}</div>` : ""}

          ${repPapers.length ? `
            <hr class="divider" />
            <h2 style="font-family: var(--font-sans); font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--c-text); margin-bottom: var(--space-6);">Selected Publications</h2>
            <ul class="detail-pubs">${repPapers.map(p => renderPaper(p)).join("")}</ul>
          ` : ""}

          <hr class="divider" />
          <div class="topic-nav">
            <a class="topic-nav-link prev" href="research-detail.html?id=${prev.id}">
              <span class="topic-nav-dir">${lang === "ko" ? "← 이전" : "← Previous"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? prev.title_ko : prev.title_en)}</span>
            </a>
            <a class="topic-nav-link next" href="research-detail.html?id=${next.id}">
              <span class="topic-nav-dir">${lang === "ko" ? "다음 →" : "Next →"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? next.title_ko : next.title_en)}</span>
            </a>
          </div>
        </div>
      </section>`;
  }

  function renderPaper(p) {
    if (typeof p === "string") return `<li>${escapeHtml(p)}</li>`;
    return `
      <li>
        <div class="pub-line">
          <div class="pub-title">${escapeHtml(p.title)}</div>
          <div class="pub-meta"><i>${escapeHtml(p.venue || "")}</i>${p.year ? " · " + p.year : ""}</div>
        </div>
      </li>`;
  }

  function renderNotFound(topics, lang) {
    const items = topics.map(t => `<li><a href="research-detail.html?id=${t.id}">${escapeHtml(lang === "ko" ? t.title_ko : t.title_en)}</a></li>`).join("");
    return `
      <section class="section">
        <div class="container-narrow">
          <div class="eyebrow"><a href="research.html" style="color:inherit">← Research</a></div>
          <h1>Not Found</h1>
          <p>Available topics:</p>
          <ul>${items}</ul>
        </div>
      </section>`;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
