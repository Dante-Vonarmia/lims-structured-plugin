export function createDocxPreviewFeature(deps = {}) {
  const {
    $,
    state,
    setPreviewPlaceholder,
    appendLog,
    localJszipUrls,
    externalJszipUrls,
    localDocxPreviewUrls,
    externalDocxPreviewUrls,
    localDocxPreviewCssUrls,
    externalDocxPreviewCssUrls,
  } = deps;

  function getJszipUrls() {
    return state.runtime.offlineMode ? [...localJszipUrls] : [...localJszipUrls, ...externalJszipUrls];
  }

  function getDocxPreviewUrls() {
    return state.runtime.offlineMode ? [...localDocxPreviewUrls] : [...localDocxPreviewUrls, ...externalDocxPreviewUrls];
  }

  function getDocxPreviewCssUrls() {
    return state.runtime.offlineMode ? [...localDocxPreviewCssUrls] : [...localDocxPreviewCssUrls, ...externalDocxPreviewCssUrls];
  }

  function loadStyleOnce(url) {
    return new Promise((resolve) => {
      const exists = document.querySelector(`link[data-src="${url}"]`);
      if (exists) {
        if (exists.dataset.loaded === "1") return resolve(true);
        exists.addEventListener("load", () => resolve(true), { once: true });
        exists.addEventListener("error", () => resolve(false), { once: true });
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.dataset.src = url;
      link.addEventListener("load", () => { link.dataset.loaded = "1"; resolve(true); }, { once: true });
      link.addEventListener("error", () => resolve(false), { once: true });
      document.head.appendChild(link);
    });
  }

  function loadScriptOnce(url) {
    return new Promise((resolve) => {
      const exists = document.querySelector(`script[data-src="${url}"]`);
      if (exists) {
        if (exists.dataset.loaded === "1") return resolve(true);
        exists.addEventListener("load", () => resolve(true), { once: true });
        exists.addEventListener("error", () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.src = url;
      script.addEventListener("load", () => { script.dataset.loaded = "1"; resolve(true); }, { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadCssFromCandidates(urls) {
    for (const url of urls) {
      const ok = await loadStyleOnce(url);
      if (ok) return true;
    }
    return false;
  }

  async function loadFromCandidates(urls, readyCheck) {
    for (const url of urls) {
      const ok = await loadScriptOnce(url);
      if (ok && readyCheck()) return true;
    }
    return readyCheck();
  }

  function hasDocxLibReady() {
    return !!(window.JSZip && window.docx && typeof window.docx.renderAsync === "function");
  }

  async function ensureDocxLib() {
    if (state.docxReady && hasDocxLibReady()) return true;
    if (state.docxLoadingPromise) return state.docxLoadingPromise;
    state.docxLoadingPromise = new Promise((resolve) => {
      (async () => {
        await loadCssFromCandidates(getDocxPreviewCssUrls());
        const jszipReady = await loadFromCandidates(getJszipUrls(), () => !!window.JSZip);
        if (!jszipReady) return resolve(false);
        const docxReady = await loadFromCandidates(getDocxPreviewUrls(), () => !!(window.docx && typeof window.docx.renderAsync === "function"));
        state.docxReady = jszipReady && docxReady && hasDocxLibReady();
        resolve(state.docxReady);
      })();
    });
    return state.docxLoadingPromise;
  }

  async function renderDocx(elId, arrayBuffer) {
    const el = $(elId);
    el.innerHTML = '<div class="placeholder">Word 渲染中...</div>';
    const ok = await ensureDocxLib();
    if (!ok) {
      const msg = state.runtime.offlineMode
        ? "离线模式缺少 Word 预览组件：请补齐 /static/vendor/jszip.min.js、docx-preview.min.js、docx-preview.css"
        : "Word 预览组件加载失败";
      setPreviewPlaceholder(elId, msg);
      appendLog(msg);
      return;
    }
    el.innerHTML = '<div id="docx_mount" style="padding:8px;"></div>';
    try {
      await window.docx.renderAsync(arrayBuffer, el.firstElementChild, undefined, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
      });
    } catch (error) {
      setPreviewPlaceholder(elId, `Word 渲染失败：${error.message || "unknown"}`);
    }
  }

  return {
    ensureDocxLib,
    renderDocx,
  };
}
