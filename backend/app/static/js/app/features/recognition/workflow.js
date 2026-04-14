import { buildRowRecordsFromTableCells } from "./table-slot-parser.js";
import {
  buildFieldRuleResolver,
  buildWaitingFieldPipeline,
  buildWaitingGroupPipeline,
  getSchemaColumnsFromState,
  getSchemaGroupsFromState,
  getSchemaRulesFromState,
  normalizeMonthDayToken,
  syncPipelineFromFields,
  validateFieldStage,
} from "./pipeline/schema-utils.js";
import {
  applyCarryForwardRows,
  applySchemaRulesToMappedFields,
  buildTypedFieldsFromMapped,
  mapLineToSchemaFields,
  splitTableDataLines,
} from "./pipeline/row-pipeline.js";

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

  function processSchemaRowInGroups({
    rowFields = {},
    rawMapped = {},
    schemaColumns = [],
    schemaGroups = [],
    schemaRules = {},
    progressCallback = null,
  }) {
    const cols = Array.isArray(schemaColumns) ? schemaColumns : [];
    const groups = Array.isArray(schemaGroups) ? schemaGroups : [];
    const inputRowFields = (rowFields && typeof rowFields === "object") ? rowFields : {};
    const inputRawMapped = (rawMapped && typeof rawMapped === "object") ? rawMapped : {};
    const fieldPipeline = buildWaitingFieldPipeline(cols, schemaRules);
    const groupPipeline = buildWaitingGroupPipeline(groups);
    const normalizedMapped = {};
    const typedFields = {};

    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g] || {};
      const groupName = String(group.name || "").trim();
      const groupCols = Array.isArray(group.columns) ? group.columns : [];
      if (!groupName || !groupCols.length) continue;
      if (groupPipeline[groupName]) groupPipeline[groupName].status = "processing";
      if (typeof progressCallback === "function") progressCallback({
        phase: "group_start",
        groupName,
        groupIndex: g,
        groupTotal: groups.length,
      });

      const groupRaw = {};
      for (let i = 0; i < groupCols.length; i += 1) {
        const col = groupCols[i] || {};
        const key = String(col.key || "").trim();
        if (!key) continue;
        const colIdx = Number((col && col.index) || 0);
        const colKey = `col_${String(colIdx + 1).padStart(2, "0")}`;
        const label = String(col.label || "").trim();
        const rawValue = String(
          (Object.prototype.hasOwnProperty.call(inputRawMapped, key)
            ? inputRawMapped[key]
            : (inputRowFields[colKey] ?? inputRowFields[label] ?? ""))
            || ""
        ).trim();
        groupRaw[key] = rawValue;
        if (fieldPipeline[key]) fieldPipeline[key].rawValue = rawValue;
      }

      const groupNormalized = applySchemaRulesToMappedFields(groupRaw, groupCols, schemaRules);
      const groupTyped = buildTypedFieldsFromMapped(groupNormalized, groupCols, schemaRules);

      let parsedCount = 0;
      let warningCount = 0;
      let failedCount = 0;
      for (let i = 0; i < groupCols.length; i += 1) {
        const col = groupCols[i] || {};
        const key = String(col.key || "").trim();
        if (!key || !fieldPipeline[key]) continue;
        const normalizedValue = String(groupNormalized[key] || "").trim();
        const typedValue = groupTyped[key] && typeof groupTyped[key] === "object" ? groupTyped[key] : null;
        fieldPipeline[key].typedValue = typedValue;
        fieldPipeline[key].normalizedValue = normalizedValue;
        fieldPipeline[key].displayValue = typedValue
          ? String((typedValue.display || typedValue.isoDate || normalizedValue || fieldPipeline[key].rawValue || "")).trim()
          : normalizedValue;
        const validated = validateFieldStage(fieldPipeline[key]);
        fieldPipeline[key] = validated;
        normalizedMapped[key] = validated.normalizedValue;
        if (typedValue) typedFields[key] = typedValue;
        if (validated.status === "failed") failedCount += 1;
        else if (validated.status === "warning") warningCount += 1;
        else if (validated.status === "parsed") parsedCount += 1;
      }
      if (groupPipeline[groupName]) {
        groupPipeline[groupName].parsed = parsedCount;
        groupPipeline[groupName].warning = warningCount;
        groupPipeline[groupName].failed = failedCount;
        if (failedCount > 0) groupPipeline[groupName].status = "failed";
        else if (warningCount > 0) groupPipeline[groupName].status = "warning";
        else if (parsedCount > 0) groupPipeline[groupName].status = "parsed";
        else groupPipeline[groupName].status = "waiting";
      }
      if (typeof progressCallback === "function") progressCallback({
        phase: "group_done",
        groupName,
        groupIndex: g,
        groupTotal: groups.length,
        groupStatus: groupPipeline[groupName] ? groupPipeline[groupName].status : "waiting",
      });
    }
    return { normalizedMapped, typedFields, fieldPipeline, groupPipeline };
  }

  function waitMs(ms) {
    const n = Number(ms);
    return new Promise((resolve) => setTimeout(resolve, Number.isFinite(n) ? Math.max(0, n) : 0));
  }

  async function replaceSourceWithRowsProgressively(sourceItem, recordRows, stageLabel) {
    const rows = Array.isArray(recordRows) ? recordRows : [];
    const index = state.queue.findIndex((x) => x.id === sourceItem.id);
    if (index < 0) return;
    state.queue.splice(index, 1);
    renderQueue();
    renderTemplateSelect();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
      row.message = `${stageLabel} ${i + 1}/${rows.length}`;
      state.queue.splice(index + i, 0, row);
      if (i === 0) state.activeId = row.id;
      renderQueue();
      renderTemplateSelect();
      await waitMs(26);
    }
  }

  async function processItem(item) {
    const forcedMode = String(item && item.recognitionOverride ? item.recognitionOverride : "").trim().toLowerCase();
    const forceAsExcel = forcedMode === "excel";
    const forceAsWord = forcedMode === "word";
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
    if (forceAsExcel && !isExcelItem(item)) {
      item.status = "processing";
      item.message = "按XLS单条识别中";
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
      const ocr = await runOcr(item.fileId);
      item.rawText = ocr.raw_text || "";
      item.ocrStructured = (ocr && ocr.structured) || {};
      const fields = await runExtract(item.rawText);
      const mergedFields = {
        ...createEmptyFields(),
        ...fields,
        raw_record: item.rawText || "",
        source_profile: "forced_excel_single",
        source_profile_label: "强制XLS-单条",
      };
      const inspect = {
        records: [
          {
            sheet_name: "FORCED",
            row_number: 1,
            row_name: mergedFields.device_name || mergedFields.device_code || "row_1",
            template_name: "",
            fields: mergedFields,
          },
        ],
      };
      const recordRows = buildExcelRecordItems(item, inspect);
      if (!recordRows.length) {
        item.recordCount = 1;
        item.category = "Excel批量";
        item.status = "error";
        item.message = "按XLS单条识别失败";
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
      appendLog(`强制XLS单条识别完成 ${item.fileName}：${recordRows.length} 条`);
      renderQueue();
      renderTemplateSelect();
      return;
    }
    if (forceAsExcel || isExcelItem(item)) {
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

    const schemaColumns = getSchemaColumnsFromState(state);
    const schemaRules = getSchemaRulesFromState(state);
    const schemaGroups = getSchemaGroupsFromState(state, schemaColumns);
    if (schemaColumns.length) {
      item.fieldPipeline = buildWaitingFieldPipeline(schemaColumns, schemaRules);
      item.groupPipeline = buildWaitingGroupPipeline(schemaGroups);
      item.message = `模板骨架已加载，待识别板块 0/${Math.max(1, schemaGroups.length)}`;
      renderQueue();
    }
    item.message = "识别中";
    renderQueue();
    const ocr = await runOcr(item.fileId);
    item.rawText = ocr.raw_text || "";
    item.ocrStructured = (ocr && ocr.structured) || {};
    const structuredRowsRaw = Array.isArray(item.ocrStructured && item.ocrStructured.row_records)
      ? item.ocrStructured.row_records
      : [];
    const tableCells = Array.isArray(item.ocrStructured && item.ocrStructured.table_cells)
      ? item.ocrStructured.table_cells
      : [];
    let structuredRows = structuredRowsRaw;
    const reviewQueue = Array.isArray(item.ocrStructured && item.ocrStructured.review_queue)
      ? item.ocrStructured.review_queue
      : [];
    if (schemaColumns.length) {
      if (!structuredRows.length && tableCells.length) {
        const builtRows = buildRowRecordsFromTableCells({
          tableCells,
          columns: schemaColumns,
          xLines: [],
        });
        if (Array.isArray(builtRows) && builtRows.length) structuredRows = builtRows;
      }
      if (structuredRows.length) {
        const recordRows = [];
        for (let idx = 0; idx < structuredRows.length; idx += 1) {
          const rowItem = structuredRows[idx];
          const rowNumber = Number((rowItem && rowItem.row) || 0) || (idx + 1);
          const rowFields = (rowItem && typeof rowItem.fields === "object" && rowItem.fields) ? rowItem.fields : {};
          const rawRecord = String((rowItem && rowItem.raw_record) || "").trim();
          const groupResult = processSchemaRowInGroups({
            rowFields,
            rawMapped: {},
            schemaColumns,
            schemaGroups,
            schemaRules,
            progressCallback: ({ phase, groupName, groupIndex, groupTotal }) => {
              if (phase !== "group_start") return;
              item.message = `分块识别中 [${idx + 1}/${structuredRows.length}] ${groupName} (${groupIndex + 1}/${groupTotal})`;
              renderQueue();
            },
          });
          const normalizedMapped = groupResult.normalizedMapped;
          const typedFields = groupResult.typedFields;
          const fieldPipeline = groupResult.fieldPipeline;
          const groupPipeline = groupResult.groupPipeline;
          const mergedFields = { ...createEmptyFields(), ...normalizedMapped, raw_record: rawRecord };
          const firstColKey = String((schemaColumns[0] && schemaColumns[0].key) || "").trim();
          const secondColKey = String((schemaColumns[1] && schemaColumns[1].key) || "").trim();
          const recordName = String(mergedFields[firstColKey] || mergedFields[secondColKey] || `row_${rowNumber}`).trim();
          const rowReviewQueue = reviewQueue.filter((x) => Number((x && x.row) || 0) === rowNumber);
          const recordRow = {
            id: `${item.id}-t${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
            file: item.file,
            fileName: item.fileName,
            sourceFileName: item.sourceFileName || item.fileName,
            recordName,
            rowNumber,
            sheetName: "",
            isRecordRow: true,
            sourceType: item.sourceType,
            fileId: item.fileId,
            rawText: rawRecord,
            sourceCode: resolveSourceCode({ ...item, fields: mergedFields }),
            recordCount: 1,
            category: inferCategory({ ...item, fields: mergedFields }),
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
            typedFields,
            fieldPipeline,
            groupPipeline,
            templateName: "",
            matchedBy: "",
            templateUserSelected: false,
            status: "ready",
            message: rowReviewQueue.length ? `表格行已载入（待复核 ${rowReviewQueue.length} 项）` : "表格行已载入",
            reportId: "",
            reportDownloadUrl: "",
            reportFileName: "",
            reportGenerateMode: "",
            modeReports: {},
            generalCheckStruct: null,
            reviewQueue: rowReviewQueue,
          };
          recordRows.push(recordRow);
          await waitMs(0);
        }
        applyCarryForwardRows(recordRows, schemaColumns, schemaRules);
        recordRows.forEach((row) => syncPipelineFromFields(row));
        await replaceSourceWithRowsProgressively(item, recordRows, "表格行识别");
        appendLog(`结构化表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      const dataLines = splitTableDataLines(item.rawText, schemaRules);
      if (dataLines.length) {
        const recordRows = dataLines.map((line, idx) => {
          const mapped = mapLineToSchemaFields(line, schemaColumns, schemaRules);
          const groupResult = processSchemaRowInGroups({
            rowFields: {},
            rawMapped: mapped,
            schemaColumns,
            schemaGroups,
            schemaRules,
          });
          const normalizedMapped = groupResult.normalizedMapped;
          const typedFields = groupResult.typedFields;
          const fieldPipeline = groupResult.fieldPipeline;
          const groupPipeline = groupResult.groupPipeline;
          const mergedFields = { ...createEmptyFields(), ...normalizedMapped, raw_record: line };
          const rowNumber = idx + 1;
          const firstColKey = String((schemaColumns[0] && schemaColumns[0].key) || "").trim();
          const secondColKey = String((schemaColumns[1] && schemaColumns[1].key) || "").trim();
          const recordName = String(mergedFields[firstColKey] || mergedFields[secondColKey] || `row_${rowNumber}`).trim();
          return {
            id: `${item.id}-t${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
            file: item.file,
            fileName: item.fileName,
            sourceFileName: item.sourceFileName || item.fileName,
            recordName,
            rowNumber,
            sheetName: "",
            isRecordRow: true,
            sourceType: item.sourceType,
            fileId: item.fileId,
            rawText: line,
            sourceCode: resolveSourceCode({ ...item, fields: mergedFields }),
            recordCount: 1,
            category: inferCategory({ ...item, fields: mergedFields }),
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
            typedFields,
            fieldPipeline,
            groupPipeline,
            templateName: "",
            matchedBy: "",
            templateUserSelected: false,
            status: "ready",
            message: "表格行已载入",
            reportId: "",
            reportDownloadUrl: "",
            reportFileName: "",
            reportGenerateMode: "",
            modeReports: {},
            generalCheckStruct: null,
          };
        });
        applyCarryForwardRows(recordRows, schemaColumns, schemaRules);
        recordRows.forEach((row) => syncPipelineFromFields(row));
        await replaceSourceWithRowsProgressively(item, recordRows, "文本行识别");
        appendLog(`表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      item.fields = { ...createEmptyFields(), raw_record: item.rawText || "" };
      item.recognizedFields = { ...item.fields };
      item.fieldPipeline = buildWaitingFieldPipeline(schemaColumns, schemaRules);
      item.groupPipeline = buildWaitingGroupPipeline(schemaGroups);
      item.status = "ready";
      item.message = "未识别到表格数据行";
      renderQueue();
      renderTemplateSelect();
      return;
    }

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
