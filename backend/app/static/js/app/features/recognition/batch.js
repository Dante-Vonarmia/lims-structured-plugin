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
  let processAllPendingRunning = false;
  let processAllPendingQueued = false;

  function buildRecordGroupKey(item) {
    if (!item || !item.isRecordRow) return "";
    const fid = String(item.fileId || "").trim();
    const src = String(item.sourceFileName || item.fileName || "").trim();
    return `${fid}::${src}`;
  }

  function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function resolvePhaseDisplay(event = {}) {
    const phase = String((event && event.phase) || "").trim();
    const rawMessage = String((event && event.message) || "").trim();
    const phaseMap = {
      init: { index: 1, name: "上传" },
      route: { index: 1, name: "上传" },
      upload: { index: 1, name: "上传" },
      ocr: { index: 2, name: "OCR识别" },
      excel: { index: 3, name: "结构化解析" },
      inspect: { index: 3, name: "结构化解析" },
      parse: { index: 3, name: "结构化解析" },
      match: { index: 4, name: "模板匹配" },
      done: { index: 4, name: "模板匹配" },
    };
    const resolved = phaseMap[phase] || { index: 3, name: "结构化解析" };
    const detail = rawMessage ? `阶段${resolved.index}/4：${resolved.name} · ${rawMessage}` : `阶段${resolved.index}/4：${resolved.name}`;
    return {
      detail,
      stageIndex: resolved.index,
    };
  }

  function buildProgressReporter({ done, total, fileName, label }) {
    return (event = {}) => {
      const { detail } = resolvePhaseDisplay(event);
      const progress = Number(event.progress) || 0;
      const stagePercent = clampPercent(progress);
      const current = done + (stagePercent / 100);
      setPreprocessProgress(current, total, fileName, label, detail);
    };
  }

  async function refreshRecordRowGroup(group, logPrefix = "记录刷新完成") {
    const safeGroup = Array.isArray(group) ? group.filter(Boolean) : [];
    if (!safeGroup.length) return;
    const sample = safeGroup[0];
    const oldIds = new Set(safeGroup.map((x) => x.id));
    const indexes = [];
    state.queue.forEach((x, idx) => {
      if (oldIds.has(x.id)) indexes.push(idx);
    });
    if (!indexes.length) return;

    const sourceItem = {
      ...sample,
      id: `${sample.id}-refresh-${Math.random().toString(16).slice(2, 8)}`,
      isRecordRow: false,
      status: "pending",
      message: "刷新识别中",
      templateName: "",
      matchedBy: "",
      templateUserSelected: false,
      reportId: "",
      reportDownloadUrl: "",
      reportFileName: "",
      reportGenerateMode: "",
      modeReports: {},
    };

    const start = indexes[0];
    for (let i = indexes.length - 1; i >= 0; i -= 1) {
      state.queue.splice(indexes[i], 1);
    }
    state.queue.splice(start, 0, sourceItem);
    state.activeId = sourceItem.id;
    renderQueue();
    renderTemplateSelect();

    await processItem(sourceItem);
    appendLog(`${logPrefix} ${sample.fileName}`);
  }

  async function processAllPending() {
    if (processAllPendingRunning) {
      processAllPendingQueued = true;
      return;
    }
    processAllPendingRunning = true;
    if (!state.queue.some((x) => x.status === "pending")) {
      setStatus("没有待识别项");
      processAllPendingRunning = false;
      return;
    }
    setLoading(true, "预处理中...");
    let done = 0;
    try {
      while (true) {
        const targets = state.queue.filter((x) => x.status === "pending");
        const total = done + targets.length;
        if (!targets.length) break;
        setPreprocessProgress(done, total, "", "预处理", "阶段1/4：上传 · 准备识别");
        for (const item of targets) {
          state.activeId = item.id;
          renderQueue();
          renderTemplateSelect();
          try {
            setPreprocessProgress(done, total, item.fileName, "预处理", "阶段1/4：上传 · 准备识别");
            const reportProgress = buildProgressReporter({
              done,
              total,
              fileName: item.fileName,
              label: "预处理",
            });
            await processItem(item, {
              onProgress: (event) => reportProgress(event || {}),
            });
          } catch (error) {
            item.status = "error";
            item.message = error.message || "处理失败";
            renderQueue();
            appendLog(`处理失败 ${item.fileName}：${item.message}`);
          }
          done += 1;
          setPreprocessProgress(done, total, item.fileName, "预处理", "阶段4/4：模板匹配 · 识别完成");
        }
      }
      setStatus("识别完成");
    } finally {
      clearPreprocessProgress();
      setLoading(false);
      processAllPendingRunning = false;
      if (processAllPendingQueued) {
        processAllPendingQueued = false;
        queueMicrotask(() => {
          void processAllPending();
        });
      }
    }
  }

  async function refreshAllRecognition() {
    const groupedExcelRecordRows = new Map();
    const groupedRecordRows = new Map();
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
      const isNonExcelRecordRow = !!(item.isRecordRow && !isExcelExt(extFromName(item.fileName)));
      if (isNonExcelRecordRow) {
        const key = buildRecordGroupKey(item) || item.id;
        const group = groupedRecordRows.get(key) || [];
        group.push(item);
        groupedRecordRows.set(key, group);
        continue;
      }
      if (!isExcelItem(item)) normalTargets.push(item);
    }

    const excelGroups = Array.from(groupedExcelRecordRows.values());
    const recordGroups = Array.from(groupedRecordRows.values());
    const totalTargets = excelGroups.length + recordGroups.length + normalTargets.length;
    if (!totalTargets) {
      setStatus("没有可刷新的识别项");
      return;
    }
    setLoading(true, "刷新识别中...");
    setPreprocessProgress(0, totalTargets, "", "刷新识别", "阶段1/4：上传 · 准备刷新");
    let done = 0;

    for (const group of excelGroups) {
      const sample = group[0];
      if (!sample) continue;
      state.activeId = sample.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别", "阶段3/4：结构化解析 · Excel记录计数中");
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
      setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别", "阶段4/4：模板匹配 · 识别完成");
    }

    for (const group of recordGroups) {
      const sample = group[0];
      if (!sample) continue;
      state.activeId = sample.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别", "阶段3/4：结构化解析 · 记录刷新中");
        await refreshRecordRowGroup(group, "记录刷新完成");
      } catch (error) {
        for (const row of group) {
          row.status = "error";
          row.message = error.message || "刷新失败";
        }
        renderQueue();
        appendLog(`刷新失败 ${sample.fileName}：${error.message || "unknown"}`);
      }
      done += 1;
      setPreprocessProgress(done, totalTargets, sample.fileName, "刷新识别", "阶段4/4：模板匹配 · 识别完成");
    }

    for (const item of normalTargets) {
      state.activeId = item.id;
      renderQueue();
      renderTemplateSelect();
      try {
        setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别", "阶段1/4：上传 · 准备刷新");
        if (item.status === "pending") {
          const reportProgress = buildProgressReporter({
            done,
            total: totalTargets,
            fileName: item.fileName,
            label: "刷新识别",
          });
          await processItem(item, {
            onProgress: (event) => reportProgress(event || {}),
          });
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
      setPreprocessProgress(done, totalTargets, item.fileName, "刷新识别", "阶段4/4：模板匹配 · 识别完成");
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
    const isNonExcelRecordRow = !!(activeItem.isRecordRow && !isExcelExt(extFromName(activeItem.fileName)));
    const isExcelRecordRow = !!(
      activeItem.isRecordRow
      && activeItem.fileId
      && isExcelExt(extFromName(activeItem.fileName))
    );
    setLoading(true, "刷新识别中...");
    setPreprocessProgress(0, 1, activeItem.fileName, "刷新识别", "阶段1/4：上传 · 准备刷新");

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
      } else if (isNonExcelRecordRow) {
        const groupKey = buildRecordGroupKey(activeItem) || activeItem.id;
        const group = state.queue.filter((item) => item && item.isRecordRow && buildRecordGroupKey(item) === groupKey);
        await refreshRecordRowGroup(group.length ? group : [activeItem], "当前项记录刷新完成");
      } else if (activeItem.status === "pending" || (!activeItem.isRecordRow && (forceAsExcel || forcedMode === "word"))) {
        await processItem(activeItem, {
          onProgress: (event) => {
            const safeEvent = event || {};
            const stagePercent = clampPercent(safeEvent.progress);
            const { detail } = resolvePhaseDisplay(safeEvent);
            setPreprocessProgress(stagePercent / 100, 1, activeItem.fileName, "刷新识别", detail);
          },
        });
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
      setPreprocessProgress(1, 1, activeItem.fileName, "刷新识别", "阶段4/4：模板匹配 · 识别完成");
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
