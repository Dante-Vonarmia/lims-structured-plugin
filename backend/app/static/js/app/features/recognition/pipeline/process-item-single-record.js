import { handleDocxMultiDevicePath } from "./process-item-docx-multi-device.js";

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

  const docxMultiDeviceHandled = await handleDocxMultiDevicePath({
    ext,
    item,
    state,
    buildMultiDeviceWordItems,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    appendLog,
  });
  if (docxMultiDeviceHandled) {
    return;
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
