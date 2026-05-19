/* EEML — Admin panel (Energy Electrode Materials Lab, Dongsoo Lee)
 *
 * Pure client-side editor for publications / members / news / research topics / config / pi.
 * Saves = generates updated JSON and triggers browser download.
 *
 * SECURITY NOTE
 * -------------
 * Soft gate — prevents accidental edits by students, NOT real authentication.
 * Password hash embedded in source. True security requires a backend.
 */
(function () {
  "use strict";

  const STATE = {
    authed: false,
    data: {
      publications: null,
      members: null,
      news: null,
      topics: null,
      config: null,
      pi: null,
      announcement: null,
      gallery: null
    },
    currentTab: "pi",
    modal: { onSave: null }
  };

  const STATS_NS = "eeml-dongsoo-lee-2026";
  const STATS_BASE = "https://api.counterapi.dev/v1/" + STATS_NS;

  const LS_PW_HASH = "eeml:admin:pwhash";
  // SHA-256 of "eeml2026" — the default password (change after first login)
  const DEFAULT_PW_HASH = "98cafe637643651851f9b745a5f6a3062948a28f894a7f1280d11707e90a83a8";

  /* =========================================================================
   * Image picker + client-side resize
   * base64 로 JSON 에 저장 → 별도 파일 업로드 불필요
   * ========================================================================= */
  function resizeImageFile(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("no file"));
      if (!file.type.startsWith("image/")) return reject(new Error("이미지 파일만 가능"));
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxW || h > maxH) {
            const r = Math.min(maxW / w, maxH / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality || 0.85));
        };
        img.onerror = () => reject(new Error("이미지 읽기 실패"));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("파일 읽기 실패"));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Mount an image picker into a container element.
   * @param {HTMLElement} host
   * @param {string} currentSrc — existing image url or data url
   * @param {{maxW:number, maxH:number}} opts
   * @param {(dataUrl:string)=>void} onChange
   */
  /**
   * Mount an image picker. When opts.enableFocus is true, an interactive
   * focal-point marker is overlaid on the preview — drag it to set the
   * CSS object-position used by the public site. Optional initial position
   * is passed via opts.initialPos ("X% Y%"). The default focal point is
   * "50% 20%" (head/hair friendly).
   */
  function mountImagePicker(host, currentSrc, opts, onChange) {
    const safeSrc = currentSrc || "";
    const isDataUrl = safeSrc.startsWith("data:");
    const hasRealImage = safeSrc && (isDataUrl || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(safeSrc));
    const enableFocus = !!opts.enableFocus;
    const DEFAULT_POS = "50% 20%";

    host.innerHTML = `
      <div class="admin-img-picker">
        <div class="admin-img-preview">
          ${hasRealImage
            ? `<img src="${escapeAttr(safeSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="admin-img-placeholder" style="display:none">이미지 없음</div>`
            : `<div class="admin-img-placeholder">사진을<br/>선택하세요</div>`}
        </div>
        ${enableFocus ? `<div class="admin-img-focus-hint">사진 위 <b>아무 곳이나 클릭</b>하거나 <b>+ 마커를 드래그</b>해서 얼굴/중심 위치를 맞추세요 <span class="admin-img-focus-reset" data-action="reset-pos">기본값으로 ↺</span></div>` : ""}
        <div class="admin-img-controls">
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            📁 사진 파일 선택
            <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" />
          </label>
          <button type="button" class="btn btn-ghost btn-sm" data-action="clear">✕ 사진 제거</button>
          <div class="admin-img-hint">
            ✅ JPG · PNG · WebP 지원<br/>
            ✅ 자동 ${opts.maxW}×${opts.maxH} 리사이즈 → JSON 안에 인라인 저장<br/>
            ✅ <b>FTP 업로드 불필요</b> — JSON 저장하면 사진까지 같이 포함됨
          </div>
        </div>
      </div>
    `;
    let value = safeSrc;
    let pos = (opts.initialPos || "").trim(); // empty = use CSS default; non-empty = override
    const input = host.querySelector('input[type=file]');
    const preview = host.querySelector('.admin-img-preview');

    /* ---------- focal-point marker (only if enableFocus) ---------- */
    let marker = null;

    function parsePos(s) {
      // accept "X% Y%" or "X%" -> treat as "X% 50%"
      const parts = (s || "").trim().split(/\s+/);
      const x = parseFloat(parts[0]);
      const y = parts.length >= 2 ? parseFloat(parts[1]) : 50;
      if (isNaN(x) || isNaN(y)) return null;
      return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    }

    function updateMarkerVisualOnly(xPct, yPct) {
      if (!marker) return;
      marker.style.left = xPct + "%";
      marker.style.top = yPct + "%";
    }

    function applyPosToPreview() {
      const img = preview.querySelector('img');
      if (!img) return;
      img.style.objectFit = "cover";
      img.style.objectPosition = pos || DEFAULT_POS;
    }

    function mountMarker() {
      if (!enableFocus) return;
      const img = preview.querySelector('img');
      if (!img) return;
      // Remove any prior marker
      const old = preview.querySelector('.admin-img-focus-marker');
      if (old) old.remove();
      // Ensure preview shows the image as the public site would (cover crop)
      // so the focal point reflects what users will see.
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.draggable = false;  // disable native HTML5 drag-image ghost
      // Match the public-site aspect ratio for accurate focal positioning:
      //   PI photo card = 4 / 5, Member card = 1 / 1
      // opts.previewAspect lets the caller override (e.g. "4 / 5").
      const aspect = opts.previewAspect || "1 / 1";
      preview.style.aspectRatio = aspect;
      preview.classList.add("focus-enabled");
      applyPosToPreview();

      marker = document.createElement('div');
      marker.className = 'admin-img-focus-marker';
      marker.title = '드래그하여 사진 중심 이동';
      const init = parsePos(pos) || parsePos(DEFAULT_POS);
      updateMarkerVisualOnly(init.x, init.y);
      preview.appendChild(marker);

      let dragging = false;
      function setPosFromEvent(ev) {
        const rect = preview.getBoundingClientRect();
        const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
        const cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
        const xPct = Math.max(0, Math.min(100, Math.round((cx / rect.width) * 100)));
        const yPct = Math.max(0, Math.min(100, Math.round((cy / rect.height) * 100)));
        pos = `${xPct}% ${yPct}%`;
        updateMarkerVisualOnly(xPct, yPct);
        applyPosToPreview();
      }
      function onDown(ev) {
        ev.preventDefault();
        dragging = true;
        setPosFromEvent(ev);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
      }
      function onMove(ev) {
        if (!dragging) return;
        ev.preventDefault();
        setPosFromEvent(ev);
      }
      function onUp() {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }
      marker.addEventListener('mousedown', onDown);
      marker.addEventListener('touchstart', onDown, { passive: false });
      // Click anywhere in preview to jump
      preview.addEventListener('mousedown', (ev) => {
        if (ev.target === marker) return;
        if (!preview.querySelector('img')) return;
        onDown(ev);
      });
    }

    function mountMarkerAfterImageReady() {
      if (!enableFocus) return;
      const img = preview.querySelector('img');
      if (!img) return;
      if (img.complete && img.naturalWidth > 0) {
        mountMarker();
      } else {
        img.addEventListener('load', () => mountMarker(), { once: true });
        // Failsafe: if load never fires within 1s, still attempt mount
        setTimeout(() => mountMarker(), 1000);
      }
    }

    if (hasRealImage && enableFocus) mountMarkerAfterImageReady();

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file, opts.maxW, opts.maxH, 0.85);
        value = dataUrl;
        preview.innerHTML = `<img src="${dataUrl}" alt="" draggable="false" /><div style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;pointer-events:none;z-index:3">${Math.round(dataUrl.length / 1024)}KB</div>`;
        if (enableFocus) {
          pos = "";  // new image — reset to default
          mountMarkerAfterImageReady();
        }
        onChange(value);
      } catch (err) {
        toast(err.message || "이미지 처리 실패", "error");
      }
      input.value = ""; // allow re-pick of same file
    };
    host.querySelector('[data-action=clear]').onclick = () => {
      value = "";
      pos = "";
      marker = null;
      preview.classList.remove("focus-enabled");
      preview.style.aspectRatio = "";
      preview.innerHTML = `<div class="admin-img-placeholder">이미지 없음</div>`;
      onChange("");
    };
    if (enableFocus) {
      const resetBtn = host.querySelector('[data-action=reset-pos]');
      if (resetBtn) resetBtn.onclick = () => {
        pos = "";
        applyPosToPreview();
        const init = parsePos(DEFAULT_POS);
        updateMarkerVisualOnly(init.x, init.y);
      };
    }
    return {
      getValue: () => value,
      getPos: () => pos, // "" means use CSS default
    };
  }

  /* =========================================================================
   * Generic file picker (PDF / 문서 등 이미지 외 파일)
   * - 파일 업로드 → base64 data URL 로 변환 → JSON 에 인라인 저장
   * - 또는 외부 URL 직접 입력 허용 (대용량 PDF 용)
   * ========================================================================= */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ dataUrl: e.target.result, name: file.name, size: file.size, type: file.type });
      reader.onerror = () => reject(new Error("파일 읽기 실패"));
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  /**
   * Mount a file picker that stores either:
   *   - { kind: 'file', dataUrl, name, size } — uploaded file, base64 inline
   *   - { kind: 'url', url } — external link
   *   - null — empty
   *
   * @param {HTMLElement} host
   * @param {object|string} current — existing value ({kind,dataUrl,name} or URL string or empty)
   * @param {{accept:string, maxSizeMB:number, label:string}} opts
   * @param {(value)=>void} onChange
   */
  function mountFilePicker(host, current, opts, onChange) {
    opts = Object.assign({ accept: "application/pdf", maxSizeMB: 5, label: "PDF 파일" }, opts);

    // Normalize current value
    let value = null;
    if (current) {
      if (typeof current === "object" && current.dataUrl) value = { kind: "file", ...current };
      else if (typeof current === "string" && current.startsWith("data:")) value = { kind: "file", dataUrl: current, name: "(파일)", size: 0 };
      else if (typeof current === "string" && current) value = { kind: "url", url: current };
    }

    function render() {
      const hasValue = !!value;
      let preview = "";
      if (hasValue) {
        if (value.kind === "file") {
          preview = `
            <div class="admin-file-card">
              <span class="admin-file-icon">📄</span>
              <div class="admin-file-info">
                <div class="admin-file-name">${escapeHtml(value.name || "파일")}</div>
                <div class="admin-file-meta">업로드됨 · ${formatBytes(value.size || (value.dataUrl?.length * 3 / 4))}</div>
              </div>
              <a href="${value.dataUrl}" download="${escapeAttr(value.name || 'file')}" class="btn btn-ghost btn-sm">↓ 다운로드</a>
            </div>`;
        } else {
          preview = `
            <div class="admin-file-card">
              <span class="admin-file-icon">🔗</span>
              <div class="admin-file-info">
                <div class="admin-file-name">${escapeHtml(value.url)}</div>
                <div class="admin-file-meta">외부 링크</div>
              </div>
              <a href="${value.url}" target="_blank" class="btn btn-ghost btn-sm">↗ 열기</a>
            </div>`;
        }
      }
      host.innerHTML = `
        <div class="admin-file-picker">
          ${preview}
          <div class="admin-file-actions">
            <label class="btn btn-primary btn-sm" style="cursor:pointer">
              📁 ${opts.label} 업로드
              <input type="file" accept="${opts.accept}" style="display:none" />
            </label>
            ${hasValue ? `<button type="button" class="btn btn-ghost btn-sm" data-action="clear">✕ 제거</button>` : ''}
          </div>
          <div class="admin-file-or">또는 외부 URL 직접 입력:</div>
          <input type="url" class="admin-file-url" placeholder="https://..." value="${value && value.kind === 'url' ? escapeAttr(value.url) : ''}" />
          <div class="admin-file-hint">
            ✅ 파일 업로드 시 JSON 안에 인라인 저장 (최대 ${opts.maxSizeMB}MB)<br/>
            💡 용량이 큰 파일은 Google Drive / Dropbox 공유 링크를 URL 로 넣으세요
          </div>
        </div>
      `;
      const fileInput = host.querySelector('input[type=file]');
      const urlInput = host.querySelector('.admin-file-url');
      fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > opts.maxSizeMB * 1024 * 1024) {
          toast(`파일이 ${opts.maxSizeMB}MB 를 초과합니다. 외부 URL 을 사용하세요.`, "error");
          fileInput.value = "";
          return;
        }
        try {
          const res = await readFileAsDataURL(file);
          value = { kind: "file", dataUrl: res.dataUrl, name: res.name, size: res.size };
          onChange(value);
          render();
          toast("파일 업로드 완료", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        fileInput.value = "";
      };
      urlInput.oninput = () => {
        const v = urlInput.value.trim();
        if (!v) { value = null; onChange(null); return; }
        if (value && value.kind === "file") return; // don't overwrite uploaded file silently
        value = { kind: "url", url: v };
        onChange(value);
      };
      urlInput.onblur = () => {
        const v = urlInput.value.trim();
        if (v && (!value || value.kind === "url")) {
          value = { kind: "url", url: v };
          onChange(value);
          render();
        }
      };
      const clearBtn = host.querySelector('[data-action=clear]');
      if (clearBtn) clearBtn.onclick = () => {
        value = null;
        onChange(null);
        render();
      };
    }
    render();
    return {
      getValue: () => value,
      // For JSON serialization — returns a format friendly for current schema
      getSerialized: () => {
        if (!value) return "";
        if (value.kind === "file") return { name: value.name, dataUrl: value.dataUrl };
        return value.url;
      }
    };
  }

  /* =========================================================================
   * SHA-256 via WebCrypto
   * ========================================================================= */
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function getStoredHash() {
    return localStorage.getItem(LS_PW_HASH) || DEFAULT_PW_HASH;
  }

  /* =========================================================================
   * Login
   * ========================================================================= */
  async function handleLogin(e) {
    e.preventDefault();
    const pwInput = document.getElementById("password-input");
    const err = document.getElementById("login-error");
    const entered = pwInput.value;
    if (!entered) return;
    const enteredHash = await sha256(entered);
    if (enteredHash === getStoredHash()) {
      STATE.authed = true;
      document.getElementById("login-screen").classList.add("hidden");
      document.getElementById("dashboard").classList.remove("hidden");
      await loadAll();
      bindTabs();
      switchTab("pi");
    } else {
      err.textContent = "비밀번호가 맞지 않습니다.";
      pwInput.value = "";
      pwInput.focus();
    }
  }

  function logout() {
    STATE.authed = false;
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    document.getElementById("password-input").value = "";
    document.getElementById("login-error").textContent = "";
  }

  /* =========================================================================
   * Data loading
   * ========================================================================= */
  async function loadAll() {
    const fetchJSON = async (path) => {
      const res = await fetch(path + "?t=" + Date.now());
      if (!res.ok) throw new Error("Failed to load " + path);
      return res.json();
    };
    try {
      const [pubs, members, news, topics, config, pi, ann, gallery, covers, patents] = await Promise.all([
        fetchJSON("data/publications.json"),
        fetchJSON("data/members.json"),
        fetchJSON("data/news.json"),
        fetchJSON("data/research_topics.json"),
        fetchJSON("data/config.json"),
        fetchJSON("data/pi.json"),
        fetchJSON("data/announcement.json").catch(() => ({ id: "ann-default", enabled: false, title_ko: "", title_en: "", body_ko: "", body_en: "", button_text_ko: "", button_text_en: "", button_url: "", expires: "" })),
        fetchJSON("data/gallery.json").catch(() => []),
        fetchJSON("data/journal_covers.json").catch(() => []),
        fetchJSON("data/patents.json").catch(() => [])
      ]);
      STATE.data.publications = pubs;
      STATE.data.members = members;
      STATE.data.news = news;
      STATE.data.topics = topics;
      STATE.data.config = config;
      STATE.data.pi = pi;
      STATE.data.announcement = ann;
      STATE.data.gallery = gallery;
      STATE.data.covers = covers;
      STATE.data.patents = patents;
    } catch (err) {
      toast("데이터를 불러오지 못했습니다: " + err.message, "error");
      console.error(err);
    }
  }

  /* =========================================================================
   * Save helpers — prefer direct GitHub commit (auto-deploy), fall back to
   * file download when no token is configured.
   * ========================================================================= */
  const LS_GH_TOKEN = "eeml:admin:gh_token";
  const LS_GH_REPO = "eeml:admin:gh_repo";
  const DEFAULT_GH_REPO = "dl1128-cmd/eeml";

  // GitHub tokens are ASCII (^[A-Za-z0-9_-]+$). Strip everything else
  // defensively — clip.exe on Windows adds CRLF, browsers sometimes paste
  // with zero-width chars, etc. Any non-ASCII byte in an HTTP header
  // throws 'String contains non ISO-8859-1 code point'.
  function sanitizeToken(s) {
    return String(s || "").replace(/[^A-Za-z0-9_\-]/g, "");
  }

  function getGH() {
    const rawToken = localStorage.getItem(LS_GH_TOKEN) || "";
    const token = sanitizeToken(rawToken);
    if (token && token !== rawToken) {
      // Stored token was dirty — clean it up so future reads are safe
      localStorage.setItem(LS_GH_TOKEN, token);
    }
    const repo = (localStorage.getItem(LS_GH_REPO) || DEFAULT_GH_REPO).trim();
    return { token, repo };
  }

  // btoa doesn't handle Unicode — encode via TextEncoder for Korean content
  function utf8ToBase64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  async function githubPutFile(path, content, message, attempt = 0, opts = {}) {
    const { token, repo } = getGH();
    if (!token) throw new Error("NO_TOKEN");
    const api = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
    };
    let sha = null;
    try {
      const r = await fetch(api + "?ref=main&_=" + Date.now(), { headers });
      if (r.ok) {
        const j = await r.json();
        sha = j.sha;
      }
    } catch {}
    const body = {
      message: message || `chore(admin): update ${path}`,
      content: opts.preEncoded ? content : utf8ToBase64(content),
      branch: "main",
    };
    if (sha) body.sha = sha;
    const put = await fetch(api, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (put.ok) return put.json();
    if ((put.status === 409 || put.status === 422) && attempt < 2) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      return githubPutFile(path, content, message, attempt + 1, opts);
    }
    // 403 with rate-limit headers = secondary rate limit hit
    if (put.status === 403) {
      const retryAfter = put.headers.get("retry-after");
      const resetEpoch = put.headers.get("x-ratelimit-reset");
      let hint = "GitHub rate limit — 몇 분 기다린 뒤 다시 저장하세요";
      if (retryAfter) hint = `GitHub rate limit — ${retryAfter}초 뒤 재시도 가능`;
      else if (resetEpoch) {
        const ms = (parseInt(resetEpoch) * 1000) - Date.now();
        if (ms > 0) hint = `GitHub rate limit — ${Math.ceil(ms / 60000)}분 뒤 재시도 가능`;
      }
      throw new Error(`RATE_LIMIT: ${hint}`);
    }
    const text = await put.text();
    throw new Error(`GitHub API ${put.status}: ${text.slice(0, 200)}`);
  }

  /* Extract base64 data URLs from a JSON-ish object, upload each as a
   * separate file in assets/images/<category>/, and replace the data URL
   * with the file path. This is the fix for 403/413 'payload too large'
   * errors from the Contents API when members/pi/etc. inlined photos.
   * Also dedupes by SHA-256 hash — identical images reuse one file. */
  const FILENAME_CATEGORY = {
    "members.json": "members",
    "patents.json": "patents",
    "pi.json": "pi",
    "research_topics.json": "research",
    "gallery.json": "gallery",
    "journal_covers.json": "covers",
    "news.json": "news",
    "announcement.json": "announcements",
    "config.json": "config",
  };

  async function uploadDataUrlsAsFiles(obj, category) {
    const cache = new Map(); // hashHex → path
    async function convert(dataUrl) {
      const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
      if (!m) return dataUrl;
      let ext = m[1].toLowerCase();
      if (ext === "jpeg") ext = "jpg";
      const b64 = m[2].replace(/\s+/g, "");
      const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b64));
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
      const path = `assets/images/${category}/${hashHex}.${ext}`;
      if (cache.has(hashHex)) return cache.get(hashHex);
      cache.set(hashHex, path);
      // Upload with preEncoded=true since the data URL already gave us base64
      try {
        await githubPutFile(path, b64, `chore(admin): upload image ${hashHex}.${ext}`, 0, { preEncoded: true });
      } catch (err) {
        // If upload of this specific image fails, fall back to the data URL
        // so the save doesn't wipe the user's photo.
        console.error("image upload failed:", err);
        return dataUrl;
      }
      return path;
    }
    async function walk(o) {
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) {
          const v = o[i];
          if (typeof v === "string" && v.startsWith("data:image/")) {
            o[i] = await convert(v);
          } else if (v && typeof v === "object") {
            await walk(v);
          }
        }
      } else if (o && typeof o === "object") {
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (typeof v === "string" && v.startsWith("data:image/")) {
            o[k] = await convert(v);
          } else if (v && typeof v === "object") {
            await walk(v);
          }
        }
      }
    }
    await walk(obj);
    return obj;
  }

  // Per-file save queue — (a) debounces rapid consecutive edits so a
  // burst of SELECTED toggles becomes one commit, (b) serializes actual
  // PUT requests so we never have two GitHub commits in flight for the
  // same file (eliminates 409 SHA races at the source).
  const _saveQueue = new Map();   // filename -> { timer }
  const _inflight = new Map();    // filename -> Promise

  function queueSave(filename, latestObj, delay = 1200) {
    const prev = _saveQueue.get(filename);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(async () => {
      _saveQueue.delete(filename);
      // Wait for any previous save to finish before starting a new one
      try { await _inflight.get(filename); } catch {}
      // Re-read latest state each run — user might have toggled more
      // between scheduling and firing
      const fresh = _freshStateFor(filename) || latestObj;
      const p = saveJSON(filename, fresh, { quiet: true });
      _inflight.set(filename, p);
      try { await p; } catch {}
      if (_inflight.get(filename) === p) _inflight.delete(filename);
    }, delay);
    _saveQueue.set(filename, { timer });
  }
  function _freshStateFor(filename) {
    switch (filename) {
      case "publications.json":    return STATE.data.publications;
      case "members.json":         return STATE.data.members;
      case "patents.json":         return STATE.data.patents;
      case "news.json":            return STATE.data.news;
      case "gallery.json":         return STATE.data.gallery;
      case "journal_covers.json":  return STATE.data.covers;
      case "research_topics.json": return STATE.data.topics;
      case "pi.json":              return STATE.data.pi;
      case "announcement.json":    return STATE.data.announcement;
      case "config.json":          return STATE.data.config;
      default: return null;
    }
  }

  async function saveJSON(filename, obj, options = {}) {
    const path = options.path || `data/${filename}`;
    const { token } = getGH();
    const quiet = options.quiet === true;
    if (token) {
      try {
        // Strip base64 data URLs out of the JSON and store them as
        // separate image files. Fixes 403/413 'payload too large' from
        // GitHub Contents API when multi-MB photos get inlined.
        const category = FILENAME_CATEGORY[filename] || "uploads";
        const hadDataUrls = JSON.stringify(obj).includes("data:image/");
        if (hadDataUrls) {
          if (!quiet) toast(`📁 사진 파일 분리 업로드 중...`, "info");
          await uploadDataUrlsAsFiles(obj, category);
        }
        const content = JSON.stringify(obj, null, 2) + "\n";
        if (!quiet) toast(`${filename} GitHub에 커밋 중...`, "info");
        await githubPutFile(path, content, `chore(admin): update ${filename}`);
        toast(`✅ ${filename} 저장됨 (1~2분 후 사이트 반영)`, "success");
        return;
      } catch (err) {
        console.error("GitHub save failed:", err);
        const msg = err.message || "";
        const m = /GitHub API (\d+)/.exec(msg);
        const code = m ? m[1] : "";
        if (code === "409" || code === "422") {
          setTimeout(() => queueSave(filename, obj, 300), 200);
          toast(`⏳ 동시 수정 감지 — 잠시 후 자동 재시도`, "info");
          return;
        }
        if (msg.startsWith("RATE_LIMIT:")) {
          toast(`🚦 ${msg.replace("RATE_LIMIT:", "").trim()}`, "error");
          return;
        }
        toast(`✗ GitHub 커밋 실패 (${code || "?"}) — F12 콘솔에서 상세 확인`, "error");
        return;
      }
    }
    // No token configured → download so user can manually commit
    downloadJSON(filename, obj);
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    toast(`${filename} 다운로드 완료. data/ 폴더에 교체하세요.`, "success");
  }

  async function copyJSON(obj) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      toast("클립보드에 복사됨", "success");
    } catch {
      toast("복사 실패 — 브라우저 설정을 확인하세요", "error");
    }
  }

  /* =========================================================================
   * Tabs
   * ========================================================================= */
  function bindTabs() {
    document.querySelectorAll(".admin-tab").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    document.getElementById("logout-btn").addEventListener("click", logout);
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("modal-save").addEventListener("click", () => {
      if (STATE.modal.onSave) STATE.modal.onSave();
    });
  }

  function switchTab(name) {
    STATE.currentTab = name;
    document.querySelectorAll(".admin-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".admin-tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
    const renderer = { publications: renderPubs, patents: renderPatents, members: renderMembers, pi: renderPI, news: renderNews, topics: renderTopics, gallery: renderGallery, covers: renderCovers, announcement: renderAnnouncement, stats: renderStats, config: renderConfig, settings: renderSettings }[name];
    if (renderer) renderer();
  }

  /* =========================================================================
   * Patents editor
   * ========================================================================= */
  function renderPatents() {
    const host = document.getElementById("tab-patents");
    const items = (STATE.data && STATE.data.patents) || [];
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>특허 (Patents) <span style="font-weight:400;color:var(--c-text-light);font-size:.75em">${items.length}건</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-primary" id="pat-add">+ 특허 추가</button>
        </div>
      </div>
      <div id="pat-list"></div>
    `;
    renderPatentList();
    host.querySelector("#pat-add").onclick = () => editPatent(-1);
  }

  function renderPatentList() {
    const list = document.getElementById("pat-list");
    const items = (STATE.data && STATE.data.patents) || [];
    if (!items.length) {
      list.innerHTML = `<p style="color:var(--c-text-light);padding:2rem 0;text-align:center">등록된 특허가 없습니다. <b>+ 특허 추가</b> 버튼으로 추가하세요.</p>`;
      return;
    }
    list.innerHTML = `
      <table class="admin-table">
        <thead><tr>
          <th style="width:60px">구분</th>
          <th style="width:50px">#</th>
          <th>제목</th>
          <th style="width:140px">발명자</th>
          <th style="width:60px">연도</th>
          <th style="width:140px">번호</th>
          <th style="width:100px"></th>
        </tr></thead>
        <tbody>
          ${items.map((p, i) => {
            const inv = Array.isArray(p.inventors) ? p.inventors.join(", ") : (p.inventors || "");
            const typeBadge = p.type === "international" ? `<span class="patent-badge patent-badge-app">INT'L</span>` : `<span class="patent-badge">국내</span>`;
            const num = p.registration_no ? `등록 ${escapeHtml(p.registration_no)}` : (p.application_no ? `출원 ${escapeHtml(p.application_no)}` : (p.status_text || ""));
            return `
              <tr>
                <td>${typeBadge}</td>
                <td style="font-family:var(--font-mono);color:var(--c-text-muted)">${escapeHtml(String(p.number ?? ""))}</td>
                <td>${escapeHtml(p.title || "")}</td>
                <td style="font-size:.85em;color:var(--c-text-muted)">${escapeHtml(inv.length > 40 ? inv.slice(0, 40) + "…" : inv)}</td>
                <td>${escapeHtml(String(p.year ?? ""))}</td>
                <td style="font-family:var(--font-mono);font-size:.78em">${num}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-pat-edit="${i}">✎ 편집</button>
                  <button class="btn btn-ghost btn-sm" data-pat-del="${i}" style="color:#dc2626">삭제</button>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
    list.querySelectorAll("[data-pat-edit]").forEach(b => b.onclick = () => editPatent(+b.dataset.patEdit));
    list.querySelectorAll("[data-pat-del]").forEach(b => b.onclick = () => {
      if (!confirm("이 특허를 삭제하시겠습니까?")) return;
      STATE.data.patents.splice(+b.dataset.patDel, 1);
      renderPatentList();
      saveJSON("patents.json", STATE.data.patents);
    });
  }

  function editPatent(idx) {
    const isNew = idx === -1;
    const existing = !isNew ? STATE.data.patents[idx] : null;
    const items = (STATE.data && STATE.data.patents) || [];
    const nextNum = isNew ? Math.max(0, ...items.filter(p => p.type === "domestic").map(p => Number(p.number) || 0)) + 1 : (existing.number || "");
    const p = existing || {
      id: "p-dom-" + Date.now(),
      type: "domestic",
      number: nextNum,
      title: "", inventors: [], year: new Date().getFullYear(),
      application_no: "", registration_no: "", status_text: ""
    };
    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>구분<span class="req">*</span></label>
          <select id="pat-type">
            <option value="domestic" ${p.type==='domestic'?'selected':''}>국내 (Domestic)</option>
            <option value="international" ${p.type==='international'?'selected':''}>국제 (International)</option>
          </select>
        </div>
        <div class="admin-form-row"><label>번호 (No.)</label><input id="pat-number" type="number" value="${escapeAttr(String(p.number ?? ''))}" /></div>
        <div class="admin-form-row full"><label>제목<span class="req">*</span></label><textarea id="pat-title" style="min-height:60px">${escapeHtml(p.title || '')}</textarea></div>
        <div class="admin-form-row full"><label>발명자 (쉼표 또는 한 줄에 한 명)</label><textarea id="pat-inv" style="min-height:48px" placeholder="이동수, 최정현, 김진형">${escapeHtml(Array.isArray(p.inventors) ? p.inventors.join(", ") : (p.inventors || ''))}</textarea></div>
        <div class="admin-form-row"><label>연도</label><input id="pat-year" type="number" value="${escapeAttr(String(p.year ?? ''))}" /></div>
        <div class="admin-form-row"><label>출원번호</label><input id="pat-app" value="${escapeAttr(p.application_no || '')}" placeholder="10-2025-0163397" /></div>
        <div class="admin-form-row"><label>등록번호</label><input id="pat-reg" value="${escapeAttr(p.registration_no || '')}" placeholder="10-2839805" /></div>
        <div class="admin-form-row full"><label>기타 상태 텍스트 <span style="color:var(--c-text-light);font-size:.85em">(번호 둘 다 없을 때 표시, 예: "Publication of US...")</span></label><input id="pat-status" value="${escapeAttr(p.status_text || '')}" /></div>
      </div>
    `;
    openModal(isNew ? "특허 추가" : "특허 편집", body, () => {
      const invRaw = val("pat-inv").trim();
      const inventors = invRaw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      const updated = {
        id: p.id,
        type: val("pat-type"),
        number: Number(val("pat-number")) || 0,
        title: val("pat-title").trim(),
        inventors,
        year: Number(val("pat-year")) || 0,
        application_no: val("pat-app").trim(),
        registration_no: val("pat-reg").trim(),
        status_text: val("pat-status").trim()
      };
      if (!updated.title) return toast("제목은 필수입니다", "error");
      if (!STATE.data.patents) STATE.data.patents = [];
      if (isNew) STATE.data.patents.unshift(updated);
      else STATE.data.patents[idx] = updated;
      closeModal();
      renderPatentList();
      saveJSON("patents.json", STATE.data.patents);
    });
  }

  /* =========================================================================
   * Publications editor
   * ========================================================================= */
  function renderPubs() {
    const host = document.getElementById("tab-publications");
    const items = STATE.data.publications || [];
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>논문 <span class="count">${items.length}편</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="pub-add">+ 논문 추가</button>
          <button class="btn btn-primary" id="pub-save">💾 publications.json 저장</button>
        </div>
      </div>
      <table class="admin-table">
        <thead>
          <tr><th style="width:60px">연도</th><th>제목 · 저자 · 게재지</th><th style="width:100px">인용</th><th style="width:90px">유형</th><th style="width:160px">작업</th></tr>
        </thead>
        <tbody>
          ${items.map((p, i) => `
            <tr data-idx="${i}">
              <td>${p.year || ""}</td>
              <td>
                <div class="td-title">${escapeHtml(p.title || "")}${p.top_pick ? ' <span class="admin-badge accent">SELECTED</span>' : ''}</div>
                <div class="td-dim">${escapeHtml(p.authors || "")} · <i>${escapeHtml(p.venue || "")}</i>${p.volume ? ", " + escapeHtml(p.volume) : ""}</div>
              </td>
              <td><b>${p.citations ?? 0}</b></td>
              <td><span class="admin-badge gray">${escapeHtml(p.type || "")}</span></td>
              <td class="row-actions">
                <button class="btn btn-${p.top_pick ? "primary" : "outline"} btn-sm" data-action="toggle-selected" data-idx="${i}" title="홈 화면 노출 여부 (Selected)">${p.top_pick ? "⭐ SELECTED" : "☆ SELECTED"}</button>
                <button class="btn btn-ghost btn-sm" data-action="edit-pub" data-idx="${i}">편집</button>
                <button class="btn btn-ghost btn-sm" data-action="del-pub" data-idx="${i}" style="color:#cc0033">삭제</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    host.querySelector("#pub-add").onclick = () => editPub(-1);
    host.querySelector("#pub-save").onclick = () => saveJSON("publications.json", STATE.data.publications);
    host.querySelectorAll("[data-action=edit-pub]").forEach(b => b.onclick = () => editPub(+b.dataset.idx));
    host.querySelectorAll("[data-action=toggle-selected]").forEach(b => b.onclick = () => {
      const i = +b.dataset.idx;
      STATE.data.publications[i].top_pick = !STATE.data.publications[i].top_pick;
      renderPubs();
      // Debounced — lets user toggle several papers in a row and only
      // commits once after they stop clicking (no 409 storms)
      queueSave("publications.json", STATE.data.publications);
    });
    host.querySelectorAll("[data-action=del-pub]").forEach(b => b.onclick = () => {
      if (!confirm("이 논문을 삭제하시겠습니까?")) return;
      STATE.data.publications.splice(+b.dataset.idx, 1);
      renderPubs();
      queueSave("publications.json", STATE.data.publications);
    });
  }

  function editPub(idx) {
    const isNew = idx === -1;
    const p = isNew ? { id: "p-" + Date.now(), type: "journal", top_pick: false, year: new Date().getFullYear(), title: "", authors: "", venue: "", volume: "", citations: 0, doi: "", link: "" } : { ...STATE.data.publications[idx] };
    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>제목<span class="req">*</span></label><input id="f-title" value="${escapeAttr(p.title)}" /></div>
        <div class="admin-form-row"><label>저자<span class="req">*</span></label><input id="f-authors" value="${escapeAttr(p.authors)}" placeholder="J. Choi, P.J. Kim" /></div>
        <div class="admin-form-row"><label>게재지<span class="req">*</span></label><input id="f-venue" value="${escapeAttr(p.venue)}" placeholder="Advanced Energy Materials" /></div>
        <div class="admin-form-row"><label>권(호)</label><input id="f-volume" value="${escapeAttr(p.volume || '')}" placeholder="14(10)" /></div>
        <div class="admin-form-row"><label>연도<span class="req">*</span></label><input id="f-year" type="number" value="${p.year}" /></div>
        <div class="admin-form-row"><label>인용수</label><input id="f-citations" type="number" value="${p.citations || 0}" /></div>
        <div class="admin-form-row"><label>유형</label>
          <select id="f-type">
            <option value="journal" ${p.type==='journal'?'selected':''}>journal (저널)</option>
            <option value="conference" ${p.type==='conference'?'selected':''}>conference (학회)</option>
            <option value="book" ${p.type==='book'?'selected':''}>book (저서)</option>
            <option value="patent" ${p.type==='patent'?'selected':''}>patent (특허)</option>
          </select>
        </div>
        <div class="admin-form-row"><label>Selected</label>
          <div class="admin-checkbox"><input id="f-top" type="checkbox" ${p.top_pick ? 'checked' : ''} /> <label for="f-top">⭐ 홈 화면 Selected 캐러셀에 노출 (최신 10편 가로 스크롤)</label></div>
        </div>
        <div class="admin-form-row"><label>DOI</label><input id="f-doi" value="${escapeAttr(p.doi || '')}" placeholder="10.1002/aenm..." /></div>
        <div class="admin-form-row"><label>논문 PDF / 링크</label><div id="f-pdf-host"></div></div>
      </div>
    `;
    let pubPdfPicker;
    openModal(isNew ? "논문 추가" : "논문 편집", body, () => {
      const updated = {
        id: p.id,
        type: val("f-type"),
        top_pick: document.getElementById("f-top").checked,
        year: parseInt(val("f-year")) || new Date().getFullYear(),
        title: val("f-title"),
        authors: val("f-authors"),
        venue: val("f-venue"),
        volume: val("f-volume"),
        citations: parseInt(val("f-citations")) || 0,
        doi: val("f-doi"),
        link: pubPdfPicker.getSerialized()
      };
      if (!updated.title || !updated.authors || !updated.venue) return toast("필수 항목을 입력하세요", "error");
      if (isNew) STATE.data.publications.unshift(updated);
      else STATE.data.publications[idx] = updated;
      closeModal();
      renderPubs();
      saveJSON("publications.json", STATE.data.publications);
    });
    pubPdfPicker = mountFilePicker(
      document.getElementById("f-pdf-host"),
      typeof p.link === "object" ? p.link : (p.link || ""),
      { accept: "application/pdf,.pdf", maxSizeMB: 5, label: "논문 PDF" },
      () => {}
    );
  }

  /* =========================================================================
   * Members editor
   * ========================================================================= */
  const ROLE_LABELS = { professor: "교수", postdoc: "박사후", phd: "박사과정", ms: "석사과정", undergraduate: "학부연구원", alumni: "졸업생" };

  function renderMembers() {
    const host = document.getElementById("tab-members");
    const items = STATE.data.members || [];
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>구성원 <span class="count">${items.length}명</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="mem-add">+ 구성원 추가</button>
          <button class="btn btn-primary" id="mem-save">💾 members.json 저장</button>
        </div>
      </div>
      <table class="admin-table">
        <thead><tr><th>이름 (한/영)</th><th>구분</th><th>직함</th><th>이메일</th><th style="width:160px">작업</th></tr></thead>
        <tbody>
          ${items.map((m, i) => `
            <tr>
              <td><div class="td-title">${escapeHtml(m.name_ko || "")}</div><div class="td-dim">${escapeHtml(m.name_en || "")}</div></td>
              <td><span class="admin-badge">${ROLE_LABELS[m.role] || m.role}</span></td>
              <td class="td-dim">${escapeHtml(m.title_ko || m.title_en || "")}</td>
              <td class="td-dim">${escapeHtml(m.email || "")}</td>
              <td class="row-actions">
                <button class="btn btn-ghost btn-sm" data-action="edit-mem" data-idx="${i}">편집</button>
                <button class="btn btn-ghost btn-sm" data-action="del-mem" data-idx="${i}" style="color:#cc0033">삭제</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    host.querySelector("#mem-add").onclick = () => editMember(-1);
    host.querySelector("#mem-save").onclick = () => saveJSON("members.json", STATE.data.members);
    host.querySelectorAll("[data-action=edit-mem]").forEach(b => b.onclick = () => editMember(+b.dataset.idx));
    host.querySelectorAll("[data-action=del-mem]").forEach(b => b.onclick = () => {
      if (!confirm("이 구성원을 삭제하시겠습니까?")) return;
      STATE.data.members.splice(+b.dataset.idx, 1);
      renderMembers();
      queueSave("members.json", STATE.data.members);
    });
  }

  function editMember(idx) {
    const isNew = idx === -1;
    const m = isNew ? { id: "m-" + Date.now(), role: "ms", name_ko: "", name_en: "", title_ko: "", title_en: "", photo: "assets/images/members/placeholder.jpg", email: "", interests_ko: "", interests_en: "" } : { ...STATE.data.members[idx] };
    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>구분<span class="req">*</span></label>
          <select id="f-role">
            ${Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}" ${m.role===k?'selected':''}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="admin-form-row"><label>한글 이름<span class="req">*</span></label><input id="f-name-ko" value="${escapeAttr(m.name_ko)}" /></div>
        <div class="admin-form-row"><label>영문 이름<span class="req">*</span></label><input id="f-name-en" value="${escapeAttr(m.name_en)}" /></div>
        <div class="admin-form-row"><label>한글 직함</label><input id="f-title-ko" value="${escapeAttr(m.title_ko || '')}" placeholder="석사과정 (2026.03 – )" /></div>
        <div class="admin-form-row"><label>영문 직함</label><input id="f-title-en" value="${escapeAttr(m.title_en || '')}" placeholder="M.S. Student (2026.03 – )" /></div>
        <div class="admin-form-row"><label>이메일</label><input id="f-email" type="email" value="${escapeAttr(m.email || '')}" /></div>
        <div class="admin-form-row"><label>사진</label><div id="f-photo-host"></div></div>
        <div class="admin-form-row"><label>한글 관심분야</label><input id="f-int-ko" value="${escapeAttr(m.interests_ko || '')}" /></div>
        <div class="admin-form-row"><label>영문 관심분야</label><input id="f-int-en" value="${escapeAttr(m.interests_en || '')}" /></div>
      </div>
    `;
    let photoPicker;
    openModal(isNew ? "구성원 추가" : "구성원 편집", body, () => {
      const updated = {
        id: m.id, role: val("f-role"),
        name_ko: val("f-name-ko"), name_en: val("f-name-en"),
        title_ko: val("f-title-ko"), title_en: val("f-title-en"),
        email: val("f-email"),
        photo: photoPicker.getValue() || "",
        photo_pos: photoPicker.getPos() || "",
        interests_ko: val("f-int-ko"), interests_en: val("f-int-en")
      };
      // Don't write photo_pos at all when empty (cleaner JSON)
      if (!updated.photo_pos) delete updated.photo_pos;
      if (!updated.name_ko || !updated.name_en) return toast("한글/영문 이름은 필수입니다", "error");
      if (isNew) STATE.data.members.push(updated);
      else STATE.data.members[idx] = { ...STATE.data.members[idx], ...updated };
      closeModal();
      renderMembers();
      saveJSON("members.json", STATE.data.members);
    });
    photoPicker = mountImagePicker(
      document.getElementById("f-photo-host"),
      m.photo && !m.photo.includes("placeholder") ? m.photo : "",
      { maxW: 400, maxH: 400, enableFocus: true, initialPos: m.photo_pos || "", previewAspect: "1 / 1" },
      () => {}
    );
  }

  /* =========================================================================
   * PI profile editor
   * ========================================================================= */
  function renderPI() {
    const host = document.getElementById("tab-pi");
    const p = STATE.data.pi || {};
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>PI 프로필</h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="pi-add-edu">+ 학력</button>
          <button class="btn btn-outline" id="pi-add-exp">+ 경력</button>
          <button class="btn btn-outline" id="pi-add-award">+ 수상</button>
          <button class="btn btn-outline" id="pi-add-grant">+ 연구 과제</button>
          <button class="btn btn-primary" id="pi-save">💾 pi.json 저장</button>
        </div>
      </div>

      <div class="admin-card">
        <h3>기본 정보</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>사진</label><div id="pi-photo-host"></div></div>
          <div class="admin-form-row"><label>한글 이름</label><input id="pi-name-ko" value="${escapeAttr(p.name_ko || '')}" /></div>
          <div class="admin-form-row"><label>영문 이름</label><input id="pi-name-en" value="${escapeAttr(p.name_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 직함</label><input id="pi-title-ko" value="${escapeAttr(p.title_ko || '')}" /></div>
          <div class="admin-form-row"><label>영문 직함</label><input id="pi-title-en" value="${escapeAttr(p.title_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 소속</label><input id="pi-aff-ko" value="${escapeAttr(p.affiliation_ko || '')}" /></div>
          <div class="admin-form-row"><label>영문 소속</label><input id="pi-aff-en" value="${escapeAttr(p.affiliation_en || '')}" /></div>
          <div class="admin-form-row"><label>이메일</label><input id="pi-email" type="email" value="${escapeAttr(p.email || '')}" /></div>
          <div class="admin-form-row"><label>CV 파일</label><div id="pi-cv-host"></div></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>Bio (소개글)</h3>
        <div class="admin-form">
          <div class="admin-form-row full"><label>한글 Bio</label><textarea id="pi-bio-ko" style="min-height:140px">${escapeHtml(p.bio_ko || '')}</textarea></div>
          <div class="admin-form-row full"><label>영문 Bio</label><textarea id="pi-bio-en" style="min-height:140px">${escapeHtml(p.bio_en || '')}</textarea></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>관심 연구 분야</h3>
        <div class="admin-form">
          <div class="admin-form-row full"><label>한글 (한 줄에 한 개)</label><textarea id="pi-int-ko">${escapeHtml((p.interests_ko || []).join('\n'))}</textarea></div>
          <div class="admin-form-row full"><label>영문 (한 줄에 한 개)</label><textarea id="pi-int-en">${escapeHtml((p.interests_en || []).join('\n'))}</textarea></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>학력 <span style="font-weight:400;color:var(--color-text-light);font-size:.9em">${(p.education || []).length}개</span></h3>
        <div id="pi-edu-list">${renderEduList(p.education || [])}</div>
      </div>

      <div class="admin-card">
        <h3>경력 <span style="font-weight:400;color:var(--color-text-light);font-size:.9em">${(p.experience || []).length}개</span></h3>
        <div id="pi-exp-list">${renderExpList(p.experience || [])}</div>
      </div>

      <div class="admin-card">
        <h3>수상 <span style="font-weight:400;color:var(--color-text-light);font-size:.9em">${(p.awards || []).length}개</span></h3>
        <div id="pi-award-list">${renderAwardList(p.awards || [])}</div>
      </div>

      <div class="admin-card">
        <h3>수행 연구 과제 <span style="font-weight:400;color:var(--color-text-light);font-size:.9em">${(p.grants || []).length}건</span></h3>
        <div id="pi-grant-list">${renderGrantList(p.grants || [])}</div>
      </div>

      <div class="admin-card">
        <h3>외부 링크</h3>
        <div id="pi-links-list">${renderLinksList(p.links || [])}</div>
        <button class="btn btn-outline btn-sm" style="margin-top:var(--space-3)" id="pi-add-link">+ 링크 추가</button>
      </div>
    `;

    const photoPicker = mountImagePicker(
      document.getElementById("pi-photo-host"),
      p.photo || "",
      { maxW: 600, maxH: 800, enableFocus: true, initialPos: p.photo_pos || "", previewAspect: "4 / 5" },
      () => {}
    );

    const cvPicker = mountFilePicker(
      document.getElementById("pi-cv-host"),
      typeof p.cv === "object" ? p.cv : (p.cv_link || p.cv || ""),
      { accept: "application/pdf,.pdf", maxSizeMB: 5, label: "CV PDF" },
      () => {}
    );

    bindPIEditors();

    host.querySelector("#pi-save").onclick = () => {
      const updated = {
        ...p,
        name_ko: val("pi-name-ko"), name_en: val("pi-name-en"),
        title_ko: val("pi-title-ko"), title_en: val("pi-title-en"),
        affiliation_ko: val("pi-aff-ko"), affiliation_en: val("pi-aff-en"),
        email: val("pi-email"), cv: cvPicker.getSerialized(),
        bio_ko: val("pi-bio-ko"), bio_en: val("pi-bio-en"),
        interests_ko: val("pi-int-ko").split("\n").map(s => s.trim()).filter(Boolean),
        interests_en: val("pi-int-en").split("\n").map(s => s.trim()).filter(Boolean),
        photo: photoPicker.getValue() || p.photo || "",
        photo_pos: photoPicker.getPos() || "",
        education: collectEduList(),
        experience: collectExpList(),
        awards: collectAwardList(),
        grants: collectGrantList(),
        links: collectLinksList()
      };
      STATE.data.pi = updated;
      saveJSON("pi.json", updated);
    };

    host.querySelector("#pi-add-edu").onclick = () => {
      const list = collectEduList();
      list.push({ period: "", degree_ko: "", degree_en: "", field_ko: "", field_en: "", institution_ko: "", institution_en: "" });
      document.getElementById("pi-edu-list").innerHTML = renderEduList(list);
      bindPIEditors();
    };
    host.querySelector("#pi-add-exp").onclick = () => {
      const list = collectExpList();
      list.push({ period_ko: "", period_en: "", role_ko: "", role_en: "", org_ko: "", org_en: "" });
      document.getElementById("pi-exp-list").innerHTML = renderExpList(list);
      bindPIEditors();
    };
    host.querySelector("#pi-add-award").onclick = () => {
      const list = collectAwardList();
      list.push({ year: new Date().getFullYear(), title_ko: "", title_en: "", org_ko: "", org_en: "" });
      document.getElementById("pi-award-list").innerHTML = renderAwardList(list);
      bindPIEditors();
    };
    host.querySelector("#pi-add-grant").onclick = () => {
      const list = collectGrantList();
      list.push({ period_ko: "", period_en: "", title_ko: "", title_en: "", role_ko: "", role_en: "", agency_ko: "", agency_en: "" });
      document.getElementById("pi-grant-list").innerHTML = renderGrantList(list);
      bindPIEditors();
    };
    host.querySelector("#pi-add-link").onclick = () => {
      const list = collectLinksList();
      list.push({ label: "", url: "" });
      document.getElementById("pi-links-list").innerHTML = renderLinksList(list);
      bindPIEditors();
    };
  }

  function renderEduList(items) {
    return items.map((e, i) => `
      <div class="admin-list-row" data-i="${i}">
        <input placeholder="기간 (2010 – 2016)" data-k="period" value="${escapeAttr(e.period || '')}" />
        <input placeholder="학위 한글 (박사)" data-k="degree_ko" value="${escapeAttr(e.degree_ko || '')}" />
        <input placeholder="Degree EN (Ph.D.)" data-k="degree_en" value="${escapeAttr(e.degree_en || '')}" />
        <input placeholder="분야 한글" data-k="field_ko" value="${escapeAttr(e.field_ko || '')}" />
        <input placeholder="Field EN" data-k="field_en" value="${escapeAttr(e.field_en || '')}" />
        <input placeholder="학교 한글" data-k="institution_ko" value="${escapeAttr(e.institution_ko || '')}" />
        <input placeholder="Institution EN" data-k="institution_en" value="${escapeAttr(e.institution_en || '')}" />
        <button type="button" class="btn btn-ghost btn-sm" data-del="edu" style="color:#cc0033">✕</button>
      </div>
    `).join("");
  }
  function renderExpList(items) {
    return items.map((e, i) => `
      <div class="admin-list-row" data-i="${i}">
        <input placeholder="기간 한글 (2024 – 현재)" data-k="period_ko" value="${escapeAttr(e.period_ko || '')}" />
        <input placeholder="Period EN" data-k="period_en" value="${escapeAttr(e.period_en || '')}" />
        <input placeholder="직함 한글" data-k="role_ko" value="${escapeAttr(e.role_ko || '')}" />
        <input placeholder="Role EN" data-k="role_en" value="${escapeAttr(e.role_en || '')}" />
        <input placeholder="기관 한글" data-k="org_ko" value="${escapeAttr(e.org_ko || '')}" />
        <input placeholder="Org EN" data-k="org_en" value="${escapeAttr(e.org_en || '')}" />
        <button type="button" class="btn btn-ghost btn-sm" data-del="exp" style="color:#cc0033">✕</button>
      </div>
    `).join("");
  }
  function renderAwardList(items) {
    return items.map((e, i) => `
      <div class="admin-list-row" data-i="${i}">
        <input placeholder="연도" type="number" data-k="year" value="${e.year || new Date().getFullYear()}" style="max-width:90px" />
        <input placeholder="수상명 한글" data-k="title_ko" value="${escapeAttr(e.title_ko || '')}" />
        <input placeholder="Title EN" data-k="title_en" value="${escapeAttr(e.title_en || '')}" />
        <input placeholder="수여기관 한글" data-k="org_ko" value="${escapeAttr(e.org_ko || '')}" />
        <input placeholder="Issuing Org EN" data-k="org_en" value="${escapeAttr(e.org_en || '')}" />
        <button type="button" class="btn btn-ghost btn-sm" data-del="award" style="color:#cc0033">✕</button>
      </div>
    `).join("");
  }
  function renderGrantList(items) {
    return items.map((e, i) => `
      <div class="admin-list-row" data-i="${i}">
        <input placeholder="기간 한글 (2025 – 2028)" data-k="period_ko" value="${escapeAttr(e.period_ko || '')}" />
        <input placeholder="Period EN" data-k="period_en" value="${escapeAttr(e.period_en || '')}" />
        <input placeholder="과제명 한글" data-k="title_ko" value="${escapeAttr(e.title_ko || '')}" />
        <input placeholder="Title EN" data-k="title_en" value="${escapeAttr(e.title_en || '')}" />
        <input placeholder="역할 한글 (연구책임자)" data-k="role_ko" value="${escapeAttr(e.role_ko || '')}" />
        <input placeholder="Role EN (PI)" data-k="role_en" value="${escapeAttr(e.role_en || '')}" />
        <input placeholder="발주처 한글" data-k="agency_ko" value="${escapeAttr(e.agency_ko || '')}" />
        <input placeholder="Agency EN" data-k="agency_en" value="${escapeAttr(e.agency_en || '')}" />
        <button type="button" class="btn btn-ghost btn-sm" data-del="grant" style="color:#cc0033">✕</button>
      </div>
    `).join("");
  }
  function renderLinksList(items) {
    return items.map((e, i) => `
      <div class="admin-list-row" data-i="${i}">
        <input placeholder="레이블 (Google Scholar)" data-k="label" value="${escapeAttr(e.label || '')}" style="max-width:200px" />
        <input placeholder="URL" data-k="url" value="${escapeAttr(e.url || '')}" />
        <button type="button" class="btn btn-ghost btn-sm" data-del="link" style="color:#cc0033">✕</button>
      </div>
    `).join("");
  }

  function collectListRows(hostId) {
    const rows = document.querySelectorAll(`#${hostId} .admin-list-row`);
    return Array.from(rows).map(row => {
      const o = {};
      row.querySelectorAll("input").forEach(input => {
        const k = input.dataset.k;
        if (k) o[k] = input.type === "number" ? (parseInt(input.value) || 0) : input.value;
      });
      return o;
    });
  }
  const collectEduList = () => collectListRows("pi-edu-list");
  const collectExpList = () => collectListRows("pi-exp-list");
  const collectAwardList = () => collectListRows("pi-award-list");
  const collectGrantList = () => collectListRows("pi-grant-list");
  const collectLinksList = () => collectListRows("pi-links-list");

  function bindPIEditors() {
    document.querySelectorAll("[data-del]").forEach(btn => {
      btn.onclick = () => {
        const row = btn.closest(".admin-list-row");
        const parent = row.parentElement.id;
        row.remove();
      };
    });
  }

  /* =========================================================================
   * News editor
   * ========================================================================= */
  const NEWS_CAT_LABELS = { news: "뉴스", notice: "공지", seminar: "세미나" };

  function renderNews() {
    const host = document.getElementById("tab-news");
    const items = (STATE.data.news || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>소식 <span class="count">${items.length}건</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="news-add">+ 소식 추가</button>
          <button class="btn btn-primary" id="news-save">💾 news.json 저장</button>
        </div>
      </div>
      <table class="admin-table">
        <thead><tr><th style="width:110px">날짜</th><th style="width:80px">분류</th><th>제목</th><th style="width:160px">작업</th></tr></thead>
        <tbody>
          ${items.map(n => {
            const realIdx = STATE.data.news.findIndex(x => x.id === n.id);
            return `
            <tr>
              <td class="td-dim" style="font-family:var(--font-mono)">${n.date}</td>
              <td><span class="admin-badge">${NEWS_CAT_LABELS[n.category] || n.category}</span></td>
              <td><div class="td-title">${escapeHtml(n.title_ko || "")}</div><div class="td-dim">${escapeHtml(n.title_en || "")}</div></td>
              <td class="row-actions">
                <button class="btn btn-ghost btn-sm" data-action="edit-news" data-idx="${realIdx}">편집</button>
                <button class="btn btn-ghost btn-sm" data-action="del-news" data-idx="${realIdx}" style="color:#cc0033">삭제</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
    host.querySelector("#news-add").onclick = () => editNews(-1);
    host.querySelector("#news-save").onclick = () => saveJSON("news.json", STATE.data.news);
    host.querySelectorAll("[data-action=edit-news]").forEach(b => b.onclick = () => editNews(+b.dataset.idx));
    host.querySelectorAll("[data-action=del-news]").forEach(b => b.onclick = () => {
      if (!confirm("이 소식을 삭제하시겠습니까?")) return;
      STATE.data.news.splice(+b.dataset.idx, 1);
      renderNews();
      queueSave("news.json", STATE.data.news);
    });
  }

  function editNews(idx) {
    const isNew = idx === -1;
    const today = new Date().toISOString().slice(0, 10);
    const n = isNew ? { id: "n-" + Date.now(), date: today, category: "news", title_ko: "", title_en: "", body_ko: "", body_en: "" } : { ...STATE.data.news[idx] };
    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>날짜<span class="req">*</span></label><input id="f-date" type="date" value="${n.date}" /></div>
        <div class="admin-form-row"><label>분류<span class="req">*</span></label>
          <select id="f-cat">
            ${Object.entries(NEWS_CAT_LABELS).map(([k, v]) => `<option value="${k}" ${n.category===k?'selected':''}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="admin-form-row"><label>한글 제목<span class="req">*</span></label><input id="f-t-ko" value="${escapeAttr(n.title_ko)}" /></div>
        <div class="admin-form-row"><label>영문 제목</label><input id="f-t-en" value="${escapeAttr(n.title_en)}" /></div>
        <div class="admin-form-row full"><label>한글 본문</label><textarea id="f-b-ko">${escapeHtml(n.body_ko || "")}</textarea></div>
        <div class="admin-form-row full"><label>영문 본문</label><textarea id="f-b-en">${escapeHtml(n.body_en || "")}</textarea></div>
      </div>
    `;
    openModal(isNew ? "소식 추가" : "소식 편집", body, () => {
      const updated = {
        id: n.id, date: val("f-date"), category: val("f-cat"),
        title_ko: val("f-t-ko"), title_en: val("f-t-en"),
        body_ko: val("f-b-ko"), body_en: val("f-b-en")
      };
      if (!updated.date || !updated.title_ko) return toast("날짜와 한글 제목은 필수입니다", "error");
      if (isNew) STATE.data.news.unshift(updated);
      else STATE.data.news[idx] = updated;
      closeModal();
      renderNews();
      saveJSON("news.json", STATE.data.news);
    });
  }

  /* =========================================================================
   * Gallery editor
   * Each entry: { id, date, title_ko, title_en, summary_ko, summary_en,
   *               body_ko, body_en, cover, images:[{src, caption_ko, caption_en}] }
   * ========================================================================= */
  function renderGallery() {
    const host = document.getElementById("tab-gallery");
    const items = (STATE.data.gallery || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>갤러리 <span class="count">${items.length}개</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="gal-add">+ 항목 추가</button>
          <button class="btn btn-primary" id="gal-save">💾 gallery.json 저장</button>
        </div>
      </div>
      <div class="admin-card" style="color:var(--color-text-muted);font-size:var(--fs-sm)">
        💡 표지 사진 + 추가 사진 여러 장 업로드 가능. 공개 사이트에서 3열 그리드로 표시되고 클릭 시 상세 페이지가 열립니다.
      </div>
      <table class="admin-table">
        <thead><tr><th style="width:90px">표지</th><th style="width:110px">날짜</th><th>제목</th><th style="width:80px">사진수</th><th style="width:160px">작업</th></tr></thead>
        <tbody>
          ${items.map(g => {
            const realIdx = STATE.data.gallery.findIndex(x => x.id === g.id);
            const cover = g.cover || (g.images && g.images[0] && g.images[0].src) || "";
            const nImg = (g.images || []).length;
            return `
              <tr>
                <td>${cover ? `<img src="${escapeAttr(cover)}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--color-border)" />` : `<div style="width:64px;height:48px;background:var(--color-surface);border-radius:4px;border:1px dashed var(--color-border)"></div>`}</td>
                <td class="td-dim" style="font-family:var(--font-mono)">${g.date || ""}</td>
                <td><div class="td-title">${escapeHtml(g.title_ko || "")}</div><div class="td-dim">${escapeHtml(g.title_en || "")}</div></td>
                <td class="td-dim">${nImg}장</td>
                <td class="row-actions">
                  <button class="btn btn-ghost btn-sm" data-action="edit-gal" data-idx="${realIdx}">편집</button>
                  <button class="btn btn-ghost btn-sm" data-action="del-gal" data-idx="${realIdx}" style="color:#cc0033">삭제</button>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
    host.querySelector("#gal-add").onclick = () => editGallery(-1);
    host.querySelector("#gal-save").onclick = () => saveJSON("gallery.json", STATE.data.gallery);
    host.querySelectorAll("[data-action=edit-gal]").forEach(b => b.onclick = () => editGallery(+b.dataset.idx));
    host.querySelectorAll("[data-action=del-gal]").forEach(b => b.onclick = () => {
      if (!confirm("이 갤러리 항목을 삭제하시겠습니까?")) return;
      STATE.data.gallery.splice(+b.dataset.idx, 1);
      renderGallery();
      queueSave("gallery.json", STATE.data.gallery);
    });
  }

  function editGallery(idx) {
    const isNew = idx === -1;
    const today = new Date().toISOString().slice(0, 10);
    const g = isNew
      ? { id: "g-" + Date.now(), date: today, title_ko: "", title_en: "", summary_ko: "", summary_en: "", body_ko: "", body_en: "", cover: "", images: [] }
      : JSON.parse(JSON.stringify(STATE.data.gallery[idx]));
    if (!Array.isArray(g.images)) g.images = [];

    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>날짜<span class="req">*</span></label><input id="g-date" type="date" value="${g.date || today}" /></div>
        <div class="admin-form-row"><label>한글 제목<span class="req">*</span></label><input id="g-t-ko" value="${escapeAttr(g.title_ko || "")}" /></div>
        <div class="admin-form-row"><label>영문 제목</label><input id="g-t-en" value="${escapeAttr(g.title_en || "")}" /></div>
        <div class="admin-form-row full"><label>한글 요약 (카드에 표시)</label><textarea id="g-s-ko" rows="2">${escapeHtml(g.summary_ko || "")}</textarea></div>
        <div class="admin-form-row full"><label>영문 요약</label><textarea id="g-s-en" rows="2">${escapeHtml(g.summary_en || "")}</textarea></div>
        <div class="admin-form-row full"><label>한글 본문 (상세 페이지)</label><textarea id="g-b-ko" rows="4">${escapeHtml(g.body_ko || "")}</textarea></div>
        <div class="admin-form-row full"><label>영문 본문</label><textarea id="g-b-en" rows="4">${escapeHtml(g.body_en || "")}</textarea></div>
        <div class="admin-form-row full">
          <label>사진 업로드 <span class="td-dim" style="font-weight:400">(여러 장 선택 가능 · ⭐ 버튼으로 배너 지정)</span></label>
          <div class="admin-card" style="padding:var(--space-3);background:var(--color-surface);border:1px dashed var(--color-border);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;justify-content:space-between">
            <div style="font-size:var(--fs-sm);color:var(--color-text-muted)">
              📁 <b>여러 사진을 한번에</b> 선택할 수 있습니다 (Ctrl/Cmd+클릭)<br/>
              ⭐ 버튼을 눌러 <b>홈 배너·리스트 표지</b>로 쓸 사진을 지정하세요.
            </div>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">
              📁 사진 여러 장 선택
              <input type="file" id="g-multi-upload" accept="image/jpeg,image/png,image/webp" multiple style="display:none" />
            </label>
          </div>
          <div id="g-upload-progress" style="margin-top:var(--space-2);font-size:var(--fs-sm);color:var(--color-text-muted)"></div>
          <div id="g-images-list" style="margin-top:var(--space-3)"></div>
        </div>
      </div>
    `;
    openModal(isNew ? "갤러리 항목 추가" : "갤러리 편집", body, () => {
      // Auto-pick first image as banner if none chosen but images exist
      if (!g.cover && g.images.length > 0 && g.images[0].src) {
        g.cover = g.images[0].src;
      }
      const updated = {
        id: g.id,
        date: val("g-date"),
        title_ko: val("g-t-ko"),
        title_en: val("g-t-en"),
        summary_ko: val("g-s-ko"),
        summary_en: val("g-s-en"),
        body_ko: val("g-b-ko"),
        body_en: val("g-b-en"),
        cover: g.cover || "",
        images: g.images || []
      };
      if (!updated.date || !updated.title_ko) return toast("날짜와 한글 제목은 필수입니다", "error");
      if (isNew) STATE.data.gallery.unshift(updated);
      else STATE.data.gallery[idx] = updated;
      closeModal();
      renderGallery();
      saveJSON("gallery.json", STATE.data.gallery);
    });

    const listHost = document.getElementById("g-images-list");
    const progressHost = document.getElementById("g-upload-progress");

    function renderImages() {
      if (g.images.length === 0) {
        listHost.innerHTML = `<div class="td-dim" style="font-size:var(--fs-sm);text-align:center;padding:var(--space-6);border:1px dashed var(--color-border);border-radius:6px">추가된 사진이 없습니다. 위의 버튼으로 사진을 선택하세요.</div>`;
        return;
      }
      listHost.innerHTML = `<div class="gallery-edit-grid">${
        g.images.map((im, i) => {
          const isBanner = !!(im.src && g.cover && im.src === g.cover);
          return `
            <div class="gallery-edit-item ${isBanner ? "is-banner" : ""}" data-i="${i}">
              <div class="gallery-edit-thumb">
                ${im.src ? `<img src="${escapeAttr(im.src)}" alt="" />` : `<div class="gallery-edit-thumb-ph">이미지 없음</div>`}
                ${isBanner ? `<div class="gallery-edit-banner-badge">⭐ 배너</div>` : ""}
              </div>
              <div class="gallery-edit-body">
                <div class="gallery-edit-row">
                  <strong style="font-size:var(--fs-sm)">사진 ${i + 1}</strong>
                  <div class="gallery-edit-actions">
                    <button type="button" class="btn btn-${isBanner ? "primary" : "outline"} btn-sm" data-banner="${i}" title="이 사진을 리스트 표지·홈 배너로 지정">${isBanner ? "⭐ 배너 선택됨" : "⭐ 배너로 지정"}</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-up="${i}" ${i === 0 ? "disabled" : ""} title="위로">↑</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-dn="${i}" ${i === g.images.length - 1 ? "disabled" : ""} title="아래로">↓</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-del="${i}" style="color:#cc0033" title="삭제">✕</button>
                  </div>
                </div>
                <input data-cap-ko="${i}" placeholder="한글 캡션" value="${escapeAttr(im.caption_ko || "")}" />
                <input data-cap-en="${i}" placeholder="English caption" value="${escapeAttr(im.caption_en || "")}" />
              </div>
            </div>`;
        }).join("")
      }</div>`;

      listHost.querySelectorAll("[data-cap-ko]").forEach(el => el.oninput = () => { g.images[+el.dataset.capKo].caption_ko = el.value; });
      listHost.querySelectorAll("[data-cap-en]").forEach(el => el.oninput = () => { g.images[+el.dataset.capEn].caption_en = el.value; });
      listHost.querySelectorAll("[data-banner]").forEach(b => b.onclick = () => {
        const i = +b.dataset.banner;
        g.cover = g.images[i] && g.images[i].src ? g.images[i].src : "";
        renderImages();
        toast("배너 사진으로 지정되었습니다", "ok");
      });
      listHost.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
        const i = +b.dataset.del;
        const removed = g.images.splice(i, 1)[0];
        if (removed && removed.src && removed.src === g.cover) g.cover = "";
        renderImages();
      });
      listHost.querySelectorAll("[data-up]").forEach(b => b.onclick = () => {
        const i = +b.dataset.up; if (i <= 0) return;
        [g.images[i - 1], g.images[i]] = [g.images[i], g.images[i - 1]];
        renderImages();
      });
      listHost.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => {
        const i = +b.dataset.dn; if (i >= g.images.length - 1) return;
        [g.images[i + 1], g.images[i]] = [g.images[i], g.images[i + 1]];
        renderImages();
      });
    }

    renderImages();

    document.getElementById("g-multi-upload").onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      let done = 0, failed = 0;
      const total = files.length;
      progressHost.textContent = `업로드 중... 0 / ${total}`;
      for (const file of files) {
        try {
          const dataUrl = await resizeImageFile(file, 1600, 1600, 0.85);
          g.images.push({ src: dataUrl, caption_ko: "", caption_en: "" });
          if (!g.cover) g.cover = dataUrl;
          done++;
        } catch (err) {
          failed++;
          console.error("image upload failed:", err);
        }
        progressHost.textContent = `업로드 중... ${done + failed} / ${total}${failed ? ` (실패 ${failed})` : ""}`;
        renderImages();
      }
      progressHost.textContent = `✅ ${done}장 업로드 완료${failed ? ` · ${failed}장 실패` : ""}`;
      e.target.value = "";
      setTimeout(() => { progressHost.textContent = ""; }, 4000);
    };
  }

  /* =========================================================================
   * Journal Cover Gallery editor
   * ========================================================================= */
  function renderCovers() {
    const host = document.getElementById("tab-covers");
    if (!Array.isArray(STATE.data.covers)) STATE.data.covers = [];
    const list = STATE.data.covers
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>저널 커버 갤러리 <span class="count">${list.length}개</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="cov-add">+ 커버 추가</button>
          <button class="btn btn-primary" id="cov-save">💾 journal_covers.json 저장</button>
        </div>
      </div>
      <div class="admin-card" style="color:var(--color-text-muted);font-size:var(--fs-sm)">
        💡 Publications 페이지 상단 배너에 가로 스크롤 갤러리로 표시됩니다. 클릭 시 큰 이미지 + 설명이 모달로 열립니다.
        ↑↓ 버튼으로 표시 순서를 조정하세요. 첫 번째 항목이 가장 왼쪽에 표시됩니다.
      </div>
      ${list.length === 0
        ? `<div class="admin-card" style="text-align:center;padding:var(--space-8);color:var(--color-text-muted)">아직 등록된 커버가 없습니다. <b>+ 커버 추가</b> 버튼으로 시작하세요.</div>`
        : `<table class="admin-table">
            <thead><tr><th style="width:80px">순서</th><th style="width:90px">커버</th><th>저널 / 제목</th><th style="width:80px">연도</th><th style="width:220px">작업</th></tr></thead>
            <tbody>
              ${list.map((c, displayIdx) => {
                const realIdx = STATE.data.covers.findIndex(x => x.id === c.id);
                return `
                  <tr>
                    <td class="td-dim" style="font-family:var(--font-mono)">${displayIdx + 1}</td>
                    <td>${c.image
                      ? `<img src="${escapeAttr(c.image)}" alt="" style="width:60px;height:80px;object-fit:cover;border-radius:4px;border:1px solid var(--color-border)" />`
                      : `<div style="width:60px;height:80px;background:var(--color-surface);border-radius:4px;border:1px dashed var(--color-border)"></div>`}</td>
                    <td>
                      <div class="td-title" style="color:var(--c-accent);font-weight:600">${escapeHtml(c.journal || "(저널명 없음)")}</div>
                      <div class="td-dim" style="font-size:var(--fs-sm);margin-top:2px">${escapeHtml(c.title_en || c.title_ko || "")}</div>
                    </td>
                    <td class="td-dim">${c.year ? escapeHtml(String(c.year)) : "—"}</td>
                    <td class="row-actions">
                      <button class="btn btn-ghost btn-sm" data-action="cov-up" data-idx="${realIdx}" ${displayIdx === 0 ? "disabled" : ""} title="위로">↑</button>
                      <button class="btn btn-ghost btn-sm" data-action="cov-dn" data-idx="${realIdx}" ${displayIdx === list.length - 1 ? "disabled" : ""} title="아래로">↓</button>
                      <button class="btn btn-ghost btn-sm" data-action="cov-edit" data-idx="${realIdx}">편집</button>
                      <button class="btn btn-ghost btn-sm" data-action="cov-del" data-idx="${realIdx}" style="color:#cc0033">삭제</button>
                    </td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>`}
    `;
    host.querySelector("#cov-add").onclick = () => editCover(-1);
    host.querySelector("#cov-save").onclick = () => saveJSON("journal_covers.json", STATE.data.covers);
    host.querySelectorAll("[data-action=cov-edit]").forEach(b => b.onclick = () => editCover(+b.dataset.idx));
    host.querySelectorAll("[data-action=cov-del]").forEach(b => b.onclick = () => {
      if (!confirm("이 커버를 삭제하시겠습니까?")) return;
      STATE.data.covers.splice(+b.dataset.idx, 1);
      reorderCovers();
      renderCovers();
      queueSave("journal_covers.json", STATE.data.covers);
    });
    host.querySelectorAll("[data-action=cov-up]").forEach(b => b.onclick = () => moveCover(+b.dataset.idx, -1));
    host.querySelectorAll("[data-action=cov-dn]").forEach(b => b.onclick = () => moveCover(+b.dataset.idx, +1));
  }

  function moveCover(idx, dir) {
    const sorted = STATE.data.covers
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const target = STATE.data.covers[idx];
    const pos = sorted.findIndex(c => c.id === target.id);
    const newPos = pos + dir;
    if (newPos < 0 || newPos >= sorted.length) return;
    [sorted[pos], sorted[newPos]] = [sorted[newPos], sorted[pos]];
    sorted.forEach((c, i) => { c.order = i + 1; });
    renderCovers();
    queueSave("journal_covers.json", STATE.data.covers);
  }

  function reorderCovers() {
    const sorted = STATE.data.covers
      .slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    sorted.forEach((c, i) => { c.order = i + 1; });
  }

  function editCover(idx) {
    const isNew = idx === -1;
    const nextOrder = (STATE.data.covers || []).reduce((m, c) => Math.max(m, Number(c.order) || 0), 0) + 1;
    const c = isNew
      ? { id: "cov-" + Date.now(), image: "", journal: "", year: "", title_ko: "", title_en: "", description_ko: "", description_en: "", doi: "", link: "", order: nextOrder }
      : JSON.parse(JSON.stringify(STATE.data.covers[idx]));

    const body = `
      <div class="admin-form">
        <div class="admin-form-row full">
          <label>커버 이미지<span class="req">*</span></label>
          <div class="admin-card" style="padding:var(--space-3);background:var(--color-surface);border:1px dashed var(--color-border);display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;justify-content:space-between">
            <div style="font-size:var(--fs-sm);color:var(--color-text-muted)">
              📁 JPG/PNG/WEBP 권장 · 자동으로 1600px로 리사이징됩니다.<br/>
              📐 권장 비율 <b>3:4 (세로형)</b> — 일반적인 저널 커버 비율
            </div>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">
              📁 이미지 선택
              <input type="file" id="c-img-upload" accept="image/jpeg,image/png,image/webp" style="display:none" />
            </label>
          </div>
          <div id="c-img-progress" style="margin-top:var(--space-2);font-size:var(--fs-sm);color:var(--color-text-muted)"></div>
          <div id="c-img-preview" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="admin-form-row"><label>저널명<span class="req">*</span></label><input id="c-journal" value="${escapeAttr(c.journal || "")}" placeholder="예: Advanced Energy Materials" /></div>
        <div class="admin-form-row"><label>연도</label><input id="c-year" type="number" min="1900" max="2099" value="${escapeAttr(c.year || "")}" placeholder="2026" /></div>
        <div class="admin-form-row full"><label>한글 제목</label><input id="c-title-ko" value="${escapeAttr(c.title_ko || "")}" placeholder="논문 한글 제목 (선택)" /></div>
        <div class="admin-form-row full"><label>영문 제목</label><input id="c-title-en" value="${escapeAttr(c.title_en || "")}" placeholder="Paper title in English" /></div>
        <div class="admin-form-row full"><label>한글 설명</label><textarea id="c-desc-ko" rows="3" placeholder="커버에 대한 간단한 한글 설명 (모달에 표시)">${escapeHtml(c.description_ko || "")}</textarea></div>
        <div class="admin-form-row full"><label>영문 설명</label><textarea id="c-desc-en" rows="3" placeholder="Brief English description">${escapeHtml(c.description_en || "")}</textarea></div>
        <div class="admin-form-row"><label>DOI</label><input id="c-doi" value="${escapeAttr(c.doi || "")}" placeholder="10.1002/aenm.xxxx (선택)" /></div>
        <div class="admin-form-row"><label>링크 URL</label><input id="c-link" value="${escapeAttr(c.link || "")}" placeholder="https://... (DOI 대신 사용)" /></div>
      </div>
    `;
    openModal(isNew ? "저널 커버 추가" : "저널 커버 편집", body, () => {
      const journal = val("c-journal").trim();
      if (!c.image) return toast("커버 이미지는 필수입니다", "error");
      if (!journal) return toast("저널명은 필수입니다", "error");
      const updated = {
        id: c.id,
        image: c.image,
        journal,
        year: val("c-year").trim() ? parseInt(val("c-year"), 10) : "",
        title_ko: val("c-title-ko").trim(),
        title_en: val("c-title-en").trim(),
        description_ko: val("c-desc-ko"),
        description_en: val("c-desc-en"),
        doi: val("c-doi").trim(),
        link: val("c-link").trim(),
        order: c.order || nextOrder
      };
      if (isNew) STATE.data.covers.push(updated);
      else STATE.data.covers[idx] = updated;
      reorderCovers();
      closeModal();
      renderCovers();
      saveJSON("journal_covers.json", STATE.data.covers);
    });

    const previewHost = document.getElementById("c-img-preview");
    const progressHost = document.getElementById("c-img-progress");

    function renderPreview() {
      if (!c.image) {
        previewHost.innerHTML = `<div class="td-dim" style="font-size:var(--fs-sm);text-align:center;padding:var(--space-6);border:1px dashed var(--color-border);border-radius:6px">아직 이미지가 없습니다.</div>`;
        return;
      }
      previewHost.innerHTML = `
        <div style="display:flex;gap:var(--space-3);align-items:flex-start">
          <img src="${escapeAttr(c.image)}" alt="" style="width:160px;height:auto;aspect-ratio:3/4;object-fit:cover;border-radius:6px;border:1px solid var(--color-border);box-shadow:0 4px 12px rgba(0,0,0,0.08)" />
          <button type="button" class="btn btn-ghost btn-sm" id="c-img-clear" style="color:#cc0033">✕ 이미지 삭제</button>
        </div>`;
      const clearBtn = document.getElementById("c-img-clear");
      if (clearBtn) clearBtn.onclick = () => { c.image = ""; renderPreview(); };
    }
    renderPreview();

    document.getElementById("c-img-upload").onchange = async (e) => {
      const file = (e.target.files || [])[0];
      if (!file) return;
      progressHost.textContent = "업로드 중...";
      try {
        c.image = await resizeImageFile(file, 1600, 1600, 0.85);
        progressHost.textContent = "✅ 업로드 완료";
        setTimeout(() => { progressHost.textContent = ""; }, 2000);
        renderPreview();
      } catch (err) {
        progressHost.textContent = "✗ 업로드 실패";
        console.error(err);
      }
      e.target.value = "";
    };
  }

  /* =========================================================================
   * Research topics editor (simpler, no SVG editing for safety)
   * ========================================================================= */
  function renderTopics() {
    const host = document.getElementById("tab-topics");
    const items = STATE.data.topics || [];
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>연구 주제 <span class="count">${items.length}개</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-primary" id="topic-save">💾 research_topics.json 저장</button>
        </div>
      </div>
      <div class="admin-card" style="color:var(--color-text-muted);font-size:var(--fs-sm)">
        💡 SVG 도해는 코드 직접 수정이 필요합니다. 여기서는 제목/설명/키워드/대표논문만 편집 가능합니다.
      </div>
      ${items.map((t, i) => `
        <div class="admin-card">
          <div class="admin-section-head">
            <h3>${escapeHtml(t.title_ko)} <span class="td-dim">— ${escapeHtml(t.title_en)}</span></h3>
            <button class="btn btn-ghost btn-sm" data-action="edit-topic" data-idx="${i}">편집</button>
          </div>
          <p style="color:var(--color-text-muted);font-size:var(--fs-sm)">${escapeHtml(t.summary_ko)}</p>
          <div style="font-size:var(--fs-xs);color:var(--color-text-light);margin-top:.5rem">키워드: ${(t.keywords || []).join(", ")}</div>
        </div>
      `).join("")}
    `;
    host.querySelector("#topic-save").onclick = () => saveJSON("research_topics.json", STATE.data.topics);
    host.querySelectorAll("[data-action=edit-topic]").forEach(b => b.onclick = () => editTopic(+b.dataset.idx));
  }

  function editTopic(idx) {
    const t = { ...STATE.data.topics[idx] };
    if (!Array.isArray(t.images)) t.images = [];
    const papersText = (t.representative_papers || []).map(p => {
      if (typeof p === "string") return p;
      return `${p.title || ""} | ${p.venue || ""} | ${p.year || ""}`;
    }).join("\n");

    const body = `
      <div class="admin-form">
        <div class="admin-form-row"><label>한글 제목</label><input id="f-title-ko" value="${escapeAttr(t.title_ko)}" /></div>
        <div class="admin-form-row"><label>영문 제목</label><input id="f-title-en" value="${escapeAttr(t.title_en)}" /></div>
        <div class="admin-form-row full"><label>짧은 설명 (한)</label><textarea id="f-sum-ko" style="min-height:70px">${escapeHtml(t.summary_ko || "")}</textarea><div class="hint">Research 페이지 카드에 표시. 1-2 문장.</div></div>
        <div class="admin-form-row full"><label>짧은 설명 (EN)</label><textarea id="f-sum-en" style="min-height:70px">${escapeHtml(t.summary_en || "")}</textarea></div>
        <div class="admin-form-row"><label>메인 헤딩 (한)</label><input id="f-heading-ko" value="${escapeAttr(t.heading_ko || "")}" placeholder="예: Various Materials for Batteries" /></div>
        <div class="admin-form-row"><label>메인 헤딩 (EN)</label><input id="f-heading-en" value="${escapeAttr(t.heading_en || "")}" /></div>
        <div class="admin-form-row"><label>서브 헤딩 (한)</label><input id="f-subheading-ko" value="${escapeAttr(t.subheading_ko || "")}" placeholder="(Cathode, Anodes, Solid Electrolytes, etc)" /></div>
        <div class="admin-form-row"><label>서브 헤딩 (EN)</label><input id="f-subheading-en" value="${escapeAttr(t.subheading_en || "")}" /></div>
        <div class="admin-form-row full"><label>상세 본문 (한)</label><textarea id="f-detail-ko" style="min-height:200px">${escapeHtml(t.detail_body_ko || "")}</textarea><div class="hint">세부 페이지(research-detail)에 표시. 빈 줄로 문단 구분.</div></div>
        <div class="admin-form-row full"><label>상세 본문 (EN)</label><textarea id="f-detail-en" style="min-height:200px">${escapeHtml(t.detail_body_en || "")}</textarea></div>
        <div class="admin-form-row"><label>키워드</label><input id="f-keys" value="${escapeAttr((t.keywords || []).join(', '))}" placeholder="쉼표로 구분" /></div>
        <div class="admin-form-row full">
          <label>히어로 사진 <span class="td-dim" style="font-weight:400">(첫 번째가 Research 카드 썸네일로 사용됨)</span></label>
          <div class="admin-card" style="padding:var(--space-3);background:var(--color-surface);border:1px dashed var(--color-border);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;justify-content:space-between">
            <div style="font-size:var(--fs-sm);color:var(--color-text-muted)">
              📁 여러 장 동시 업로드 가능 (Ctrl/Cmd+클릭)<br/>
              🖼 첫 번째 사진이 Research 목록·홈 카드 커버로 사용됩니다.
            </div>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">
              📁 사진 선택
              <input type="file" id="t-multi-upload" accept="image/jpeg,image/png,image/webp" multiple style="display:none" />
            </label>
          </div>
          <div id="t-upload-progress" style="margin-top:var(--space-2);font-size:var(--fs-sm);color:var(--color-text-muted)"></div>
          <div id="t-images-list" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="admin-form-row full"><label>대표 논문</label><textarea id="f-papers" class="code" style="min-height:120px">${escapeHtml(papersText)}</textarea><div class="hint" style="margin-top:.25rem">한 줄에 한 편씩. 형식: <code>제목 | 저널 | 연도</code> (| 로 구분)</div></div>
      </div>
    `;
    openModal("연구 주제 편집", body, () => {
      t.title_ko = val("f-title-ko");
      t.title_en = val("f-title-en");
      t.summary_ko = val("f-sum-ko");
      t.summary_en = val("f-sum-en");
      t.heading_ko = val("f-heading-ko");
      t.heading_en = val("f-heading-en");
      t.subheading_ko = val("f-subheading-ko");
      t.subheading_en = val("f-subheading-en");
      t.detail_body_ko = val("f-detail-ko");
      t.detail_body_en = val("f-detail-en");
      t.keywords = val("f-keys").split(",").map(s => s.trim()).filter(Boolean);
      t.representative_papers = val("f-papers").split("\n").map(s => s.trim()).filter(Boolean).map(line => {
        const parts = line.split("|").map(x => x.trim());
        if (parts.length >= 2) {
          return { title: parts[0], venue: parts[1] || "", year: parseInt(parts[2]) || undefined };
        }
        return line;
      });
      STATE.data.topics[idx] = t;
      closeModal();
      renderTopics();
      saveJSON("research_topics.json", STATE.data.topics);
    });

    const listHost = document.getElementById("t-images-list");
    const progressHost = document.getElementById("t-upload-progress");

    function renderImages() {
      if (t.images.length === 0) {
        listHost.innerHTML = `<div class="td-dim" style="font-size:var(--fs-sm);text-align:center;padding:var(--space-6);border:1px dashed var(--color-border);border-radius:6px">추가된 사진이 없습니다.</div>`;
        return;
      }
      listHost.innerHTML = `<div class="gallery-edit-grid">${
        t.images.map((src, i) => `
          <div class="gallery-edit-item ${i === 0 ? "is-banner" : ""}" data-i="${i}">
            <div class="gallery-edit-thumb">
              <img src="${escapeAttr(src)}" alt="" />
              ${i === 0 ? `<div class="gallery-edit-banner-badge">🖼 커버</div>` : ""}
            </div>
            <div class="gallery-edit-body">
              <div class="gallery-edit-row">
                <strong style="font-size:var(--fs-sm)">사진 ${i + 1}</strong>
                <div class="gallery-edit-actions">
                  <button type="button" class="btn btn-${i === 0 ? "primary" : "outline"} btn-sm" data-cover="${i}" title="첫 번째 위치로 이동 (커버로 지정)">${i === 0 ? "🖼 커버" : "🖼 커버로"}</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-dn="${i}" ${i === t.images.length - 1 ? "disabled" : ""}>↓</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-del="${i}" style="color:#cc0033">✕</button>
                </div>
              </div>
            </div>
          </div>`).join("")
      }</div>`;

      listHost.querySelectorAll("[data-cover]").forEach(b => b.onclick = () => {
        const i = +b.dataset.cover;
        if (i === 0) return;
        const [img] = t.images.splice(i, 1);
        t.images.unshift(img);
        renderImages();
      });
      listHost.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
        t.images.splice(+b.dataset.del, 1);
        renderImages();
      });
      listHost.querySelectorAll("[data-up]").forEach(b => b.onclick = () => {
        const i = +b.dataset.up; if (i <= 0) return;
        [t.images[i - 1], t.images[i]] = [t.images[i], t.images[i - 1]];
        renderImages();
      });
      listHost.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => {
        const i = +b.dataset.dn; if (i >= t.images.length - 1) return;
        [t.images[i + 1], t.images[i]] = [t.images[i], t.images[i + 1]];
        renderImages();
      });
    }
    renderImages();

    document.getElementById("t-multi-upload").onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      let done = 0, failed = 0;
      const total = files.length;
      progressHost.textContent = `업로드 중... 0 / ${total}`;
      for (const file of files) {
        try {
          const dataUrl = await resizeImageFile(file, 1600, 1600, 0.85);
          t.images.push(dataUrl);
          done++;
        } catch (err) {
          failed++;
          console.error(err);
        }
        progressHost.textContent = `업로드 중... ${done + failed} / ${total}${failed ? ` (실패 ${failed})` : ""}`;
        renderImages();
      }
      progressHost.textContent = `✅ ${done}장 업로드 완료${failed ? ` · ${failed}장 실패` : ""}`;
      e.target.value = "";
      setTimeout(() => { progressHost.textContent = ""; }, 4000);
    };
  }

  /* =========================================================================
   * Announcement (popup) editor
   * ========================================================================= */
  function renderAnnouncement() {
    const host = document.getElementById("tab-announcement");
    const a = STATE.data.announcement || {};
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>공지 팝업 <span class="count">${a.enabled ? "ON" : "OFF"}</span></h2>
        <div class="admin-section-actions">
          <button class="btn btn-outline" id="ann-preview">👁 미리보기</button>
          <button class="btn btn-primary" id="ann-save">💾 announcement.json 저장</button>
        </div>
      </div>

      <div class="admin-card" style="background:#FFF7E6;border-color:#FFD699;color:#7A4E00;font-size:.875rem">
        <b>📢 사용 안내</b><br/>
        공지 팝업은 공개 사이트 첫 방문 시 모달로 표시됩니다. 사용자가 "다시 보지 않기" 클릭 시 그 ID 의 공지는 다시 안 보임.
        새로 띄우려면 <b>ID</b> 를 다른 값으로 바꾸세요 (예: <code>ann-2026-05-publication</code>). 그러면 모든 사용자에게 다시 보입니다.
      </div>

      <div class="admin-card">
        <h3>설정</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>공지 활성화</label>
            <div class="admin-checkbox"><input id="a-enabled" type="checkbox" ${a.enabled ? 'checked' : ''} /> <label for="a-enabled">공개 사이트에 팝업 표시</label></div>
          </div>
          <div class="admin-form-row"><label>공지 ID</label><input id="a-id" value="${escapeAttr(a.id || 'ann-' + new Date().toISOString().slice(0,7))}" /><div class="hint">이 ID 가 바뀌면 사용자에게 새 공지로 인식되어 다시 표시됩니다.</div></div>
          <div class="admin-form-row"><label>만료일 (선택)</label><input id="a-expires" type="date" value="${escapeAttr(a.expires || '')}" /><div class="hint">이 날짜 이후로는 자동으로 표시 안 됨. 비워두면 무기한.</div></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>한글 공지</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>제목 (한)</label><input id="a-t-ko" value="${escapeAttr(a.title_ko || '')}" placeholder="2026학년도 대학원생 모집" /></div>
          <div class="admin-form-row full"><label>본문 (한)</label><textarea id="a-b-ko" style="min-height:120px">${escapeHtml(a.body_ko || '')}</textarea></div>
          <div class="admin-form-row"><label>버튼 텍스트</label><input id="a-bt-ko" value="${escapeAttr(a.button_text_ko || '')}" placeholder="Contact 페이지로" /></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>English Announcement</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>Title (EN)</label><input id="a-t-en" value="${escapeAttr(a.title_en || '')}" /></div>
          <div class="admin-form-row full"><label>Body (EN)</label><textarea id="a-b-en" style="min-height:120px">${escapeHtml(a.body_en || '')}</textarea></div>
          <div class="admin-form-row"><label>Button Text</label><input id="a-bt-en" value="${escapeAttr(a.button_text_en || '')}" /></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>버튼 링크</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>Button URL</label><input id="a-url" value="${escapeAttr(a.button_url || '')}" placeholder="contact.html 또는 https://..." /><div class="hint">비워두면 버튼 안 보임.</div></div>
        </div>
      </div>

      <div class="admin-card" style="display:flex;gap:var(--space-3);align-items:center;justify-content:space-between;position:sticky;bottom:0;background:#fff;border:2px solid var(--color-primary);box-shadow:0 -4px 16px rgba(0,0,0,0.08);z-index:5">
        <div style="font-size:var(--fs-sm);color:var(--color-text-muted)">
          편집 완료 후 아래 <b>저장</b> 버튼을 눌러야 GitHub에 반영됩니다.
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-outline" id="ann-preview-2" style="min-width:120px">👁 미리보기</button>
          <button class="btn btn-primary" id="ann-save-2" style="min-width:160px;font-size:var(--fs-base)">💾 저장하기</button>
        </div>
      </div>
    `;

    function readAnnouncement() {
      return {
        id: val("a-id") || "ann-" + Date.now(),
        enabled: document.getElementById("a-enabled").checked,
        title_ko: val("a-t-ko"), title_en: val("a-t-en"),
        body_ko: val("a-b-ko"), body_en: val("a-b-en"),
        button_text_ko: val("a-bt-ko"), button_text_en: val("a-bt-en"),
        button_url: val("a-url"),
        expires: val("a-expires")
      };
    }

    const saveHandler = () => {
      const updated = readAnnouncement();
      STATE.data.announcement = updated;
      // Clear 'dismissed' flags in THIS browser so the popup shows again
      // on the next visit to the public site (most common confusion: user
      // clicked '다시 보지 않기' once and then can't see their own popup).
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("eeml:ann:dismissed:")) localStorage.removeItem(k);
      }
      saveJSON("announcement.json", updated);
      toast("✅ 저장됨 + 이 브라우저 dismissal 초기화됨 — 공개 사이트 새 탭으로 열면 팝업 보임", "success");
    };

    // Both top and bottom save buttons run the same handler
    host.querySelector("#ann-save").onclick = saveHandler;
    host.querySelector("#ann-save-2").onclick = saveHandler;

    // Update STATE live (without GitHub commit) so tab switching doesn't
    // lose in-progress edits. Orange "변경됨 — 저장" indicator appears
    // on both save buttons until committed.
    const saveBtns = [host.querySelector("#ann-save"), host.querySelector("#ann-save-2")];
    const originalTexts = saveBtns.map(b => b.textContent);
    const onField = () => {
      STATE.data.announcement = readAnnouncement();
      saveBtns.forEach((b, i) => {
        b.textContent = i === 0 ? "● 변경됨 — 저장" : "● 저장하기 (변경 있음)";
        b.classList.add("btn-dirty");
      });
    };
    saveBtns.forEach((b, i) => b.addEventListener("click", () => {
      setTimeout(() => {
        b.textContent = originalTexts[i];
        b.classList.remove("btn-dirty");
      }, 100);
    }));
    host.querySelectorAll("#tab-announcement input, #tab-announcement textarea")
      .forEach(el => {
        el.addEventListener("input", onField);
        el.addEventListener("change", onField);
      });

    const previewHandler = () => {
      const id = val("a-id");
      if (id) localStorage.removeItem("eeml:ann:dismissed:" + id);
      toast("이 브라우저의 dismissal 을 초기화했습니다. 공개 사이트를 새 탭으로 열면 공지가 보입니다.", "success");
    };
    host.querySelector("#ann-preview").onclick = previewHandler;
    host.querySelector("#ann-preview-2").onclick = previewHandler;
  }

  /* =========================================================================
   * Visitor stats — now powered by Google Analytics 4
   * The old counterapi.dev backend was discontinued (record-not-found 400);
   * we open the GA4 dashboard in a new tab where the full report lives.
   * ========================================================================= */
  function renderStats() {
    const host = document.getElementById("tab-stats");
    const cfg = (STATE.data && STATE.data.config) || {};
    const gaId = (cfg.analytics && cfg.analytics.ga4_id) || "";
    const configured = /^G-[A-Z0-9]+$/i.test(gaId);

    const dashboardUrl = configured
      ? "https://analytics.google.com/analytics/web/#/"
      : "https://analytics.google.com/";

    host.innerHTML = `
      <div class="admin-section-head">
        <h2>접속 통계</h2>
        <div class="admin-section-actions">
          <a href="${dashboardUrl}" target="_blank" rel="noopener" class="btn btn-primary">📊 GA4 대시보드 열기 ↗</a>
        </div>
      </div>

      ${configured ? `
        <div class="admin-card" style="background:#dcfce7;border-color:#86efac;color:#166534">
          <b>✅ Google Analytics 4 연결됨</b> &nbsp;<code style="background:rgba(255,255,255,0.5);padding:2px 6px;border-radius:4px">${escapeHtml(gaId)}</code><br/>
          모든 페이지에 GA4 추적 코드가 자동으로 삽입됩니다. 위 <b>📊 GA4 대시보드 열기</b> 버튼을 눌러 실시간/일별/주별/월별 방문 통계, 인기 페이지, 유입 경로, 디바이스/지역 분포 등을 확인하세요.
        </div>

        <div class="admin-card" style="margin-top:1.5rem">
          <h3 style="margin-top:0">📌 GA4 에서 볼 수 있는 통계</h3>
          <ul style="line-height:1.9;margin:0;padding-left:1.25rem">
            <li><b>실시간</b> — 지금 사이트 보고 있는 사용자 수, 활동 중인 페이지</li>
            <li><b>방문자</b> — 일/주/월별 활성 사용자, 신규 vs 재방문</li>
            <li><b>인기 페이지</b> — 가장 많이 본 페이지 (예: /pi, /publications, /research)</li>
            <li><b>유입 경로</b> — 검색엔진/직접/추천/소셜 등 어디서 들어오는지</li>
            <li><b>지역 / 언어 / 디바이스</b> — 방문자 분포</li>
            <li><b>참여도</b> — 평균 체류 시간, 이탈률, 페이지/세션</li>
          </ul>
        </div>
      ` : `
        <div class="admin-card" style="background:#fef3c7;border-color:#fcd34d;color:#92400e">
          <b>⚠ Google Analytics 4 미설정</b><br/>
          접속 통계를 보려면 GA4 측정 ID (<code>G-XXXXXXXXXX</code>)를 발급받아 <b>⚙️ 기본설정</b> 탭의 <b>GA4 측정 ID</b> 칸에 입력하세요.
        </div>

        <div class="admin-card" style="margin-top:1.5rem">
          <h3 style="margin-top:0">📝 GA4 설정 방법 (5분)</h3>
          <ol style="line-height:1.9;margin:0;padding-left:1.25rem">
            <li><a href="https://analytics.google.com" target="_blank" rel="noopener"><b>analytics.google.com</b> ↗</a> 접속 (Google 계정 로그인)</li>
            <li>좌측 하단 <b>관리(⚙️)</b> → <b>+ 계정 만들기</b> (이미 있으면 패스) → 계정 이름: <code>EEML Lab</code></li>
            <li><b>+ 속성 만들기</b> → 속성 이름: <code>eeml.gachon.ac.kr</code>, 시간대: <b>대한민국</b>, 통화: <b>KRW</b></li>
            <li>비즈니스 정보 입력 (선택) → <b>웹 스트림 추가</b>:
              <ul style="margin-top:.5rem"><li>URL: <code>https://eeml.gachon.ac.kr</code></li><li>스트림 이름: <code>EEML Public Site</code></li></ul>
            </li>
            <li>표시된 <b>측정 ID <code>G-XXXXXXXXXX</code></b> 복사</li>
            <li>이 admin 페이지의 <b>⚙️ 기본설정</b> 탭 → <b>GA4 측정 ID</b> 칸에 붙여넣기 → 저장</li>
          </ol>
          <p style="margin-top:1rem;color:var(--c-text-muted);font-size:.875rem">
            💡 저장 후 2분 내로 사이트에 추적 코드가 자동 배포됩니다. 첫 방문이 GA4에 잡히는 데는 보통 5~30분 걸립니다.
          </p>
        </div>
      `}
    `;
  }

  /* =========================================================================
   * Config editor
   * ========================================================================= */
  function renderConfig() {
    const host = document.getElementById("tab-config");
    const c = STATE.data.config || {};
    host.innerHTML = `
      <div class="admin-section-head">
        <h2>기본 설정</h2>
        <div class="admin-section-actions">
          <button class="btn btn-primary" id="cfg-save">💾 config.json 저장</button>
        </div>
      </div>

      <div class="admin-card">
        <h3>연구실 정보</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>영문 이름</label><input id="c-name-en" value="${escapeAttr(c.lab?.name_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 이름</label><input id="c-name-ko" value="${escapeAttr(c.lab?.name_ko || '')}" /></div>
          <div class="admin-form-row"><label>약칭</label><input id="c-short" value="${escapeAttr(c.lab?.short || '')}" /></div>
          <div class="admin-form-row"><label>영문 슬로건</label><input id="c-sl-en" value="${escapeAttr(c.lab?.slogan_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 슬로건</label><input id="c-sl-ko" value="${escapeAttr(c.lab?.slogan_ko || '')}" /></div>
          <div class="admin-form-row"><label>영문 소속</label><input id="c-af-en" value="${escapeAttr(c.lab?.affiliation_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 소속</label><input id="c-af-ko" value="${escapeAttr(c.lab?.affiliation_ko || '')}" /></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>연락처</h3>
        <div class="admin-form">
          <div class="admin-form-row"><label>이메일</label><input id="c-email" type="email" value="${escapeAttr(c.contact?.email || '')}" /></div>
          <div class="admin-form-row"><label>한글 주소</label><input id="c-ad-ko" value="${escapeAttr(c.contact?.address_ko || '')}" /></div>
          <div class="admin-form-row"><label>영문 주소</label><input id="c-ad-en" value="${escapeAttr(c.contact?.address_en || '')}" /></div>
          <div class="admin-form-row"><label>한글 상세</label><input id="c-adx-ko" value="${escapeAttr(c.contact?.address_detail_ko || '')}" placeholder="건물/호수" /></div>
          <div class="admin-form-row"><label>영문 상세</label><input id="c-adx-en" value="${escapeAttr(c.contact?.address_detail_en || '')}" /></div>
          <div class="admin-form-row"><label>전화</label><input id="c-phone" value="${escapeAttr(c.contact?.phone || '')}" /></div>
          <div class="admin-form-row full"><label>Google Maps 임베드 URL</label><input id="c-maps" value="${escapeAttr(c.contact?.maps_embed || '')}" /></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>연구실 대표 사진</h3>
        <p class="card-sub">홈 Hero 섹션 및 소셜 공유(OG) 이미지로 사용됩니다. 연구실 단체사진, 장비 전경 등. 가로형 추천.</p>
        <div id="c-hero-img-host"></div>
      </div>

      <div class="admin-card">
        <h3>Scholar 지표</h3>
        <p class="card-sub">Google Scholar 프로필에서 정기적으로 업데이트하세요.</p>
        <div class="admin-form">
          <div class="admin-form-row"><label>Citations 전체</label><input id="c-cit" type="number" value="${c.metrics?.citations_total || 0}" /></div>
          <div class="admin-form-row"><label>Citations 최근 5년</label><input id="c-cit5" type="number" value="${c.metrics?.citations_recent5y || 0}" /></div>
          <div class="admin-form-row"><label>h-index</label><input id="c-h" type="number" value="${c.metrics?.h_index || 0}" /></div>
          <div class="admin-form-row"><label>i10-index</label><input id="c-i10" type="number" value="${c.metrics?.i10_index || 0}" /></div>
          <div class="admin-form-row"><label>기준 (YYYY-MM)</label><input id="c-asof" value="${escapeAttr(c.metrics?.as_of || '')}" /></div>
        </div>
      </div>
    `;
    const heroImgPicker = mountImagePicker(
      document.getElementById("c-hero-img-host"),
      c.lab?.hero_image || "",
      { maxW: 1600, maxH: 900 },
      () => {}
    );

    host.querySelector("#cfg-save").onclick = () => {
      const c2 = { ...STATE.data.config };
      c2.lab = { ...c2.lab,
        name_en: val("c-name-en"), name_ko: val("c-name-ko"), short: val("c-short"),
        slogan_en: val("c-sl-en"), slogan_ko: val("c-sl-ko"),
        affiliation_en: val("c-af-en"), affiliation_ko: val("c-af-ko"),
        hero_image: heroImgPicker.getValue() || ""
      };
      c2.contact = { ...c2.contact,
        email: val("c-email"),
        address_ko: val("c-ad-ko"), address_en: val("c-ad-en"),
        address_detail_ko: val("c-adx-ko"), address_detail_en: val("c-adx-en"),
        phone: val("c-phone"), maps_embed: val("c-maps")
      };
      c2.metrics = { ...c2.metrics,
        citations_total: parseInt(val("c-cit")) || 0,
        citations_recent5y: parseInt(val("c-cit5")) || 0,
        h_index: parseInt(val("c-h")) || 0,
        i10_index: parseInt(val("c-i10")) || 0,
        as_of: val("c-asof")
      };
      STATE.data.config = c2;
      saveJSON("config.json", c2);
    };
  }

  /* =========================================================================
   * Settings: password change, import, reset
   * ========================================================================= */
  function renderSettings() {
    const host = document.getElementById("tab-settings");
    host.innerHTML = `
      <div class="admin-section-head"><h2>관리자 설정</h2></div>

      <div class="admin-card">
        <h3>🔑 비밀번호 변경</h3>
        <p class="card-sub">새 비밀번호는 이 브라우저의 localStorage 에 해시로 저장됩니다. <b>잊어버리면 F12 개발자도구 Console 에서 <code>localStorage.removeItem('eeml:admin:pwhash')</code> 실행 후 기본 비밀번호 <code>eeml2026</code> 로 다시 로그인</b>하세요.</p>
        <div class="admin-form" id="pw-form">
          <div class="admin-form-row"><label>현재 비밀번호</label><input id="pw-cur" type="password" autocomplete="current-password" /></div>
          <div class="admin-form-row"><label>새 비밀번호</label><input id="pw-new" type="password" autocomplete="new-password" /></div>
          <div class="admin-form-row"><label>새 비밀번호 확인</label><input id="pw-new2" type="password" autocomplete="new-password" /></div>
          <div class="admin-form-row full">
            <button type="button" class="btn btn-primary" id="pw-save">비밀번호 변경</button>
            <span id="pw-status" style="margin-left:1rem;font-size:.875rem;font-weight:500"></span>
          </div>
        </div>
      </div>

      <div class="admin-card">
        <h3>📥 JSON 가져오기</h3>
        <p class="card-sub">이전에 다운로드한 JSON 파일을 불러와서 에디터에 반영합니다. (실제 서버 데이터는 파일 교체 후 새로고침해야 반영됨)</p>
        <div class="admin-form">
          <div class="admin-form-row"><label>publications.json</label><input type="file" accept=".json" data-import="publications" /></div>
          <div class="admin-form-row"><label>members.json</label><input type="file" accept=".json" data-import="members" /></div>
          <div class="admin-form-row"><label>news.json</label><input type="file" accept=".json" data-import="news" /></div>
          <div class="admin-form-row"><label>research_topics.json</label><input type="file" accept=".json" data-import="topics" /></div>
          <div class="admin-form-row"><label>gallery.json</label><input type="file" accept=".json" data-import="gallery" /></div>
          <div class="admin-form-row"><label>config.json</label><input type="file" accept=".json" data-import="config" /></div>
        </div>
      </div>

      <div class="admin-card">
        <h3>🚀 GitHub 자동 배포</h3>
        <p class="card-sub">
          <b>토큰을 설정하면 ✨ "저장" 버튼 = 자동 커밋·배포</b>. 다시 JSON 파일 받을 필요 없음.<br/>
          토큰은 이 브라우저의 localStorage 에만 저장됩니다. 절대 공유 금지.<br/>
          <b>토큰 만들기</b>: <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">github.com/settings/tokens (Fine-grained)</a> →
          Repository access = <code>dl1128-cmd/eeml</code> → Permissions → <b>Contents: Read and write</b> → Generate.
        </p>
        <div class="admin-form">
          <div class="admin-form-row"><label>GitHub repo</label><input id="gh-repo" placeholder="dl1128-cmd/eeml" /></div>
          <div class="admin-form-row"><label>Personal Access Token</label><input id="gh-token" type="password" placeholder="github_pat_..." autocomplete="off" /></div>
          <div class="admin-form-row full">
            <button type="button" class="btn btn-primary" id="gh-save">토큰 저장</button>
            <button type="button" class="btn btn-outline" id="gh-test" style="margin-left:.5rem">연결 테스트</button>
            <button type="button" class="btn btn-ghost" id="gh-clear" style="margin-left:.5rem;color:#cc0033">토큰 삭제</button>
            <span id="gh-status" style="margin-left:1rem;font-size:.875rem;font-weight:500"></span>
          </div>
        </div>
      </div>

      <div class="admin-card" style="border-color:#FFD699;background:#FFF7E6">
        <h3 style="color:#7A4E00">⚠️ 보안 안내</h3>
        <p style="color:#7A4E00;font-size:var(--fs-sm);line-height:1.7">
          이 관리자 페이지는 <b>소프트 게이트</b>입니다 — 학생들의 실수로 인한 편집을 막는 용도이며, 악의적 공격에 대한 보안은 아닙니다.
          비밀번호 해시가 JavaScript 소스에 노출되며, 다운로드된 JSON 은 누군가 서버에 업로드해야 실제 사이트에 반영됩니다.
          <b>진짜 인증</b>이 필요하면 GitHub Pages + Decap CMS (GitHub OAuth) 또는 Firebase Auth 같은 백엔드 솔루션을 검토하세요.
        </p>
      </div>
    `;
    const pwStatus = (msg, kind) => {
      const el = document.getElementById("pw-status");
      if (el) {
        el.textContent = msg;
        el.style.color = kind === "success" ? "#0F47B8" : kind === "error" ? "#cc0033" : "var(--c-text-light)";
      }
    };

    host.querySelector("#pw-save").onclick = async (e) => {
      e.preventDefault();
      pwStatus("처리 중...", "info");
      const cur = val("pw-cur"), n1 = val("pw-new"), n2 = val("pw-new2");
      if (!cur || !n1 || !n2) { pwStatus("⚠ 모든 항목을 입력하세요", "error"); return toast("모든 항목을 입력하세요", "error"); }
      if (n1.length < 4) { pwStatus("⚠ 새 비밀번호는 4자 이상", "error"); return toast("새 비밀번호는 4자 이상", "error"); }
      if (n1 !== n2) { pwStatus("⚠ 새 비밀번호가 일치하지 않습니다", "error"); return toast("새 비밀번호가 일치하지 않습니다", "error"); }
      try {
        const curHash = await sha256(cur);
        if (curHash !== getStoredHash()) { pwStatus("⚠ 현재 비밀번호가 맞지 않습니다", "error"); return toast("현재 비밀번호가 맞지 않습니다", "error"); }
        const newHash = await sha256(n1);
        localStorage.setItem(LS_PW_HASH, newHash);
        // Verify it actually saved
        const verify = localStorage.getItem(LS_PW_HASH);
        if (verify !== newHash) { pwStatus("⚠ localStorage 저장 실패 (브라우저 설정 확인)", "error"); return toast("저장 실패", "error"); }
        pwStatus("✓ 비밀번호가 변경되었습니다 — 다음 로그인부터 적용", "success");
        toast("비밀번호 변경됨 — 다음 로그인부터 적용", "success");
        document.getElementById("pw-cur").value = "";
        document.getElementById("pw-new").value = "";
        document.getElementById("pw-new2").value = "";
      } catch (err) {
        console.error("Password change failed:", err);
        pwStatus("⚠ 오류: " + (err.message || "알 수 없는 오류"), "error");
        toast("오류: " + (err.message || "알 수 없음"), "error");
      }
    };
    host.querySelectorAll("[data-import]").forEach(input => {
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const key = e.target.dataset.import;
        const r = new FileReader();
        r.onload = () => {
          try {
            STATE.data[key] = JSON.parse(r.result);
            toast(`${key} 불러오기 완료`, "success");
            if (STATE.currentTab !== "settings") switchTab(STATE.currentTab);
          } catch (err) {
            toast("JSON 파싱 실패", "error");
          }
        };
        r.readAsText(file);
      };
    });

    // GitHub token handlers
    const repoInput = document.getElementById("gh-repo");
    const tokenInput = document.getElementById("gh-token");
    const ghStatus = document.getElementById("gh-status");
    const setGhStatus = (msg, kind) => {
      ghStatus.textContent = msg;
      ghStatus.style.color = kind === "success" ? "#0F47B8" : kind === "error" ? "#cc0033" : "var(--c-text-light)";
    };
    const cur = getGH();
    repoInput.value = cur.repo;
    // Show masked token if already stored
    if (cur.token) tokenInput.value = "•".repeat(Math.min(cur.token.length, 40));

    document.getElementById("gh-save").onclick = () => {
      const repo = repoInput.value.trim();
      const raw = tokenInput.value;
      // If field is still showing bullets only, nothing new to save
      if (/^[•\s]*$/.test(raw)) return setGhStatus("⚠ 새 토큰을 입력하세요", "error");
      const token = sanitizeToken(raw);
      if (!repo || !repo.includes("/")) return setGhStatus("⚠ repo 는 owner/name 형식", "error");
      if (!token) return setGhStatus("⚠ 토큰을 입력하세요", "error");
      if (token.length < 20) return setGhStatus("⚠ 토큰이 너무 짧음 — 다시 확인하세요", "error");
      localStorage.setItem(LS_GH_REPO, repo);
      localStorage.setItem(LS_GH_TOKEN, token);
      setGhStatus(`✓ 저장됨 (길이 ${token.length}자) — 이제 저장 버튼이 GitHub에 바로 커밋합니다`, "success");
      tokenInput.value = "•".repeat(Math.min(token.length, 40));
    };

    document.getElementById("gh-test").onclick = async () => {
      setGhStatus("테스트 중...", "info");
      try {
        const { repo, token: stored } = getGH();
        const field = tokenInput.value;
        const token = /^[•\s]*$/.test(field) ? stored : sanitizeToken(field);
        if (!token) return setGhStatus("⚠ 먼저 토큰을 저장하세요", "error");
        if (token.length < 20) return setGhStatus(`⚠ 토큰이 손상됨 (길이 ${token.length}) — 삭제 후 다시 붙여넣기`, "error");
        const r = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { "Authorization": `token ${token}`, "Accept": "application/vnd.github+json" },
        });
        if (!r.ok) {
          const msg = (await r.json().catch(() => ({}))).message || `HTTP ${r.status}`;
          return setGhStatus(`✗ 실패: ${msg}`, "error");
        }
        const info = await r.json();
        setGhStatus(`✓ ${info.full_name} 연결됨 (${info.private ? "private" : "public"})`, "success");
      } catch (err) {
        setGhStatus(`✗ ${err.message}`, "error");
      }
    };

    document.getElementById("gh-clear").onclick = () => {
      if (!confirm("저장된 토큰을 삭제하시겠습니까?")) return;
      localStorage.removeItem(LS_GH_TOKEN);
      tokenInput.value = "";
      setGhStatus("토큰 삭제됨 — 이제 저장은 파일 다운로드로 돌아갑니다", "info");
    };
  }

  /* =========================================================================
   * Modal helpers
   * ========================================================================= */
  function openModal(title, bodyHTML, onSave) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = bodyHTML;
    STATE.modal.onSave = onSave;
    document.getElementById("modal").classList.remove("hidden");
  }
  function closeModal() {
    document.getElementById("modal").classList.add("hidden");
    STATE.modal.onSave = null;
  }

  /* =========================================================================
   * Toast
   * ========================================================================= */
  let toastTimer;
  function toast(msg, type) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "admin-toast show" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "admin-toast"), 3000);
  }

  /* =========================================================================
   * Utils
   * ========================================================================= */
  function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* =========================================================================
   * Boot
   * ========================================================================= */
  document.getElementById("login-form").addEventListener("submit", handleLogin);
})();
