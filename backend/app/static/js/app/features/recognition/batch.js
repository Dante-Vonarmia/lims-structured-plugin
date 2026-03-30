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

  return { processAllPending, refreshAllRecognition };
}
