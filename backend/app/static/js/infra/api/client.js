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

export async function uploadFileApi(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "上传失败");
  return data;
}

export async function parseInstrumentCatalogApi(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/instrument-catalog/parse", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "计量标准器具目录解析失败");
  return data;
}

export async function autoLoadInstrumentCatalogApi() {
  return fetchJson("/api/instrument-catalog/auto-load", { cache: "no-store" });
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
