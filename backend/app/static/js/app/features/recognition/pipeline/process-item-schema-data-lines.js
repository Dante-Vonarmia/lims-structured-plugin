import { applyCarryForwardRows, mapLineToSchemaFields, splitTableDataLines } from "./row-pipeline.js";
import { processSchemaRowInGroups } from "./group-pipeline.js";
import { syncPipelineFromFields } from "./schema-utils.js";

export async function handleDataLinesPath(deps = {}) {
  const {
    item,
    schemaColumns,
    schemaRules,
    schemaGroups,
    createEmptyFields,
    resolveSourceCode,
    inferCategory,
    replaceSourceWithRowsProgressively,
    appendLog,
  } = deps;

  const dataLines = splitTableDataLines(item.rawText, schemaRules);
  if (!dataLines.length) return false;

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
  return true;
}
