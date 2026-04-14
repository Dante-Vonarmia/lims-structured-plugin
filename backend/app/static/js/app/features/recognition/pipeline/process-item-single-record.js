export async function handleSingleRecordPath(deps = {}) {
  const {
    item,
    state,
    ext,
    createEmptyFields,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    runExtract,
    applyStructuredMeasurementItems,
    resolveSourceCode,
    inferCategory,
    buildMultiDeviceWordItems,
    appendLog,
    structuredInstrumentData,
    generalCheckStructureData,
  } = deps;

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
