export function createQueueTableBindings(deps = {}) {
  const {
    $,
    state,
    FILTER_BLANK_TOKEN,
    getColumnFilterOptionEntries,
    getFilteredSortedQueue,
    getActiveItem,
    renderQueue,
    renderTemplateSelect,
    renderPreviews,
    renderSourceFieldList,
    renderSourcePreview,
    renderTargetPreview,
    updateSelectedCountText,
    refreshActionButtons,
    refreshTargetFieldFormBySelection,
    updateSourceDeviceNameText,
    setBlockDownloadUntil,
  } = deps;

  function bindQueueTableEvents(queueListEl) {
    const handleFilterActionClick = (target) => {
      const filterActBtn = target.closest(".th-filter-act");
      if (!(filterActBtn instanceof HTMLElement)) return false;
      const key = filterActBtn.getAttribute("data-filter-key") || "";
      const act = filterActBtn.getAttribute("data-filter-act") || "";
      if (!key || !act) return true;
      const options = getColumnFilterOptionEntries(key);
      const allTokens = options.map((x) => x.token);
      let next = [];
      if (act === "all") next = allTokens;
      if (act === "clear") next = [];
      if (act === "only_blank") next = allTokens.includes(FILTER_BLANK_TOKEN) ? [FILTER_BLANK_TOKEN] : [];
      if (act === "only_non_blank") next = allTokens.filter((x) => x !== FILTER_BLANK_TOKEN);
      const nextFilters = { ...(state.listFilter.columnFilters || {}) };
      if (next.length) nextFilters[key] = next;
      else delete nextFilters[key];
      state.listFilter.columnFilters = nextFilters;
      state.listFilter.activeFilterKey = key;
      renderQueue();
      return true;
    };
    const handleFilterOptionChange = (target) => {
      if (!(target instanceof HTMLElement) || !target.matches(".th-filter-option")) return false;
      const key = target.getAttribute("data-filter-key") || "";
      const token = target.getAttribute("data-filter-token") || "";
      if (!key || !token) return true;
      const current = Array.isArray((state.listFilter.columnFilters || {})[key])
        ? (state.listFilter.columnFilters || {})[key].map((x) => String(x || "")).filter(Boolean)
        : [];
      const nextSet = new Set(current);
      if (target.checked) nextSet.add(token);
      else nextSet.delete(token);
      const next = Array.from(nextSet);
      const nextFilters = { ...(state.listFilter.columnFilters || {}) };
      if (next.length) nextFilters[key] = next;
      else delete nextFilters[key];
      state.listFilter.columnFilters = nextFilters;
      state.listFilter.activeFilterKey = key;
      renderQueue();
      return true;
    };
    queueListEl.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const sortBtn = target.closest(".th-sort-btn");
      if (sortBtn instanceof HTMLElement) {
        const key = sortBtn.getAttribute("data-sort-key") || "";
        if (!key) return;
        if (state.listFilter.sortKey === key) {
          state.listFilter.sortDir = state.listFilter.sortDir === "desc" ? "asc" : "desc";
        } else {
          state.listFilter.sortKey = key;
          state.listFilter.sortDir = "asc";
        }
        $("sortKey").value = state.listFilter.sortKey;
        $("sortDir").value = state.listFilter.sortDir;
        renderQueue();
        return;
      }
      const filterTrigger = target.closest(".th-filter-trigger");
      if (filterTrigger instanceof HTMLElement) {
        const key = filterTrigger.getAttribute("data-filter-key") || "";
        if (!key) return;
        if (state.listFilter.activeFilterKey === key) {
          state.listFilter.activeFilterKey = "";
          state.listFilter.filterAnchor = null;
        } else {
          const rect = filterTrigger.getBoundingClientRect();
          state.listFilter.activeFilterKey = key;
          state.listFilter.filterAnchor = {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        }
        renderQueue();
        return;
      }
      if (handleFilterActionClick(target)) return;
      if (target.closest(".th-filter-menu") || target.closest(".th-filter-option")) return;
      if (target.closest(".row-check") || target.closest("#selectAllVisible")) return;
      const row = target.closest("tr[data-id]");
      if (!row) return;
      const id = row.getAttribute("data-id") || "";
      if (!id) return;
      if (state.multiSelectMode) {
        if (state.selectedIds.has(id)) state.selectedIds.delete(id);
        else state.selectedIds.add(id);
      } else {
        state.selectedIds.clear();
        state.selectedIds.add(id);
      }
      updateSelectedCountText();
      refreshTargetFieldFormBySelection();
      state.listFilter.activeFilterKey = "";
      state.listFilter.filterAnchor = null;
      state.activeId = id;
      setBlockDownloadUntil(Date.now() + 450);
      renderQueue();
      renderTemplateSelect();
      await renderPreviews();
    });

    queueListEl.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (handleFilterOptionChange(target)) return;
      if (target.matches(".row-check")) {
        const id = target.getAttribute("data-id") || "";
        if (!id) return;
        if (state.multiSelectMode) {
          if (target.checked) state.selectedIds.add(id);
          else state.selectedIds.delete(id);
        } else if (target.checked) {
          state.selectedIds.clear();
          state.selectedIds.add(id);
        } else {
          state.selectedIds.delete(id);
        }
        if (target.checked) {
          state.activeId = id;
        } else if (state.activeId === id) {
          const nextSelected = Array.from(state.selectedIds)[0] || "";
          state.activeId = nextSelected;
        }
        updateSelectedCountText();
        refreshActionButtons();
        refreshTargetFieldFormBySelection();
        renderSourceFieldList(getActiveItem());
        renderSourcePreview(getActiveItem());
        renderTargetPreview(getActiveItem());
        updateSourceDeviceNameText(getActiveItem());
        return;
      }
      if (target.matches("#selectAllVisible")) {
        const visibleItems = getFilteredSortedQueue();
        visibleItems.forEach((item) => {
          if (target.checked) state.selectedIds.add(item.id);
          else state.selectedIds.delete(item.id);
        });
        if (target.checked) {
          const firstVisible = visibleItems[0];
          if (firstVisible && firstVisible.id) state.activeId = firstVisible.id;
        } else if (state.activeId && !state.selectedIds.has(state.activeId)) {
          state.activeId = "";
        }
        renderQueue();
        refreshTargetFieldFormBySelection();
        renderSourceFieldList(getActiveItem());
        renderSourcePreview(getActiveItem());
        renderTargetPreview(getActiveItem());
        updateSourceDeviceNameText(getActiveItem());
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (handleFilterActionClick(target)) return;
      if (!state.listFilter.activeFilterKey) return;
      if (target.closest(".th-filter-trigger") || target.closest(".th-filter-menu") || target.closest(".queue-filter-popover")) return;
      state.listFilter.activeFilterKey = "";
      state.listFilter.filterAnchor = null;
      renderQueue();
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      handleFilterOptionChange(target);
    });
  }

  return { bindQueueTableEvents };
}
