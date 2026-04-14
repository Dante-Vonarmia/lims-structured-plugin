import { buildRowRecordsFromTableCells } from "../table-slot-parser.js";
import { processSchemaRowInGroups, waitMs } from "./group-pipeline.js";
import { applyCarryForwardRows } from "./row-pipeline.js";
import { syncPipelineFromFields } from "./schema-utils.js";

export async function handleStructuredRowsPath(deps = {}) {
  const {
    item,
    schemaColumns,
    schemaRules,
    schemaGroups,
    createEmptyFields,
    reviewQueue,
    tableCells,
    resolveSourceCode,
    inferCategory,
    replaceSourceWithRowsProgressively,
    appendLog,
    renderQueue,
  } = deps;

  let structuredRows = Array.isArray(item.ocrStructured && item.ocrStructured.row_records)
    ? item.ocrStructured.row_records
    : [];
  if (!structuredRows.length && tableCells.length) {
    const builtRows = buildRowRecordsFromTableCells({
      tableCells,
      columns: schemaColumns,
      xLines: [],
    });
    if (Array.isArray(builtRows) && builtRows.length) structuredRows = builtRows;
  }
  if (!structuredRows.length) return false;

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
  return true;
}
