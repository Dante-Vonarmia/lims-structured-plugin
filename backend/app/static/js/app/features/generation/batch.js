export function createGenerationBatchFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    processItem,
    applyAutoTemplateMatch,
    validateItemForGeneration,
    applyIncompleteState,
    generateItem,
    renderQueue,
    renderTemplateSelect,
    setLoading,
    setStatus,
    appendLog,
    fetchJson,
    uploadFile,
  } = deps;

  async function generateAllReady(targetIds = null) {
    const hasExplicitSelection = Array.isArray(targetIds);
    const selectedSet = hasExplicitSelection ? new Set(targetIds.filter(Boolean)) : null;
    if (hasExplicitSelection && !selectedSet.size) {
      const reason = "请先勾选要批量生成的记录";
      setStatus(reason);
      appendLog(reason);
      return { generated: 0, skipped: 0, failed: 0, total: 0 };
    }
    const targets = state.queue.filter((x) => {
      if (isExcelItem(x)) return false;
      if (selectedSet && !selectedSet.has(x.id)) return false;
      return true;
    });
    if (!targets.length) {
      const reason = hasExplicitSelection ? "所选记录均不可批量生成（可能全是 Excel 记录）" : "没有可生成项";
      setStatus(reason);
      appendLog(reason);
      return { generated: 0, skipped: 0, failed: 0, total: 0 };
    }
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of targets) {
      state.activeId = item.id;
      renderQueue();
      renderTemplateSelect();
      try {
        if (item.status === "pending") {
          setLoading(true, `预处理中：${item.fileName}`);
          await processItem(item);
          setLoading(false);
        }
        if (!item.templateName) {
          await applyAutoTemplateMatch(item, { force: true });
        }
        const validation = validateItemForGeneration(item, "certificate_template");
        if (!validation.ok) {
          applyIncompleteState(item, validation);
          appendLog(`跳过（待补全） ${item.fileName}：${item.message || "字段未满足生成条件"}`);
          skipped += 1;
          continue;
        }
        setLoading(true, `生成中：${item.fileName}`);
        await generateItem(item);
        appendLog(`生成完成：${item.fileName}`);
        generated += 1;
      } catch (error) {
        item.status = "error";
        item.message = error.message || "生成失败";
        renderQueue();
        appendLog(`生成失败 ${item.fileName}：${item.message}`);
        failed += 1;
      } finally {
        setLoading(false);
      }
    }
    const targetIdSet = new Set(targets.map((x) => x.id));
    for (const id of Array.from(state.selectedIds)) {
      if (!targetIdSet.has(id)) continue;
      const current = state.queue.find((x) => x.id === id);
      if (!current || current.status !== "generated") state.selectedIds.delete(id);
    }
    renderQueue();
    const summary = `批量生成完成：成功${generated}，跳过${skipped}，失败${failed}`;
    setStatus(summary);
    appendLog(summary);
    return { generated, skipped, failed, total: targets.length };
  }

  async function triggerDownload(url, name) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("下载失败");
    const blob = await res.blob();
    if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name || "report.docx",
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        if (error && error.name === "AbortError") throw new Error("已取消导出");
      }
    }
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name || "report.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  async function exportAll(targetIds = null) {
    const selectedSet = targetIds && targetIds.length ? new Set(targetIds) : null;
    const targets = state.queue.filter((x) => {
      if (isExcelItem(x)) return false;
      if (selectedSet && !selectedSet.has(x.id)) return false;
      return !!x.reportDownloadUrl;
    });
    if (!targets.length) {
      setStatus("没有可导出项");
      return;
    }
    for (const item of targets) {
      try {
        setLoading(true, `导出中：${item.fileName}`);
        await triggerDownload(item.reportDownloadUrl, item.reportFileName || item.templateName || item.fileName || "report.docx");
        item.status = "generated";
        item.message = "已导出";
        renderQueue();
      } catch (error) {
        appendLog(`导出失败 ${item.fileName}：${error.message || "unknown"}`);
      } finally {
        setLoading(false);
      }
    }
    setStatus("批量导出完成");
  }

  async function runExcelBatch(item) {
    if (!item || !isExcelItem(item)) throw new Error("请先选择 Excel 文件");
    if (!item.fileId) {
      const up = await uploadFile(item.file);
      item.fileId = up.file_id;
    }
    const data = await fetchJson("/api/report/batch-from-excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: item.fileId,
        sheet_name: null,
        default_template_name: item.templateName || null,
      }),
    });
    await triggerDownload(data.download_url, `${item.fileName.replace(/\.xlsx$/i, "") || "excel_batch"}.zip`);
    item.status = "generated";
    item.message = `Excel批量：生成${data.generated_count} 跳过${data.skipped_count}`;
    renderQueue();
    appendLog(`Excel批量完成 ${item.fileName}：生成${data.generated_count} 跳过${data.skipped_count}`);
  }

  return {
    generateAllReady,
    triggerDownload,
    exportAll,
    runExcelBatch,
  };
}
