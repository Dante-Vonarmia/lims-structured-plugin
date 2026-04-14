export function createRecognitionBatchFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    isExcelExt,
    extFromName,
    processItem,
    setStatus,
    setLoading,
    setPreprocessProgress,
    clearPreprocessProgress,
    renderQueue,
    renderTemplateSelect,
    appendLog,
    runExcelInspect,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    createEmptyFields,
    runExtract,
    resolveSourceCode,
    inferCategory,
  } = deps;

  async function processAllPending() {
    const targets = state.queue.filter((x) => x.status === "pending");
    if (!targets.length) {
      setStatus("没有待识别项");
      return;
    }
    setLoading(true, "预处理中...");
    setPreprocessProgress(0, targets.length, "");
    let done = 0;
    for (const item of targets) {
      state.activeId = item.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, targets.length, item.fileName);
        await processItem(item);
      } catch (error) {
        item.status = "error";
        item.message = error.message || "处理失败";
        renderQueue();
        appendLog(`处理失败 ${item.fileName}：${item.message}`);
      }
      done += 1;
      setPreprocessProgress(done, targets.length, item.fileName);
    }
    clearPreprocessProgress();
    setLoading(false);
    setStatus("识别完成");
  }

  async function refreshAllRecognition() {
    const groupedExcelRecordRows = new Map();
    const normalTargets = [];
    for (const item of state.queue) {
      if (!item) continue;
      if (item.status === "generated" || item.status === "confirmed") continue;
      const isExcelRecordRow = !!(item.isRecordRow && isExcelExt(extFromName(item.fileName)) && item.fileId);
      if (isExcelRecordRow) {
        const key = item.fileId || item.sourceFileName || item.fileName || item.id;
        const group = groupedExcelRecordRows.get(key) || [];
        group.push(item);
        groupedExcelRecordRows.set(key, group);
        continue;
      }
      if (!isExcelItem(item)) normalTargets.push(item);
    }

    const excelGroups = Array.from(groupedExcelRecordRows.values());
    const totalTargets = excelGroups.length + normalTargets.length;
    if (!totalTargets) {
      setStatus("没有可刷新的识别项");
      return;
    }
    setLoading(true, "刷新识别中...");
    setPreprocessProgress(0, totalTargets, "", "刷新识别");
    let done = 0;

    for (const group of excelGroups) {
      const sample = group[0];
      if (!sample) continue;
      state.activeId = sample.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别");
        const inspect = await runExcelInspect(sample.fileId, "");
        const sourceItem = {
          ...sample,
          id: `${sample.id}-refresh-${Math.random().toString(16).slice(2, 8)}`,
          isRecordRow: false,
        };
        const refreshedRows = buildExcelRecordItems(sourceItem, inspect);
        for (const row of refreshedRows) {
          if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
        }
        const oldIds = new Set(group.map((x) => x.id));
        const indexes = [];
        state.queue.forEach((x, idx) => {
          if (oldIds.has(x.id)) indexes.push(idx);
        });
        if (indexes.length) {
          const start = indexes[0];
          for (let i = indexes.length - 1; i >= 0; i -= 1) {
            state.queue.splice(indexes[i], 1);
          }
          state.queue.splice(start, 0, ...refreshedRows);
          if (refreshedRows.length) state.activeId = refreshedRows[0].id;
        }
        appendLog(`Excel记录刷新完成 ${sample.fileName}：${refreshedRows.length} 条`);
        renderQueue();
        renderTemplateSelect();
      } catch (error) {
        for (const row of group) {
          row.status = "error";
          row.message = error.message || "刷新失败";
        }
        renderQueue();
        appendLog(`刷新失败 ${sample.fileName}：${error.message || "unknown"}`);
      }
      done += 1;
      setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别");
    }

    for (const item of normalTargets) {
      state.activeId = item.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别");
        if (item.status === "pending") {
          await processItem(item);
        } else {
          item.status = "processing";
          item.message = "字段重识别中";
          item.reportId = "";
          item.reportDownloadUrl = "";
          item.reportFileName = "";
          item.reportGenerateMode = "";
          item.modeReports = {};
          renderQueue();

          const rawText = String(item.rawText || (item.fields && item.fields.raw_record) || "");
          if (rawText) {
            item.rawText = rawText;
            const fields = await runExtract(rawText);
            item.fields = { ...createEmptyFields(), ...(item.fields || {}), ...fields, raw_record: rawText };
            item.recognizedFields = { ...item.fields };
          } else {
            item.fields = { ...createEmptyFields(), ...(item.fields || {}) };
            item.recognizedFields = { ...item.fields };
          }
          item.sourceCode = resolveSourceCode(item);
          item.category = inferCategory(item);
          item.templateName = "";
          item.matchedBy = "";
          item.templateUserSelected = false;
          await applyAutoTemplateMatch(item, { force: true });
        }
      } catch (error) {
        item.status = "error";
        item.message = error.message || "刷新失败";
        renderQueue();
        appendLog(`刷新失败 ${item.fileName}：${item.message}`);
      }
      done += 1;
      setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别");
    }
    clearPreprocessProgress();
    setLoading(false);
    setStatus(`刷新识别完成（${done}/${totalTargets}）`);
    appendLog(`刷新识别完成：${done}/${totalTargets}`);
    renderQueue();
    renderTemplateSelect();
  }

  async function refreshActiveRecognition() {
    const activeItem = state.queue.find((x) => x && x.id === state.activeId);
    if (!activeItem) {
      setStatus("当前没有可刷新的预览项");
      return;
    }
    if (activeItem.status === "generated" || activeItem.status === "confirmed") {
      setStatus("当前项不可刷新识别");
      return;
    }

    const forcedMode = String(activeItem && activeItem.recognitionOverride ? activeItem.recognitionOverride : "").trim().toLowerCase();
    const forceAsExcel = forcedMode === "excel";
    const isExcelRecordRow = !!(
      activeItem.isRecordRow
      && activeItem.fileId
      && isExcelExt(extFromName(activeItem.fileName))
    );
    setLoading(true, "刷新识别中...");
    setPreprocessProgress(0, 1, activeItem.fileName, "刷新识别");

    try {
      if (isExcelRecordRow) {
        const groupKey = activeItem.fileId || activeItem.sourceFileName || activeItem.fileName || activeItem.id;
        const group = state.queue.filter((item) => {
          if (!item || !item.isRecordRow || !item.fileId) return false;
          const key = item.fileId || item.sourceFileName || item.fileName || item.id;
          return key === groupKey;
        });
        const sample = group[0] || activeItem;
        const inspect = await runExcelInspect(sample.fileId, "");
        const sourceItem = {
          ...sample,
          id: `${sample.id}-refresh-${Math.random().toString(16).slice(2, 8)}`,
          isRecordRow: false,
        };
        const refreshedRows = buildExcelRecordItems(sourceItem, inspect);
        for (const row of refreshedRows) {
          if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
        }
        const oldIds = new Set(group.map((x) => x.id));
        const indexes = [];
        state.queue.forEach((x, idx) => {
          if (oldIds.has(x.id)) indexes.push(idx);
        });
        if (indexes.length) {
          const start = indexes[0];
          for (let i = indexes.length - 1; i >= 0; i -= 1) {
            state.queue.splice(indexes[i], 1);
          }
          state.queue.splice(start, 0, ...refreshedRows);
          if (refreshedRows.length) state.activeId = refreshedRows[0].id;
        }
        appendLog(`当前项Excel记录刷新完成 ${sample.fileName}：${refreshedRows.length} 条`);
      } else if (activeItem.status === "pending" || (!activeItem.isRecordRow && (forceAsExcel || forcedMode === "word"))) {
        await processItem(activeItem);
      } else {
        activeItem.status = "processing";
        activeItem.message = "字段重识别中";
        activeItem.reportId = "";
        activeItem.reportDownloadUrl = "";
        activeItem.reportFileName = "";
        activeItem.reportGenerateMode = "";
        activeItem.modeReports = {};
        renderQueue();

        const rawText = String(activeItem.rawText || (activeItem.fields && activeItem.fields.raw_record) || "");
        if (rawText) {
          activeItem.rawText = rawText;
          const fields = await runExtract(rawText);
          activeItem.fields = { ...createEmptyFields(), ...(activeItem.fields || {}), ...fields, raw_record: rawText };
          activeItem.recognizedFields = { ...activeItem.fields };
        } else {
          activeItem.fields = { ...createEmptyFields(), ...(activeItem.fields || {}) };
          activeItem.recognizedFields = { ...activeItem.fields };
        }
        activeItem.sourceCode = resolveSourceCode(activeItem);
        activeItem.category = inferCategory(activeItem);
        activeItem.templateName = "";
        activeItem.matchedBy = "";
        activeItem.templateUserSelected = false;
        await applyAutoTemplateMatch(activeItem, { force: true });
      }
      setPreprocessProgress(1, 1, activeItem.fileName, "刷新识别");
      setStatus("当前预览项刷新识别完成");
      appendLog(`当前预览项刷新识别完成：${activeItem.fileName}`);
    } catch (error) {
      activeItem.status = "error";
      activeItem.message = error.message || "刷新失败";
      appendLog(`当前预览项刷新失败 ${activeItem.fileName}：${activeItem.message}`);
      setStatus(`刷新识别失败：${activeItem.message}`);
    } finally {
      clearPreprocessProgress();
      setLoading(false);
      renderQueue();
      renderTemplateSelect();
    }
  }

  return { processAllPending, refreshAllRecognition, refreshActiveRecognition };
}
