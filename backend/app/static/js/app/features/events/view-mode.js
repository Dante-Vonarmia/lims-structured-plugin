export function createViewModeBindings(deps = {}) {
  const {
    $,
    state,
    getActiveItem,
    renderSourceFieldList,
    setSourceViewMode,
    setRightViewMode,
    renderSourcePreview,
  } = deps;

  function bindViewModeEvents() {
    const sourceViewPreviewBtn = $("sourceViewPreviewBtn");
    if (sourceViewPreviewBtn) {
      sourceViewPreviewBtn.addEventListener("click", () => {
        if (!getActiveItem()) return;
        setSourceViewMode("preview");
      });
    }

    const sourceViewFormBtn = $("sourceViewFormBtn");
    if (sourceViewFormBtn) {
      sourceViewFormBtn.addEventListener("click", () => {
        if (!getActiveItem()) return;
        setSourceViewMode("fields");
      });
    }

    const sourceFieldListEl = $("sourceFieldList");
    if (sourceFieldListEl) {
      sourceFieldListEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleBtn = target.closest("[data-group-toggle]");
        if (!(toggleBtn instanceof HTMLElement)) return;
        const groupKey = String(toggleBtn.getAttribute("data-group-key") || "").trim();
        if (!groupKey) return;
        state.sourceFieldGroupCollapsed[groupKey] = !state.sourceFieldGroupCollapsed[groupKey];
        renderSourceFieldList(getActiveItem());
      });
    }

    const rightTabFieldBtn = $("rightTabFieldBtn");
    if (rightTabFieldBtn) {
      rightTabFieldBtn.addEventListener("click", () => {
        if (!getActiveItem()) return;
        setRightViewMode("field");
      });
    }

    const rightTabPreviewBtn = $("rightTabPreviewBtn");
    if (rightTabPreviewBtn) {
      rightTabPreviewBtn.addEventListener("click", () => {
        if (!getActiveItem()) return;
        setRightViewMode("preview");
      });
    }

    $("sourcePreview").addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches("#excelPreviewSheetSelect")) return;
      const item = getActiveItem();
      if (!item) return;
      const sheetName = String((target instanceof HTMLSelectElement ? target.value : "") || "").trim();
      const fileKey = String(item.fileId || item.fileName || "");
      if (fileKey) state.excelPreviewSheetByFileId[fileKey] = sheetName;
      await renderSourcePreview(item);
    });
  }

  return { bindViewModeEvents };
}
