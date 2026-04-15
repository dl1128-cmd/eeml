/* Research page */
(function () {
  "use strict";
  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("research-root");
    if (!root) return;
    try {
      const topics = await SiteUtils.loadJSON("data/research_topics.json");
      render(root, topics);
    } catch (err) { console.error(err); }
  });

  function render(root, topics) {
    const lang = SiteUtils.getLang();
    root.innerHTML = `<div class="topic-grid">${
      topics.sort((a, b) => a.order - b.order).map(t => {
        const name = lang === "ko" ? t.title_ko : t.title_en;
        const desc = lang === "ko" ? t.summary_ko : t.summary_en;
        return `
          <a class="topic-card" id="${t.id}" href="research-detail.html?id=${t.id}">
            <div class="topic-svg">${t.svg || ""}</div>
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(desc)}</p>
            <div class="keywords">${(t.keywords || []).map(k => `<span class="kw">${escapeHtml(k)}</span>`).join("")}</div>
            <div class="topic-cta">${lang === "ko" ? "자세히 보기 →" : "Read more →"}</div>
          </a>`;
      }).join("")
    }</div>`;
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
})();
