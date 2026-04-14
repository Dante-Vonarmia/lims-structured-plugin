export async function handleMultiBlocksPath(deps = {}) {
  const {
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
  } = deps;

  if (!(Array.isArray(blocks) && blocks.length > 1)) {
    return false;
  }

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
  return true;
}
