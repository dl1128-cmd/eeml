/* Publications page — type filter + year filter + Scholar auto-cite update */
(function () {
  "use strict";

  const TYPE_FILTERS = [
    { id: "top", lk: "Selected", lk_ko: "대표 논문", test: p => p.top_pick === true },
    { id: "journal", lk: "Journal", lk_ko: "저널", test: p => p.type === "journal" },
    { id: "conference", lk: "Conference", lk_ko: "학회", test: p => p.type === "conference" },
    // "저서·특허" includes both publication entries of type book/patent
    // AND all entries from data/patents.json (separate file). Clicking
    // this filter also scrolls to the Patents section below.
    { id: "book", lk: "Book / Patent", lk_ko: "저서·특허",
      test: p => p.type === "book" || p.type === "patent",
      extraCount: () => patentsCount,
      scrollTo: "patents-section" },
    { id: "all", lk: "All", lk_ko: "전체", test: () => true }
  ];

  let pubs = [];
  let patentsCount = 0;
  let curType = "all";
  let curYear = "all";  // "all" or a year number

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("publications-root");
    if (!root) return;
    try {
      const [pubsData, covers, patents] = await Promise.all([
        SiteUtils.loadJSON("data/publications.json"),
        SiteUtils.loadJSON("data/journal_covers.json").catch(() => []),
        SiteUtils.loadJSON("data/patents.json").catch(() => [])
      ]);
      pubs = pubsData || [];
      const patentsList = patents || [];
      patentsCount = patentsList.filter(p => p && p.title).length;
      renderAll(root);
      renderJournalCovers(covers || []);
      renderPatents(patentsList);
    } catch (err) { console.error(err); }
  });

  /* ========== Patents ========== */
  function renderPatents(patents) {
    const section = document.getElementById("patents-section");
    const root = document.getElementById("patents-root");
    if (!section || !root) return;
    const list = (patents || []).filter(p => p && p.title);
    if (!list.length) { section.hidden = true; return; }
    section.hidden = false;
    const lang = (window.SiteUtils && SiteUtils.getLang) ? SiteUtils.getLang() : "en";

    // Group by type, newest first within each
    const sortDesc = (a, b) => {
      const yb = Number(b.year) || 0;
      const ya = Number(a.year) || 0;
      if (yb !== ya) return yb - ya;
      return (Number(b.number) || 0) - (Number(a.number) || 0);
    };
    const intl = list.filter(p => p.type === "international").sort(sortDesc);
    const dom  = list.filter(p => p.type !== "international").sort(sortDesc);

    const groups = [];
    if (intl.length) groups.push({ label: lang === "ko" ? "국제 특허" : "International", items: intl });
    if (dom.length)  groups.push({ label: lang === "ko" ? "국내 특허" : "Domestic", items: dom });

    root.innerHTML = groups.map(g => {
      // Descending numbering within each group: top entry (newest) = N,
      // bottom entry (oldest) = 1.
      let counter = g.items.length;
      const items = g.items.map(p => renderPatentItem(p, counter--, lang)).join("");
      return `
        <div class="patent-group">
          <h3 class="patent-group-title">${escapeHtml(g.label)} <span class="patent-group-count">${g.items.length}</span></h3>
          <ol class="patent-list">${items}</ol>
        </div>`;
    }).join("");
  }

  function renderPatentItem(p, displayNum, lang) {
    const inventors = Array.isArray(p.inventors) ? p.inventors.join(", ") : (p.inventors || "");
    const year = p.year ? `<span class="patent-year">${escapeHtml(String(p.year))}</span>` : "";
    const badges = [];
    if (p.application_no) {
      const label = lang === "ko" ? "출원" : "Application";
      badges.push(`<span class="patent-badge patent-badge-app">${label}&nbsp;${escapeHtml(p.application_no)}</span>`);
    }
    if (p.registration_no) {
      const label = lang === "ko" ? "등록" : "Registration";
      badges.push(`<span class="patent-badge patent-badge-reg">${label}&nbsp;${escapeHtml(p.registration_no)}</span>`);
    }
    if (p.status_text && !p.application_no && !p.registration_no) {
      badges.push(`<span class="patent-badge">${escapeHtml(p.status_text)}</span>`);
    }
    return `
      <li class="patent-item">
        <div class="patent-row">
          <span class="patent-title"><span class="patent-num">${displayNum}.</span>${escapeHtml(p.title)}</span>
          ${badges.length ? `<span class="patent-badges">${badges.join("")}</span>` : ""}
          ${year}
        </div>
        ${inventors ? `<div class="patent-inventors">${escapeHtml(inventors)}</div>` : ""}
      </li>`;
  }

  /* ========== Journal Cover Gallery ========== */
  function renderJournalCovers(covers) {
    const section = document.getElementById("journal-covers-section");
    const track = document.getElementById("journal-covers-track");
    const navBtns = document.getElementById("jc-nav-btns");
    if (!section || !track) return;
    const list = (covers || []).filter(c => c && c.image)
      .slice()
      .sort((a, b) => {
        // Newest first by year (desc); ties broken by order (asc), then by id.
        const yb = Number(b.year) || 0;
        const ya = Number(a.year) || 0;
        if (yb !== ya) return yb - ya;
        const oa = Number(a.order) || 0;
        const ob = Number(b.order) || 0;
        if (oa !== ob) return oa - ob;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    if (!list.length) { section.hidden = true; return; }
    section.hidden = false;
    const lang = (window.SiteUtils && SiteUtils.getLang) ? SiteUtils.getLang() : "en";
    track.innerHTML = list.map((c, i) => {
      const journal = escapeHtml(c.journal || "");
      const year = c.year ? `<span class="jc-card-year">${escapeHtml(String(c.year))}</span>` : "";
      const meta = journal ? `<div class="jc-card-meta"><span class="jc-card-journal">${journal}</span>${year}</div>` : "";
      const titleSrc = lang === "ko" ? (c.title_ko || c.title || c.title_en || "") : (c.title_en || c.title || c.title_ko || "");
      const title = titleSrc ? `<div class="jc-card-title">${escapeHtml(titleSrc)}</div>` : "";
      return `
        <button class="jc-card" data-jc-idx="${i}" type="button">
          <div class="jc-card-imgwrap"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(journal || titleSrc || 'Journal cover')}" loading="lazy" /></div>
          <div class="jc-card-body">${meta}${title}</div>
        </button>`;
    }).join("");

    track.querySelectorAll("[data-jc-idx]").forEach(el => {
      el.addEventListener("click", () => openCoverModal(list[+el.dataset.jcIdx]));
    });

    if (list.length > 3) {
      navBtns.hidden = false;
      navBtns.querySelectorAll("[data-jc-dir]").forEach(btn => {
        btn.addEventListener("click", () => {
          const card = track.querySelector(".jc-card");
          const step = card ? card.getBoundingClientRect().width + 24 : 320;
          track.scrollBy({ left: btn.dataset.jcDir === "next" ? step : -step, behavior: "smooth" });
        });
      });
    }

    bindCoverModalClose();
  }

  function openCoverModal(c) {
    if (!c) return;
    const lang = (window.SiteUtils && SiteUtils.getLang) ? SiteUtils.getLang() : "en";
    const modal = document.getElementById("jc-modal");
    const img = document.getElementById("jc-modal-img");
    const journalEl = document.getElementById("jc-modal-journal");
    const yearEl = document.getElementById("jc-modal-year");
    const sepEl = document.getElementById("jc-modal-sep");
    const titleEl = document.getElementById("jc-modal-title");
    const descEl = document.getElementById("jc-modal-desc");
    const linkEl = document.getElementById("jc-modal-link");
    img.src = c.image || "";
    img.alt = c.journal || c.title || "Journal cover";
    journalEl.textContent = c.journal || "";
    yearEl.textContent = c.year ? String(c.year) : "";
    sepEl.hidden = !(c.journal && c.year);
    titleEl.textContent = lang === "ko"
      ? (c.title_ko || c.title || c.title_en || "")
      : (c.title_en || c.title || c.title_ko || "");
    descEl.textContent = lang === "ko"
      ? (c.description_ko || c.description_en || "")
      : (c.description_en || c.description_ko || "");
    const href = c.link || (c.doi ? (String(c.doi).startsWith("http") ? c.doi : `https://doi.org/${c.doi}`) : "");
    if (href) { linkEl.href = href; linkEl.hidden = false; } else { linkEl.hidden = true; }
    modal.hidden = false;
    document.body.classList.add("jc-modal-open");
  }

  function bindCoverModalClose() {
    const modal = document.getElementById("jc-modal");
    if (!modal || modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";
    modal.querySelectorAll("[data-jc-close]").forEach(el => {
      el.addEventListener("click", () => {
        modal.hidden = true;
        document.body.classList.remove("jc-modal-open");
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) {
        modal.hidden = true;
        document.body.classList.remove("jc-modal-open");
      }
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // Scholar fetch 완료 시 citations 매칭 + 재렌더
  document.addEventListener("scholar:papers", (e) => {
    const scholarPapers = e.detail || [];
    if (!pubs.length || !scholarPapers.length) return;
    const scholarMap = new Map();
    scholarPapers.forEach(sp => scholarMap.set(normalize(sp.title), sp));

    let matched = 0;
    pubs.forEach(p => {
      const sp = scholarMap.get(normalize(p.title));
      if (sp) {
        if (sp.citations > 0) { p.citations = sp.citations; matched++; }
        if (sp.scholar_link) p.scholar_link = sp.scholar_link;
      }
    });
    if (matched > 0) {
      const root = document.getElementById("publications-root");
      if (root) renderAll(root);
    }
  });

  function renderAll(root) {
    root.innerHTML = "";
    renderFilters(root);
    renderList(root);
  }

  function renderFilters(root) {
    const lang = SiteUtils.getLang();

    // Type filter
    const typeWrap = document.createElement("div");
    typeWrap.className = "pub-filters";
    TYPE_FILTERS.forEach(f => {
      const count = pubs.filter(f.test).length + (f.extraCount ? f.extraCount() : 0);
      const btn = document.createElement("button");
      btn.className = "pub-filter" + (f.id === curType ? " active" : "");
      btn.innerHTML = `${lang === "ko" ? f.lk_ko : f.lk} <span class="pub-filter-count">${count}</span>`;
      btn.onclick = () => {
        curType = f.id;
        renderAll(root);
        if (f.scrollTo) {
          setTimeout(() => {
            const target = document.getElementById(f.scrollTo);
            if (target && !target.hidden) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }, 120);
        }
      };
      typeWrap.appendChild(btn);
    });
    root.appendChild(typeWrap);

    // Year filter
    const years = [...new Set(pubs.map(p => p.year))].sort((a, b) => b - a);
    const yearWrap = document.createElement("div");
    yearWrap.className = "pub-year-filters";
    const yearLabel = document.createElement("span");
    yearLabel.className = "pub-year-label";
    yearLabel.textContent = lang === "ko" ? "연도 " : "Year ";
    yearWrap.appendChild(yearLabel);

    const addYearBtn = (val, label) => {
      const btn = document.createElement("button");
      btn.className = "pub-year-btn" + (String(curYear) === String(val) ? " active" : "");
      btn.textContent = label;
      btn.onclick = () => {
        curYear = val;
        renderAll(root);
      };
      yearWrap.appendChild(btn);
    };

    addYearBtn("all", lang === "ko" ? "전체" : "All");
    years.forEach(y => addYearBtn(y, y));
    root.appendChild(yearWrap);

    const host = document.createElement("div");
    host.id = "pub-list-host";
    root.appendChild(host);
  }

  function renderList(root) {
    const host = root.querySelector("#pub-list-host");
    const tf = TYPE_FILTERS.find(x => x.id === curType);
    let filtered = pubs.filter(tf.test);
    if (curYear !== "all") filtered = filtered.filter(p => p.year === curYear);

    // Total count header
    const countHeader = `<div class="pub-count-header"><span class="pub-count-num">${filtered.length}</span> <span class="pub-count-lbl">of ${pubs.length} publications</span>${curType !== "all" || curYear !== "all" ? ` <button class="pub-count-reset" id="pub-reset">Clear filters ×</button>` : ""}</div>`;

    if (!filtered.length) {
      host.innerHTML = countHeader + `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0">No publications match. Click <b>Clear filters</b>.</p>`;
    } else {
      // Cumulative descending numbering across all groups: the newest
      // publication on top gets the largest number, the oldest at the
      // bottom gets 1. Counter is shared across year groups.
      let counter = filtered.length;
      const byYear = filtered.reduce((acc, p) => { (acc[p.year] ||= []).push(p); return acc; }, {});
      host.innerHTML = countHeader + Object.keys(byYear).sort((a, b) => b - a).map(year => {
        const items = byYear[year].map(p => itemHTML(p, counter--)).join("");
        return `<section class="pub-year-group"><h3>${year}</h3><ul class="pub-list">${items}</ul></section>`;
      }).join("");
    }

    const resetBtn = host.querySelector("#pub-reset");
    if (resetBtn) resetBtn.onclick = () => { curType = "all"; curYear = "all"; renderAll(root); };

    if (window.ViewsAPI) ViewsAPI.populate(host, "publications");

    host.addEventListener("click", e => {
      const a = e.target.closest("a[data-pub-id]");
      if (!a || !window.ViewsAPI) return;
      const pid = a.getAttribute("data-pub-id");
      if (pid) ViewsAPI.bumpAndGet("publications", pid);
    }, { once: false });
  }

  function itemHTML(p, n) {
    const top = p.top_pick ? `<span class="badge-top">Selected</span>` : "";
    const href = resolveLink(p);
    const attrs = href.startsWith("data:")
      ? `download="${escapeHtml((typeof p.link === "object" && p.link.name) || "paper.pdf")}"`
      : `target="_blank" rel="noopener"`;
    const pid = escapeHtml(p.id || "");
    const linkAttr = pid ? ` data-pub-id="${pid}"` : "";
    const titleEl = href ? `<a href="${href}" ${attrs}${linkAttr}>${escapeHtml(p.title)}</a>` : escapeHtml(p.title);
    return `
      <li class="pub-item">
        <div class="pub-num">${String(n).padStart(2, "0")}</div>
        <div class="pub-body">
          <div class="title">${titleEl}${top}</div>
          <div class="meta">${escapeHtml(p.authors)} · <span class="venue">${escapeHtml(p.venue)}</span>${p.volume ? ", " + escapeHtml(p.volume) : ""} (${p.year})</div>
        </div>
        <div class="cite-count">
          <span class="n">${p.citations ?? 0}</span><span class="lbl">cites</span>
          ${pid ? `<span class="view-count" data-views-publications="${pid}" hidden></span>` : ""}
        </div>
      </li>`;
  }

  function resolveLink(p) {
    // Priority: uploaded PDF → explicit URL → DOI → Scholar link → Scholar search fallback
    if (p.link) {
      if (typeof p.link === "object" && p.link.dataUrl) return p.link.dataUrl;
      if (typeof p.link === "string" && p.link) return p.link;
    }
    if (p.doi) {
      const doi = String(p.doi).trim();
      return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
    }
    if (p.scholar_link) return p.scholar_link;
    // Fallback — search by title on Scholar
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`;
  }

  function normalize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
