export function createPreviewZoomBindings(deps = {}) {
  const { $ } = deps;
  const PREVIEW_ZOOM_IDS = ["sourcePreview", "targetPreview"];
  const PREVIEW_ZOOM_OPTIONS = ["50", "75", "100", "125", "150", "175", "200"];
  const previewZoomStates = new Map();

  function clampPreviewZoomPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(200, Math.round(n)));
  }

  function getPreviewZoomState(previewId) {
    const key = String(previewId || "");
    if (!previewZoomStates.has(key)) {
      previewZoomStates.set(key, { mode: "manual", percent: 100, timer: 0, observer: null });
    }
    return previewZoomStates.get(key);
  }

  function ensurePreviewZoomOverlay(previewId) {
    const root = $(previewId);
    if (!(root instanceof HTMLElement)) return null;
    const getOverlayHost = () => {
      if (previewId === "sourcePreview") {
        const host = $("sourcePreviewPanel");
        if (host instanceof HTMLElement) return host;
      }
      if (previewId === "targetPreview") {
        const host = $("rightPreviewPanel");
        if (host instanceof HTMLElement) return host;
      }
      return root;
    };
    const host = getOverlayHost();
    let overlay = document.querySelector(`.preview-zoom-overlay[data-preview-id="${previewId}"]`);
    if (overlay instanceof HTMLElement && overlay.parentElement !== host) {
      host.appendChild(overlay);
    }
    if (!(overlay instanceof HTMLElement)) {
      overlay = document.createElement("div");
      overlay.className = "preview-zoom-overlay in-preview";
      overlay.setAttribute("data-preview-id", previewId);
      overlay.innerHTML = [
        `<button type="button" data-preview-zoom-action="out" data-preview-id="${previewId}" title="缩小" aria-label="缩小"><i class="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i></button>`,
        `<select data-preview-zoom-action="select" data-preview-id="${previewId}">${PREVIEW_ZOOM_OPTIONS.map((x) => `<option value="${x}">${x}%</option>`).join("")}</select>`,
        `<button type="button" data-preview-zoom-action="in" data-preview-id="${previewId}" title="放大" aria-label="放大"><i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i></button>`,
        `<button type="button" data-preview-zoom-action="fit" data-preview-id="${previewId}" title="适应页宽" aria-label="适应页宽"><i class="fa-solid fa-left-right" aria-hidden="true"></i></button>`,
      ].join("");
      host.appendChild(overlay);
    } else {
      overlay.classList.remove("in-toolbar");
      overlay.classList.add("in-preview");
    }
    if (overlay.getAttribute("data-bound") !== "1") {
      overlay.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const actionEl = target.closest("[data-preview-zoom-action]");
        if (!(actionEl instanceof HTMLElement)) return;
        const action = String(actionEl.getAttribute("data-preview-zoom-action") || "");
        const stateObj = getPreviewZoomState(previewId);
        if (action === "out") {
          stateObj.mode = "manual";
          stateObj.percent = clampPreviewZoomPercent(stateObj.percent - 25);
          applyPreviewZoom(previewId);
        } else if (action === "in") {
          stateObj.mode = "manual";
          stateObj.percent = clampPreviewZoomPercent(stateObj.percent + 25);
          applyPreviewZoom(previewId);
        } else if (action === "fit") {
          stateObj.mode = stateObj.mode === "fit_width" ? "manual" : "fit_width";
          applyPreviewZoom(previewId);
        }
      });
      const select = overlay.querySelector(`select[data-preview-zoom-action="select"][data-preview-id="${previewId}"]`);
      if (select instanceof HTMLSelectElement) {
        select.addEventListener("change", () => {
          const stateObj = getPreviewZoomState(previewId);
          stateObj.mode = "manual";
          stateObj.percent = clampPreviewZoomPercent(select.value);
          applyPreviewZoom(previewId);
        });
      }
      overlay.setAttribute("data-bound", "1");
    }
    return overlay;
  }

  function syncPreviewZoomUi(previewId) {
    const stateObj = getPreviewZoomState(previewId);
    const overlay = ensurePreviewZoomOverlay(previewId);
    if (!(overlay instanceof HTMLElement)) return;
    const select = overlay.querySelector(`select[data-preview-zoom-action="select"][data-preview-id="${previewId}"]`);
    const fitBtn = overlay.querySelector(`button[data-preview-zoom-action="fit"][data-preview-id="${previewId}"]`);
    if (select instanceof HTMLSelectElement) {
      const value = String(clampPreviewZoomPercent(stateObj.percent));
      const dynamicOption = select.querySelector('option[data-dynamic="1"]');
      if (dynamicOption) dynamicOption.remove();
      const hasExact = Array.from(select.options).some((opt) => String(opt.value) === value);
      if (!hasExact) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value}%`;
        option.setAttribute("data-dynamic", "1");
        select.insertBefore(option, select.firstChild);
      }
      if (select.value !== value) select.value = value;
    }
    if (fitBtn instanceof HTMLButtonElement) fitBtn.classList.toggle("is-active", stateObj.mode === "fit_width");
  }

  function getPreviewContentElement(previewId) {
    const root = $(previewId);
    if (!(root instanceof HTMLElement)) return null;
    const children = Array.from(root.children).filter((node) => !(node instanceof HTMLElement && node.classList.contains("preview-zoom-overlay")));
    const el = children[0];
    return el instanceof HTMLElement ? el : null;
  }

  function measurePreviewContentWidth(root, contentEl) {
    if (!(root instanceof HTMLElement) || !(contentEl instanceof HTMLElement)) return 0;
    const prevTransform = contentEl.style.transform;
    const prevWidth = contentEl.style.width;
    contentEl.style.transform = "";
    contentEl.style.width = "";
    const measured = Math.max(
      Number(contentEl.scrollWidth) || 0,
      Number(contentEl.clientWidth) || 0,
      Number(contentEl.getBoundingClientRect().width) || 0,
    );
    contentEl.style.transform = prevTransform;
    contentEl.style.width = prevWidth;
    return measured;
  }

  function calcFitWidthScale(previewId) {
    const root = $(previewId);
    const contentEl = getPreviewContentElement(previewId);
    if (!(root instanceof HTMLElement) || !(contentEl instanceof HTMLElement)) return 1;
    const contentWidth = measurePreviewContentWidth(root, contentEl);
    const viewportWidth = Math.max(0, (Number(root.clientWidth) || 0) - 16);
    if (!contentWidth || !viewportWidth) return 1;
    return Math.max(0.3, Math.min(3, viewportWidth / contentWidth));
  }

  function applyPreviewZoom(previewId) {
    const root = $(previewId);
    const contentEl = getPreviewContentElement(previewId);
    const stateObj = getPreviewZoomState(previewId);
    ensurePreviewZoomOverlay(previewId);
    if (!(root instanceof HTMLElement) || !(contentEl instanceof HTMLElement)) {
      syncPreviewZoomUi(previewId);
      return;
    }
    if (contentEl.classList.contains("placeholder")) {
      contentEl.style.transformOrigin = "";
      contentEl.style.transform = "";
      contentEl.style.width = "";
      contentEl.style.height = "";
      syncPreviewZoomUi(previewId);
      return;
    }
    const scale = stateObj.mode === "fit_width"
      ? calcFitWidthScale(previewId)
      : (clampPreviewZoomPercent(stateObj.percent) / 100);
    const isImage = contentEl.tagName === "IMG";
    contentEl.style.transformOrigin = "top left";
    contentEl.style.transform = `scale(${scale})`;
    if (isImage) {
      contentEl.style.width = "";
      contentEl.style.height = "";
    } else {
      contentEl.style.width = `${100 / scale}%`;
      if (contentEl.tagName === "IFRAME") contentEl.style.height = `${100 / scale}%`;
      else contentEl.style.height = "";
    }
    if (stateObj.mode === "fit_width") stateObj.percent = clampPreviewZoomPercent(Math.round(scale * 100));
    syncPreviewZoomUi(previewId);
  }

  function scheduleApplyPreviewZoom(previewId) {
    const stateObj = getPreviewZoomState(previewId);
    if (stateObj.timer) window.clearTimeout(stateObj.timer);
    stateObj.timer = window.setTimeout(() => {
      stateObj.timer = 0;
      applyPreviewZoom(previewId);
    }, 0);
  }

  function bindPreviewZoomOverlayFor(previewId) {
    const root = $(previewId);
    if (!(root instanceof HTMLElement)) return;
    ensurePreviewZoomOverlay(previewId);
    const stateObj = getPreviewZoomState(previewId);
    if (!stateObj.observer && typeof MutationObserver !== "undefined") {
      stateObj.observer = new MutationObserver(() => {
        scheduleApplyPreviewZoom(previewId);
      });
      stateObj.observer.observe(root, { childList: true });
    }
    applyPreviewZoom(previewId);
  }

  function bindPreviewZoomOverlayEvents() {
    PREVIEW_ZOOM_IDS.forEach((previewId) => {
      bindPreviewZoomOverlayFor(previewId);
    });
    window.addEventListener("resize", () => {
      PREVIEW_ZOOM_IDS.forEach((previewId) => {
        const stateObj = getPreviewZoomState(previewId);
        if (stateObj.mode === "fit_width") applyPreviewZoom(previewId);
      });
    });
  }

  return {
    bindPreviewZoomOverlayEvents,
  };
}

