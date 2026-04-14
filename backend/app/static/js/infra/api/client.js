export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

export async function fetchBlob(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("加载失败");
  return res.blob();
}

export async function loadRuntimeConfigApi() {
  return fetchJson("/api/runtime-config", { cache: "no-store" });
}

export async function listTemplatesApi() {
  return fetchJson("/api/templates");
}

export async function getTaskDetailApi(taskId) {
  return fetchJson(`/api/tasks/${encodeURIComponent(taskId || "")}`, { cache: "no-store" });
}

export async function updateTaskTemplateInfoApi(taskId, payload) {
  return fetchJson(`/api/tasks/${encodeURIComponent(taskId || "")}/template-info`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export async function getTaskImportTemplateSchemaApi(taskId) {
  return fetchJson(`/api/tasks/${encodeURIComponent(taskId || "")}/import-template-schema`, { cache: "no-store" });
}

export async function getTaskWorkspaceDraftApi(taskId) {
  return fetchJson(`/api/tasks/${encodeURIComponent(taskId || "")}/workspace-draft`, { cache: "no-store" });
}

export async function upsertTaskWorkspaceDraftApi(taskId, draft) {
  return fetchJson(`/api/tasks/${encodeURIComponent(taskId || "")}/workspace-draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft: draft || {} }),
  });
}

export async function listSignaturesApi() {
  return fetchJson("/api/signatures", { cache: "no-store" });
}

export async function uploadFileApi(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "上传失败");
  return data;
}

export async function runOcrApi(fileId) {
  return fetchJson("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export async function runExtractApi(rawText) {
  return fetchJson("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_text: rawText || "" }),
  });
}

export async function runInstrumentTableExtractApi(fileId) {
  if (!fileId) return { rows: [], tsv: "", total: 0 };
  return fetchJson(`/api/instrument-table/extract?file_id=${encodeURIComponent(fileId)}`, {
    cache: "no-store",
  });
}

export async function runGeneralCheckStructureExtractApi(fileId) {
  if (!fileId) return { table: null };
  return fetchJson(`/api/report/general-check-structure?file_id=${encodeURIComponent(fileId)}`, {
    cache: "no-store",
  });
}

export async function runDocxEmbeddedInspectApi(fileId) {
  if (!fileId) return {
    embedded_excel_count: 0,
    chart_count: 0,
    chart_linked_excel_count: 0,
    has_embedded_excel: false,
    has_chart: false,
    has_chart_linked_excel: false,
    has_embedded_objects: false,
  };
  return fetchJson(`/api/report/docx-embedded-inspect?file_id=${encodeURIComponent(fileId)}`, {
    cache: "no-store",
  });
}

export async function runTemplateMatchApi(rawText, fileName, extra = {}) {
  return fetchJson("/api/templates/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_text: rawText || "",
      file_name: fileName || "",
      device_name: (extra && extra.device_name) || "",
      device_code: (extra && extra.device_code) || "",
    }),
  });
}

export async function runTemplateFeedbackApi(payload) {
  return fetchJson("/api/templates/feedback/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export async function runExcelInspectApi(fileId, defaultTemplateName) {
  return fetchJson("/api/report/inspect-from-excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      sheet_name: null,
      default_template_name: defaultTemplateName || null,
    }),
  });
}

export async function runExcelPreviewApi(fileId, sheetName = "") {
  return fetchJson("/api/report/preview-from-excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, sheet_name: sheetName || null }),
  });
}

export async function runTemplateTextPreviewApi(templateName) {
  return fetchJson(`/api/templates/text-preview?template_name=${encodeURIComponent(templateName || "")}`);
}

export async function runTemplateEditorSchemaApi(templateName) {
  return fetchJson(`/api/templates/editor-schema?template_name=${encodeURIComponent(templateName || "")}`);
}

export async function runEditorPrefillApi(templateName, item) {
  const payload = {
    template_name: templateName,
    source_file_id: item.fileId || null,
    fields: {
      ...(item.fields || {}),
      raw_record: item.rawText || (item.fields && item.fields.raw_record) || "",
    },
  };
  const data = await fetchJson("/api/templates/editor-prefill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.fields || {};
}
