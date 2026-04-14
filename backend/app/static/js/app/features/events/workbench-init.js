export function createWorkbenchInitBindings(deps = {}) {
  const {
    $,
    saveWorkspaceDraft,
    bindUploadEvents,
    bindQueueTableEvents,
    bindQueueLayoutAndDropEvents,
    bindViewModeEvents,
    bindPreviewZoomOverlayEvents,
    bindTargetFieldEvents,
    bindTemplateAndNavigationEvents,
    bindBatchAndFilterEvents,
  } = deps;

  function bindEvents() {
    const headerExitBtn = $("headerExitBtn");
    if (headerExitBtn) {
      headerExitBtn.addEventListener("click", async () => {
        if (typeof saveWorkspaceDraft === "function") await saveWorkspaceDraft();
        window.location.assign("/tasks");
      });
    }

    bindUploadEvents();

    const queueListEl = $("queueList");
    bindQueueTableEvents(queueListEl);
    bindQueueLayoutAndDropEvents(queueListEl);

    bindViewModeEvents();
    bindPreviewZoomOverlayEvents();
    bindTargetFieldEvents();

    bindTemplateAndNavigationEvents();

    bindBatchAndFilterEvents();
  }

  return { bindEvents };
}
