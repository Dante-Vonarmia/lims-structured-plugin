export function createRecognitionWorkflowFeature(deps = {}) {
  const {
    state,
    isExcelItem,
    createEmptyFields,
    uploadFile,
    runExcelInspect,
    buildExcelRecordItems,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runOcr,
    extFromName,
    splitRecordBlocks,
    runInstrumentTableExtract,
    appendLog,
    runGeneralCheckStructureExtract,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
  } = deps;

  async function processItem(item) {
    if (item.isRecordRow) {
      if (!item.recognizedFields || typeof item.recognizedFields !== "object") {
        item.recognizedFields = { ...(item.fields || {}) };
      }
      item.status = "ready";
      if (!item.templateName) await applyAutoTemplateMatch(item, { force: true });
      else item.message = "记录已就绪，可生成";
      renderQueue();
      renderTemplateSelect();
      return;
    }
    if (isExcelItem(item)) {
      item.status = "processing";
      item.message = "记录计数中";
      renderQueue();
      if (!item.fileId) {
        const up = await uploadFile(item.file);
        item.fileId = up.file_id;
      }
      const inspect = await runExcelInspect(item.fileId, item.templateName || "");
      const recordRows = buildExcelRecordItems(item, inspect);
      if (!recordRows.length) {
        item.recordCount = inspect.total_rows || 0;
        item.category = "Excel批量";
        item.status = "error";
        item.message = (inspect.errors && inspect.errors[0]) || "Excel 未识别到有效记录";
        renderQueue();
        return;
      }
      for (const recordItem of recordRows) {
        if (!recordItem.templateName) await applyAutoTemplateMatch(recordItem, { force: true });
      }
      const index = state.queue.findIndex((x) => x.id === item.id);
      if (index >= 0) {
        state.queue.splice(index, 1, ...recordRows);
        state.activeId = recordRows[0].id;
      }
      renderQueue();
      renderTemplateSelect();
      return;
    }
    item.status = "processing";
    item.message = "上传中";
    item.reportId = "";
    item.reportDownloadUrl = "";
    item.reportFileName = "";
    item.reportGenerateMode = "";
    item.modeReports = {};
    renderQueue();

    if (!item.fileId) {
      const up = await uploadFile(item.file);
      item.fileId = up.file_id;
    }

    item.message = "识别中";
    renderQueue();
    const ocr = await runOcr(item.fileId);
    item.rawText = ocr.raw_text || "";
    item.ocrStructured = (ocr && ocr.structured) || {};
    const ext = extFromName(item.fileName || "");
    if (ext === ".docx") {
      const docxStruct = (item.ocrStructured && item.ocrStructured.docx) || {};
      const embeddedExcelCount = Number(docxStruct.embedded_excel_count || 0);
      const chartCount = Number(docxStruct.chart_count || 0);
      if (embeddedExcelCount > 0 || chartCount > 0) {
        appendLog(`DOCX内嵌对象检测 ${item.fileName}：Excel=${embeddedExcelCount} 图表=${chartCount}`);
      }
    }
    const blocks = ext === ".docx" ? [item.rawText] : splitRecordBlocks(item.rawText);
    item.recordCount = Math.max(blocks.length, 1);
    let structuredInstrumentData = null;
    let generalCheckStructureData = null;
    if (ext === ".docx" && item.fileId) {
      try {
        const extracted = await runInstrumentTableExtract(item.fileId);
        if (extracted && Number(extracted.total || 0) > 0 && String(extracted.tsv || "").trim()) {
          structuredInstrumentData = extracted;
        }
      } catch (error) {
        appendLog(`结构化器具表提取失败 ${item.fileName}：${error.message || "unknown"}`);
      }
      try {
        const structRes = await runGeneralCheckStructureExtract(item.fileId);
        const tableModel = structRes && structRes.table && typeof structRes.table === "object" ? structRes.table : null;
        const hasSingle = !!(tableModel && Array.isArray(tableModel.cells) && tableModel.cells.length);
        const hasMulti = !!(tableModel && Array.isArray(tableModel.tables) && tableModel.tables.length);
        if (hasSingle || hasMulti) {
          generalCheckStructureData = structRes.table;
        }
      } catch (error) {
        appendLog(`续页结构提取失败 ${item.fileName}：${error.message || "unknown"}`);
      }
    }
    item.generalCheckStruct = generalCheckStructureData;

    if (blocks.length > 1) {
      item.message = "多记录拆分中";
      renderQueue();
      const sharedFields = await runExtract(item.rawText);
      applyStructuredMeasurementItems(sharedFields, structuredInstrumentData);
      const recordRows = [];
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        const rowNumber = i + 1;
        const fields = await runExtract(block);
        const mergedFields = { ...createEmptyFields(), ...sharedFields, ...fields, raw_record: block };
        applyStructuredMeasurementItems(mergedFields, structuredInstrumentData);
        const tmpItem = {
          ...item,
          rawText: block,
          fields: mergedFields,
          sourceCode: extractTemplateCode(`${item.fileName || ""}\n${block}`),
        };
        const category = inferCategory(tmpItem);

        const recordName = mergedFields.device_name || mergedFields.device_code || `record_${rowNumber}`;
        const recordItem = {
          id: `${item.id}-m${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
          file: item.file,
          fileName: item.fileName,
          sourceFileName: item.sourceFileName || item.fileName,
          recordName,
          rowNumber,
          sheetName: "",
          isRecordRow: true,
          sourceType: item.sourceType,
          fileId: item.fileId,
          rawText: block,
          sourceCode: tmpItem.sourceCode || "",
          recordCount: 1,
          category,
          fields: mergedFields,
          recognizedFields: { ...mergedFields },
          templateName: "",
          matchedBy: "",
          templateUserSelected: false,
          status: "ready",
          message: buildCategoryMessage({ category, fields: mergedFields }, "识别完成，待匹配模板"),
          reportId: "",
          reportDownloadUrl: "",
          reportFileName: "",
          reportGenerateMode: "",
          modeReports: {},
          generalCheckStruct: generalCheckStructureData,
        };
        await applyAutoTemplateMatch(recordItem, { force: true });
        recordRows.push(recordItem);
      }

      const index = state.queue.findIndex((x) => x.id === item.id);
      if (index >= 0) {
        state.queue.splice(index, 1, ...recordRows);
        state.activeId = recordRows[0].id;
      }
      renderQueue();
      renderTemplateSelect();
      return;
    }

    item.message = "分类中";
    renderQueue();
    const fields = await runExtract(item.rawText);
    item.fields = { ...createEmptyFields(), ...fields, raw_record: item.rawText };
    applyStructuredMeasurementItems(item.fields, structuredInstrumentData);
    item.recognizedFields = { ...item.fields };
    item.sourceCode = resolveSourceCode(item);
    item.category = inferCategory(item);
    item.generalCheckStruct = generalCheckStructureData;

    if (ext === ".docx") {
      const groupItems = buildMultiDeviceWordItems(item, item.fields || {});
      if (groupItems.length > 1) {
        item.recordCount = groupItems.length;
        for (const row of groupItems) {
          await applyAutoTemplateMatch(row, { force: true });
        }
        const index = state.queue.findIndex((x) => x.id === item.id);
        if (index >= 0) {
          state.queue.splice(index, 1, ...groupItems);
          state.activeId = groupItems[0].id;
        }
        renderQueue();
        renderTemplateSelect();
        appendLog(`多器具拆分完成 ${item.fileName}：${groupItems.length} 条`);
        return;
      }
    }

    item.message = "识别结果整理中";
    renderQueue();
    item.templateName = "";
    item.matchedBy = "";
    item.templateUserSelected = false;
    await applyAutoTemplateMatch(item, { force: true });
    renderQueue();
    renderTemplateSelect();
  }

  return { processItem };
}
