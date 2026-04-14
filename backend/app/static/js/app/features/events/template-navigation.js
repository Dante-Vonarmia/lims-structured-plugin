export function createTemplateNavigationBindings(deps = {}) {
  const {
    $,
    state,
    getActiveItem,
    resolveBlankTemplateName,
    ensureTemplateEditorSchema,
    maybeCopyGeneralCheckForBlankTemplate,
    validateItemForGeneration,
    applyIncompleteState,
    renderQueue,
    renderTargetFieldForm,
    renderTargetPreview,
    renderTemplateSelect,
    setPreviewFullscreen,
    navigateActiveItem,
    isTypingTarget,
  } = deps;

  function bindTemplateAndNavigationEvents() {
    let templateApplyTimer = null;
    const applyTemplateSelection = async ({ commit = false } = {}) => {
      const item = getActiveItem();
      if (!item) return;
      const raw = ($("templateSearch").value || "").trim();
      if (!raw) {
        if (!commit) return;
        $("templateName").value = "";
        item.templateName = "";
        item.templateUserSelected = false;
        item.reportId = "";
        item.reportDownloadUrl = "";
        item.reportFileName = "";
        item.reportGenerateMode = "";
        item.modeReports = {};
        item.status = "ready";
        item.message = "未选择模板";
        renderQueue();
        renderTargetFieldForm(item);
        await renderTargetPreview(item);
        return;
      }
      const selected = state.templates.includes(raw) ? raw : "";
      if (!selected) return;
      if (item.templateName === selected) return;
      $("templateName").value = selected;
      item.templateName = selected;
      item.templateUserSelected = true;
      ensureTemplateEditorSchema(item.templateName, item.id || "");
      maybeCopyGeneralCheckForBlankTemplate(item);
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      item.reportGenerateMode = "";
      item.modeReports = {};
      const validation = validateItemForGeneration(item, "certificate_template");
      if (!validation.ok) applyIncompleteState(item, validation);
      else {
        item.status = "ready";
        item.message = item.templateName ? "模板已手动选择" : "未选择模板";
      }
      renderQueue();
      renderTargetFieldForm(item);
      await renderTargetPreview(item);
    };
    $("templateSearch").addEventListener("change", () => { applyTemplateSelection({ commit: true }); });
    $("templateSearch").addEventListener("blur", () => { applyTemplateSelection({ commit: true }); });
    $("templateSearch").addEventListener("input", () => {
      if (templateApplyTimer) clearTimeout(templateApplyTimer);
      templateApplyTimer = setTimeout(() => {
        applyTemplateSelection();
        const item = getActiveItem();
        const blankBtn = $("useBlankTemplateBtn");
        if (blankBtn && item) {
          const raw = ($("templateSearch").value || "").trim();
          const hasExact = !!state.templates.includes(raw);
          const blankName = resolveBlankTemplateName();
          blankBtn.style.display = !hasExact && !!blankName ? "inline-block" : "none";
        }
      }, 360);
    });

    $("useBlankTemplateBtn").addEventListener("click", async () => {
      const item = getActiveItem();
      if (!item || state.busy) return;
      const blankName = resolveBlankTemplateName();
      if (!blankName) return;
      $("templateName").value = blankName;
      $("templateSearch").value = blankName;
      item.templateName = blankName;
      item.templateUserSelected = true;
      maybeCopyGeneralCheckForBlankTemplate(item);
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      item.reportGenerateMode = "";
      item.modeReports = {};
      const validation = validateItemForGeneration(item, "certificate_template");
      if (!validation.ok) applyIncompleteState(item, validation);
      else {
        item.status = "ready";
        item.message = "已选择空白模板";
      }
      renderQueue();
      renderTemplateSelect();
      renderTargetFieldForm(item);
      await renderTargetPreview(item);
    });

    $("togglePreviewFullscreenBtn").addEventListener("click", () => {
      if (!getActiveItem()) return;
      setPreviewFullscreen(!state.previewFullscreen);
    });
    $("prevItemBtn").addEventListener("click", async () => {
      if (state.busy) return;
      await navigateActiveItem(-1);
    });
    $("nextItemBtn").addEventListener("click", async () => {
      if (state.busy) return;
      await navigateActiveItem(1);
    });
    $("detailPanelHead").addEventListener("dblclick", () => {
      if (!getActiveItem()) return;
      setPreviewFullscreen(!state.previewFullscreen);
    });

    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "Escape" && state.previewFullscreen) {
        setPreviewFullscreen(false);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
        event.preventDefault();
        navigateActiveItem(-1);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
        event.preventDefault();
        navigateActiveItem(1);
      }
    });
  }

  return { bindTemplateAndNavigationEvents };
}
