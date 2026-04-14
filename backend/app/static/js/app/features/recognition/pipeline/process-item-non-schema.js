import { handleMultiBlocksPath } from "./process-item-multi-blocks.js";

export async function handleNonSchemaBranch(deps = {}) {
  const {
    item,
    state,
    forceAsWord,
    createEmptyFields,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runInstrumentTableExtract,
    runGeneralCheckStructureExtract,
    extFromName,
    splitRecordBlocks,
    runExtract,
    applyStructuredMeasurementItems,
    inferCategory,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceCode,
    buildMultiDeviceWordItems,
    appendLog,
  } = deps;

  const ext = extFromName(item.fileName || "");

  if (ext === ".docx") {
    const docxStruct = (item.ocrStructured && item.ocrStructured.docx) || {};
    const embeddedExcelCount = Number(docxStruct.embedded_excel_count || 0);
    const chartCount = Number(docxStruct.chart_count || 0);
    if (embeddedExcelCount > 0 || chartCount > 0) {
      appendLog(`DOCX内嵌对象检测 ${item.fileName}：Excel=${embeddedExcelCount} 图表=${chartCount}`);
    }
  }
  const blocks = (ext === ".docx" || forceAsWord) ? [item.rawText] : splitRecordBlocks(item.rawText);
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

  const multiBlocksHandled = await handleMultiBlocksPath({
    blocks,
    item,
    state,
    createEmptyFields,
    runExtract,
    applyStructuredMeasurementItems,
    structuredInstrumentData,
    extractTemplateCode,
    inferCategory,
    buildCategoryMessage,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    generalCheckStructureData,
  });
  if (multiBlocksHandled) {
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
