export function createBatchFilterBindings(deps = {}) {
  const {
    $,
    state,
    appendLog,
    clearPreprocessProgress,
    exportAll,
    generateAllReady,
    generateItem,
    getActiveItem,
    getGenerateMode,
    getSelectedNormalItems,
    refreshActiveRecognition,
    renderPreviews,
    renderQueue,
    renderTemplateSelect,
    runExcelBatch,
    setLoading,
    setPreviewFullscreen,
    setPreviewPlaceholder,
    setRightViewMode,
    setStatus,
    triggerDownload,
    authorizeDownloadWindow,
    updateTaskStatusApi,
    getBlockDownloadUntil,
    setBlockDownloadUntil,
    setDownloadPointerArmed,
    isDownloadPointerArmed,
  } = deps;

  function bindBatchAndFilterEvents() {
    $("runGenerateAllBtn").addEventListener("click", async () => {
      if (state.busy) {
        const reason = "当前仍在处理中，请稍后再试";
        setStatus(reason);
        appendLog(`批量生成被阻塞：${reason}`);
        return;
      }
      const selectedItems = getSelectedNormalItems();
      if (!selectedItems.length) {
        const reason = "请先勾选要批量生成的记录";
        setStatus(reason);
        appendLog(reason);
        return;
      }
      appendLog(`开始批量生成（选中 ${selectedItems.length} 条）`);
      const selected = selectedItems.map((x) => x.id);
      try {
        await generateAllReady(selected);
        await renderPreviews();
      } catch (error) {
        const reason = error && error.message ? error.message : "批量生成发生未知错误";
        setStatus(`批量生成失败：${reason}`);
        appendLog(`批量生成失败：${reason}`);
      }
    });

    $("refreshAllRecognitionBtn").addEventListener("click", async () => {
      if (state.busy) return;
      await refreshActiveRecognition();
    });

    const runBatchBtn = $("runBatchBtn");
    let runBatchPointerArmed = false;
    if (runBatchBtn) {
      runBatchBtn.addEventListener("pointerdown", () => {
        runBatchPointerArmed = true;
      });
      runBatchBtn.addEventListener("pointercancel", () => {
        runBatchPointerArmed = false;
      });
      runBatchBtn.addEventListener("pointerleave", () => {
        runBatchPointerArmed = false;
      });
      runBatchBtn.addEventListener("blur", () => {
        runBatchPointerArmed = false;
      });
      runBatchBtn.addEventListener("click", async (event) => {
        if (!event || !event.isTrusted) return;
        if (!runBatchPointerArmed) return;
        runBatchPointerArmed = false;
        if (Date.now() < getBlockDownloadUntil()) return;
        if (state.busy) return;
        const authToken = typeof authorizeDownloadWindow === "function" ? authorizeDownloadWindow(15000, true) : "";
        const selected = getSelectedNormalItems().map((x) => x.id);
        await exportAll(selected, authToken);
      });
    }

    const clearQueueBtn = $("clearQueueBtn");
    if (clearQueueBtn) {
      clearQueueBtn.addEventListener("click", () => {
        if (state.busy) return;
        state.queue = [];
        state.selectedIds.clear();
        state.activeId = "";
        setPreviewFullscreen(false);
        clearPreprocessProgress();
        state.excelPreviewSheetByFileId = {};
        renderQueue();
        renderTemplateSelect();
        setPreviewPlaceholder("sourcePreview", "来源预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        setStatus("队列已清空");
      });
    }

    $("generatePreviewBtn").addEventListener("click", async () => {
      const item = getActiveItem();
      if (!item || state.busy) return;
      const generateMode = getGenerateMode();
      const selectedItems = getSelectedNormalItems();
      const targets = selectedItems.length ? selectedItems : [item];
      if (!targets.length) return;
      try {
        if (targets.length > 1) {
          setLoading(
            true,
            generateMode === "source_file"
              ? `批量生成气瓶定期检验报告中：${targets.length} 条`
              : `批量生成原始记录中：${targets.length} 条`,
          );
        } else {
          setLoading(true, generateMode === "source_file" ? `生成气瓶定期检验报告中：${item.fileName}` : `生成原始记录中：${item.fileName}`);
        }
        let success = 0;
        let failed = 0;
        for (const targetItem of targets) {
          try {
            await generateItem(targetItem, generateMode);
            success += 1;
          } catch (error) {
            failed += 1;
            if (targetItem.status !== "incomplete") {
              targetItem.status = "error";
              targetItem.message = error && error.message ? error.message : "生成失败";
            }
            appendLog(`生成失败 ${targetItem.fileName}：${targetItem.message}`);
          }
        }
        renderQueue();
        await renderPreviews();
        setRightViewMode("preview");
        if (targets.length > 1) {
          setStatus(
            generateMode === "source_file"
              ? `批量生成气瓶定期检验报告完成：成功 ${success}，失败 ${failed}`
              : `批量生成原始记录完成：成功 ${success}，失败 ${failed}`,
          );
        } else if (failed === 0) {
          setStatus(generateMode === "source_file" ? `已生成气瓶定期检验报告：${item.fileName}` : `已生成原始记录：${item.fileName}`);
        } else {
          setStatus(`生成失败：${item.fileName}`);
        }
      } catch (error) {
        setStatus(`生成失败：${error && error.message ? error.message : "unknown"}`);
      } finally {
        setLoading(false);
      }
    });

    const downloadCurrentBtn = $("downloadCurrentBtn");
    // Guard against stale pointer/click state when entering or restoring the page.
    setDownloadPointerArmed(false);
    if (typeof setBlockDownloadUntil === "function") {
      setBlockDownloadUntil(Date.now() + 1200);
    }
    downloadCurrentBtn.addEventListener("pointerdown", () => {
      setDownloadPointerArmed(true);
    });
    downloadCurrentBtn.addEventListener("pointercancel", () => {
      setDownloadPointerArmed(false);
    });
    downloadCurrentBtn.addEventListener("pointerleave", () => {
      setDownloadPointerArmed(false);
    });
    downloadCurrentBtn.addEventListener("blur", () => {
      setDownloadPointerArmed(false);
    });
    downloadCurrentBtn.addEventListener("click", async (event) => {
      if (!event || !event.isTrusted) return;
      const item = getActiveItem();
      if (!isDownloadPointerArmed()) return;
      setDownloadPointerArmed(false);
      if (Date.now() < getBlockDownloadUntil()) return;
      if (!item || !item.reportDownloadUrl || state.busy) return;
      try {
        const authToken = typeof authorizeDownloadWindow === "function" ? authorizeDownloadWindow(15000, true) : "";
        setLoading(true, `导出中：${item.fileName}`);
        await triggerDownload(item.reportDownloadUrl, item.reportFileName || item.templateName || item.fileName || "report.docx", authToken);
        item.status = "generated";
        item.message = "已导出";
        const taskId = String((state.taskContext && state.taskContext.id) || "").trim();
        if (taskId && typeof updateTaskStatusApi === "function") {
          await updateTaskStatusApi(taskId, "已生成");
        }
        renderQueue();
        setStatus(`已导出：${item.fileName}`);
      } catch (error) {
        setStatus(`导出失败：${item.fileName}`);
      } finally {
        setLoading(false);
      }
    });

    const runExcelBatchBtn = $("runExcelBatchBtn");
    if (runExcelBatchBtn) {
      runExcelBatchBtn.addEventListener("click", async (event) => {
        if (!event || !event.isTrusted) return;
        const item = getActiveItem();
        if (!item || state.busy) return;
        try {
          const authToken = typeof authorizeDownloadWindow === "function" ? authorizeDownloadWindow(20000, true) : "";
          setLoading(true, `Excel批量中：${item.fileName}`);
          await runExcelBatch(item, authToken);
          setStatus(`Excel批量完成：${item.fileName}`);
        } catch (error) {
          item.status = "error";
          item.message = error.message || "Excel 批量失败";
          renderQueue();
          setStatus(`Excel批量失败：${item.fileName}`);
        } finally {
          setLoading(false);
        }
      });
    }

    $("filterKeyword").addEventListener("input", () => {
      state.listFilter.keyword = $("filterKeyword").value || "";
      renderQueue();
    });
    $("filterStatus").addEventListener("change", () => {
      state.listFilter.status = $("filterStatus").value || "";
      renderQueue();
    });
    $("sortKey").addEventListener("change", () => {
      state.listFilter.sortKey = $("sortKey").value || "";
      renderQueue();
    });
    $("sortDir").addEventListener("change", () => {
      state.listFilter.sortDir = $("sortDir").value || "asc";
      renderQueue();
    });
    $("toggleSelectModeBtn").addEventListener("click", () => {
      if (state.busy) return;
      state.multiSelectMode = !state.multiSelectMode;
      if (!state.multiSelectMode) {
        const keepId = state.activeId || Array.from(state.selectedIds)[0] || "";
        state.selectedIds.clear();
        if (keepId) state.selectedIds.add(keepId);
      }
      renderQueue();
    });
    $("removeSelectedBtn").addEventListener("click", async () => {
      if (state.busy) return;
      if (!state.selectedIds.size) return;
      const removeSet = new Set(state.selectedIds);
      const beforeCount = state.queue.length;
      state.queue = state.queue.filter((item) => !removeSet.has(item.id));
      const removedCount = beforeCount - state.queue.length;
      state.selectedIds.clear();
      if (!state.queue.length) {
        state.activeId = "";
        setPreviewPlaceholder("sourcePreview", "来源预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
      } else if (!state.queue.some((item) => item.id === state.activeId)) {
        state.activeId = state.queue[0].id;
        await renderPreviews();
      }
      renderQueue();
      renderTemplateSelect();
      setStatus(`已移除 ${removedCount} 条记录`);
      appendLog(`已移除选中记录：${removedCount} 条`);
    });
  }

  return { bindBatchAndFilterEvents };
}
