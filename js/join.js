/* Join Us page — renders data/join.json over the static fallback.
 * The static Korean markup in join.html is what crawlers see; this script
 * replaces it with admin-editable content (same pattern as pi.js). */
(function () {
  "use strict";
  document.addEventListener("site:ready", async () => {
    try {
      const j = await SiteUtils.loadJSON("data/join.json");
      render(j);
    } catch (err) { console.error(err); /* static fallback stays */ }
  });

  function pick(obj, key, lang) {
    return obj[key + "_" + lang] || obj[key + "_ko"] || "";
  }

  function render(j) {
    const lang = SiteUtils.getLang();

    setText("join-lead-title", pick(j, "lead_title", lang));
    setText("join-lead-desc", pick(j, "lead_desc", lang));

    const steps = document.getElementById("join-steps");
    if (steps && Array.isArray(j.steps) && j.steps.length) {
      steps.innerHTML = j.steps.map((s, i) => `
        <div class="contact-row">
          <div class="label">STEP ${i + 1}</div>
          <div class="value">
            <strong>${escapeHtml(pick(s, "title", lang))}</strong>
            <div style="color:var(--c-text-muted);margin-top:.25rem">${escapeHtml(pick(s, "desc", lang))}</div>
          </div>
        </div>`).join("");
    }

    setText("join-guide-title", pick(j, "guide_title", lang));
    setText("join-guide-desc", pick(j, "guide_desc", lang));
    const mailBtn = document.getElementById("join-guide-email");
    if (mailBtn && j.guide_email) {
      mailBtn.textContent = "✉ " + j.guide_email;
      mailBtn.setAttribute("href", "mailto:" + j.guide_email + "?subject=%5BEEML%20%EC%A7%80%EC%9B%90%5D%20");
    }

    const faq = document.getElementById("join-faq");
    if (faq && Array.isArray(j.faqs) && j.faqs.length) {
      faq.innerHTML = j.faqs.map((f, i) => `
        <div class="contact-row">
          <div class="label">Q${i + 1}</div>
          <div class="value">
            <strong>${escapeHtml(pick(f, "q", lang))}</strong>
            <div style="color:var(--c-text-muted);margin-top:.25rem">${escapeHtml(pick(f, "a", lang))}</div>
          </div>
        </div>`).join("");
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el && text) el.textContent = text;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
