import {
  fetchBlob,
  fetchJson,
  getTaskWorkspaceDraftApi,
  listSignaturesApi,
  listTemplatesApi,
  loadRuntimeConfigApi,
  runExcelInspectApi,
  runExcelPreviewApi,
  runExtractApi,
  runDocxEmbeddedInspectApi,
  runGeneralCheckStructureExtractApi,
  runInstrumentTableExtractApi,
  runOcrApi,
  runTemplateEditorSchemaApi,
  runTemplateFeedbackApi,
  runTemplateMatchApi,
  runTemplateTextPreviewApi,
  upsertTaskWorkspaceDraftApi,
  uploadFileApi,
} from "../infra/api/client.js";
import {
  EXTERNAL_DOCX_PREVIEW_CSS_URLS,
  EXTERNAL_DOCX_PREVIEW_URLS,
  EXTERNAL_JSZIP_URLS,
  FILTER_BLANK_TOKEN,
  GENERATE_MODE_META,
  LOCAL_DOCX_PREVIEW_CSS_URLS,
  LOCAL_DOCX_PREVIEW_URLS,
  LOCAL_JSZIP_URLS,
  resolveGeneratedModeKey,
  SOURCE_FIELD_LABELS,
  SOURCE_FORM_FIELDS,
  SOURCE_HIDDEN_SYSTEM_KEYS,
  SOURCE_RECOGNITION_CORE_KEYS,
  SUPPORTED_EXTS,
  TEMPLATE_INFO_FIELDS,
  TARGET_BASIC_FORM_FIELDS,
  TARGET_EDIT_GROUPS,
  TEMPLATE_GENERATION_RULES,
  TEMPLATE_REQUIRED_FIELDS,
} from "../core/config/constants.js";
import { createEmptyFields, createInitialState } from "../core/state/factory.js";
import { createMeasurementTableFeature } from "./features/measurement-table.js";
import { createGeneralCheckFeature } from "./features/general-check.js";
import { createGenerationWorkflowFeature } from "./features/generation/workflow.js";
import { createGenerationBatchFeature } from "./features/generation/batch.js";
import { createRecognitionWorkflowFeature } from "./features/recognition/workflow.js";
import { createRecognitionBatchFeature } from "./features/recognition/batch.js";
import { createPreviewWorkflowFeature } from "./features/preview/workflow.js";
import { createDocxPreviewFeature } from "./features/preview/docx.js";
import { createFormRenderingFeature } from "./features/forms/rendering.js";
import { createFormSchemaFeature } from "./features/forms/schema.js";
import { createFocusSectionsFeature } from "./features/forms/focus-sections.js";
import { createMatchingWorkflowFeature } from "./features/matching/workflow.js";
import { createMatchingValidationFeature } from "./features/matching/validation.js";
import { createQueueRenderingFeature } from "./features/queue/rendering.js";
import { createSourceSplittingFeature } from "./features/source/splitting.js";
import { createRuntimeCommonFeature } from "./features/runtime/common.js";
import { createRuntimeApisFeature } from "./features/runtime/apis.js";
import { createRuntimeListUiFeature } from "./features/runtime/list-ui.js";
import { createBindEventsFeature } from "./features/events/bind-events.js";
import {
  cleanBlockText,
  collectDocxImageTokens,
  enrichGeneralCheckWithDocxImages,
  escapeAttr,
  escapeHtml,
  extractAllBlocksByLine,
  extractBlockByLine,
  hasDocxImageToken,
  inferDateTriplet,
  isCompleteDateText,
  normalizeOptionalBlank,
  normalizeValidationToken,
  parseDateFromLabelText,
  parseDateParts,
  renderRichCellHtml,
  shiftDateText,
  toDateOnlyDisplay,
} from "./features/shared/text-date-utils.js";

    const state = createInitialState();

    const $ = (id) => document.getElementById(id);

    const {
      normalizeForCodeMatch,
      extractTemplateCode,
      resolveSourceCode,
      resolveTemplateCode,
      isExcelExt,
      extFromName,
      isExcelItem,
      isSupportedFile,
      shouldUseBlankFallback,
      resolveBlankTemplateName,
      getModelCodeDisplay,
      getDeviceCodeDisplay,
    } = createRuntimeCommonFeature({
      state,
      SUPPORTED_EXTS,
    });

    function createQueueItem(file) {
      const ext = extFromName(file && file.name ? file.name : "");
      return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        fileName: file.name || "",
        sourceFileName: file.name || "",
        recordName: "",
        rowNumber: 0,
        sheetName: "",
        isRecordRow: false,
        sourceType: (ext || "").replace(".", "").toUpperCase() || "UNKNOWN",
        recognitionOverride: "",
        fileId: "",
        rawText: "",
        sourceCode: "",
        recordCount: 0,
        category: "",
        fields: createEmptyFields(),
        recognizedFields: createEmptyFields(),
        typedFields: {},
        fieldPipeline: {},
        groupPipeline: {},
        templateName: "",
        matchedBy: "",
        templateUserSelected: false,
        status: "pending",
        message: "待处理",
        reportId: "",
        reportDownloadUrl: "",
        reportFileName: "",
        reportGenerateMode: "",
        modeReports: {},
      };
    }


    function appendLog(text) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const line = `[${hh}:${mm}:${ss}] ${text}`;
      const statusEl = $("globalStatus");
      if (statusEl) statusEl.textContent = `动态：${line}`;
      const logEl = $("batchLog");
      if (logEl) {
        logEl.textContent += `\n${line}`;
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    function setStatus(text) {
      const raw = String(text || "").trim();
      const statusEl = $("globalStatus");
      if (statusEl) statusEl.textContent = raw ? `动态：${raw}` : "动态：";
    }

    function setPreprocessProgress(current, total, fileName, label = "预处理") {
      const row = $("preprocessProgressRow");
      const bar = $("preprocessProgressBar");
      const text = $("preprocessProgressText");
      if (!row || !bar || !text) return;
      const safeTotal = total > 0 ? total : 1;
      const percent = Math.max(0, Math.min(100, Math.round((current / safeTotal) * 100)));
      row.classList.add("show");
      bar.value = percent;
      text.textContent = `${label}：${current}/${total}${fileName ? `（${fileName}）` : ""}`;
    }

    function clearPreprocessProgress(label = "预处理") {
      const row = $("preprocessProgressRow");
      const bar = $("preprocessProgressBar");
      const text = $("preprocessProgressText");
      if (!row || !bar || !text) return;
      bar.value = 0;
      text.textContent = `${label}：0/0`;
      row.classList.remove("show");
    }

    function setLoading(show, text) {
      state.busy = !!show;
      $("loadingMask").classList.toggle("show", !!show);
      $("loadingText").textContent = text || "处理中...";
      refreshActionButtons();
    }

    function statusLabel(itemOrStatus) {
      const status = typeof itemOrStatus === "string"
        ? itemOrStatus
        : String((itemOrStatus && itemOrStatus.status) || "");
      const base = {
        pending: "待处理",
        processing: "处理中",
        ready: "可生成",
        incomplete: "待补全",
        generated: "已生成",
        confirmed: "已确认",
        error: "失败",
      };
      if (status !== "generated") return base[status] || status;
      const item = typeof itemOrStatus === "string" ? null : itemOrStatus;
      const modeKey = resolveGeneratedModeKey(item);
      if (!modeKey) return base.generated;
      const modeMeta = GENERATE_MODE_META[modeKey];
      return String((modeMeta && modeMeta.generatedStatusLabel) || base.generated);
    }

    function statusClass(s) {
      if (s === "generated" || s === "confirmed" || s === "ready") return "ok";
      if (s === "error") return "err";
      if (s === "processing" || s === "incomplete") return "warn";
      return "";
    }

    function setButtonText(btn, text) {
      if (!btn) return;
      const textEl = btn.querySelector(".btn-text");
      if (textEl) {
        textEl.textContent = text;
        return;
      }
      btn.textContent = text;
    }
    const MULTI_EDIT_MIXED_PLACEHOLDER = "（多值）";
    const MULTI_EDIT_DISABLED_FIELD_KEYS = new Set(["measurement_items", "general_check_full", "basis_standard"]);

    const {
      getActiveItem,
      isTypingTarget,
      navigateActiveItem,
      getGenerateMode,
      setFullscreenButtonUi,
      syncGenerateModeUiText,
      readListColumnValue,
      isListBlankField,
      normalizeListFilterToken,
      formatListFilterLabel,
      getKeywordStatusFilteredQueue,
      getColumnFilterOptionEntries,
      getFilteredSortedQueue,
      getSelectedItems,
      getSelectedNormalItems,
      isTargetMultiEditMode,
      getSharedFieldValue,
      refreshTargetFieldFormBySelection,
      updateSelectedCountText,
      updateDetailPanelVisibility,
      refreshSourceViewButtons,
      setSourceViewMode,
      refreshRightViewTabs,
      setRightViewMode,
      updateSourceDeviceNameText,
      setPreviewFullscreen,
    } = createRuntimeListUiFeature({
      $,
      state,
      FILTER_BLANK_TOKEN,
      toDateOnlyDisplay,
      getModelCodeDisplay,
      getDeviceCodeDisplay,
      TEMPLATE_INFO_FIELDS,
      isExcelItem,
      escapeAttr,
      setPreviewPlaceholder,
      getRefreshActionButtons: () => refreshActionButtons,
      getRenderQueue: () => renderQueue,
      getRenderTemplateSelect: () => renderTemplateSelect,
      getRenderPreviews: () => renderPreviews,
      getRenderTargetFieldForm: () => renderTargetFieldForm,
      getApplyTargetFieldProblemStyles: () => applyTargetFieldProblemStyles,
      getRenderSourceFieldList: () => renderSourceFieldList,
      getRenderSourcePreview: () => renderSourcePreview,
      setButtonText,
    });

    const { renderStats, renderQueue, renderTemplateSelect, refreshActionButtons } = createQueueRenderingFeature({
      $,
      state,
      statusClass,
      statusLabel,
      escapeHtml,
      escapeAttr,
      getActiveItem,
      getSelectedNormalItems,
      getFilteredSortedQueue,
      getKeywordStatusFilteredQueue,
      getColumnFilterOptionEntries,
      getModelCodeDisplay,
      getDeviceCodeDisplay,
      updateSourceDeviceNameText,
      updateSelectedCountText,
      updateDetailPanelVisibility,
      refreshSourceViewButtons,
      refreshRightViewTabs,
      syncGenerateModeUiText,
      getGenerateMode,
      setFullscreenButtonUi,
      resolveBlankTemplateName,
      isExcelItem,
      TEMPLATE_INFO_FIELDS,
    });

    async function loadRuntimeConfig() {
      try {
        const data = await loadRuntimeConfigApi();
        state.runtime.offlineMode = !!data.offline_mode;
        state.runtime.modifyCertificateBlueprintTemplateName = String(
          (data && data.modify_certificate_blueprint_template_name) || "modify-certificate-blueprint.docx",
        ).trim();
      } catch (_) {
        // noop
      }
    }

    async function loadTemplates() {
      const data = await listTemplatesApi();
      state.templates = data.templates || [];
      renderTemplateSelect();
      appendLog(`模板加载完成，共 ${state.templates.length} 个`);
    }

    async function loadSignatures() {
      try {
        const data = await listSignaturesApi();
        state.signatures = Array.isArray(data && data.signatures) ? data.signatures : [];
      } catch (_) {
        state.signatures = [];
      }
    }

    async function getTaskDetailApi(taskId) {
      const normalizedTaskId = String(taskId || "").trim();
      if (!normalizedTaskId) return null;
      const data = await fetchJson("/api/tasks", { cache: "no-store" });
      const rows = Array.isArray(data && data.tasks) ? data.tasks : [];
      return rows.find((row) => String((row && row.id) || "").trim() === normalizedTaskId) || null;
    }

    async function getTaskImportTemplateSchemaApi(taskId) {
      const normalizedTaskId = String(taskId || "").trim();
      if (!normalizedTaskId) return { schema: { template_name: "", columns: [], groups: [] } };
      return fetchJson(`/api/tasks/${encodeURIComponent(normalizedTaskId)}/import-template-schema`, { cache: "no-store" });
    }

    async function updateTaskStatusApi(taskId, status) {
      const normalizedTaskId = String(taskId || "").trim();
      const normalizedStatus = String(status || "").trim();
      if (!normalizedTaskId || !normalizedStatus) return null;
      return fetchJson(`/api/tasks/${encodeURIComponent(normalizedTaskId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: normalizedStatus }),
      });
    }

    function getWorkspaceTaskIdFromPath() {
      const path = String((window && window.location && window.location.pathname) || "").trim();
      const match = path.match(/^\/workspace\/([^/]+)$/);
      return match ? String(match[1] || "").trim() : "";
    }

    function normalizeTaskTemplateInfo(raw) {
      const src = (raw && typeof raw === "object") ? raw : {};
      return {
        info_title: String(src.info_title || "").trim(),
        file_no: String(src.file_no || "").trim(),
        inspect_standard: String(src.inspect_standard || "").trim(),
        record_no: String(src.record_no || "").trim(),
        submit_org: String(src.submit_org || "").trim(),
      };
    }

    function getTaskDefaultTemplateName() {
      const outputBundleId = String((state.taskContext && state.taskContext.output_bundle_id) || "").trim();
      if (outputBundleId) {
        const bundleRef = `bundle:${outputBundleId}`;
        if (state.templates.includes(bundleRef)) return bundleRef;
      }
      const raw = String((state.taskContext && state.taskContext.export_template_name) || "").trim();
      if (!raw) return "";
      const fileName = raw.split(/[\\/]/).pop() || raw;
      if (fileName && state.templates.includes(fileName)) return fileName;
      if (state.templates.includes(raw)) return raw;
      return "";
    }

    async function loadTaskContext() {
      const taskId = getWorkspaceTaskIdFromPath();
      state.taskContext.id = taskId;
      state.taskContext.task_name = "";
      state.taskContext.input_bundle_id = "";
      state.taskContext.output_bundle_id = "";
      state.taskContext.import_template_type = "";
      state.taskContext.export_template_name = "";
      state.taskContext.import_template_schema = { template_name: "", columns: [], groups: [] };
      state.taskContext.template_info = normalizeTaskTemplateInfo({});
      if (!taskId) return;
      try {
        const task = await getTaskDetailApi(taskId);
        if (!task) {
          appendLog("任务不存在或已删除");
          state.taskContext.id = "";
          state.taskContext.task_name = "";
          state.taskContext.input_bundle_id = "";
          state.taskContext.output_bundle_id = "";
          state.taskContext.import_template_type = "";
          state.taskContext.export_template_name = "";
          state.taskContext.import_template_schema = { template_name: "", columns: [], groups: [] };
          state.taskContext.template_info = normalizeTaskTemplateInfo({});
          return;
        }
        state.taskContext.id = String(task.id || taskId).trim();
        state.taskContext.task_name = String(task.task_name || "").trim();
        state.taskContext.input_bundle_id = String(task.input_bundle_id || "").trim();
        state.taskContext.output_bundle_id = String(task.output_bundle_id || "").trim();
        state.taskContext.import_template_type = String(task.import_template_type || "").trim();
        state.taskContext.export_template_name = String(task.export_template_name || "").trim();
        state.taskContext.template_info = normalizeTaskTemplateInfo(task.template_info);
        try {
          const schemaData = await getTaskImportTemplateSchemaApi(state.taskContext.id);
          const schema = (schemaData && schemaData.schema && typeof schemaData.schema === "object") ? schemaData.schema : {};
          state.taskContext.import_template_schema = {
            template_name: String(schema.template_name || "").trim(),
            columns: Array.isArray(schema.columns) ? schema.columns : [],
            groups: Array.isArray(schema.groups) ? schema.groups : [],
          };
        } catch (schemaError) {
          appendLog(`导入模板结构加载失败：${schemaError.message || "unknown"}`);
          state.taskContext.import_template_schema = { template_name: "", columns: [], groups: [] };
        }
      } catch (error) {
        appendLog(`任务主信息加载失败：${error.message || "unknown"}`);
      }
    }

    function normalizeDraftItem(raw) {
      const src = (raw && typeof raw === "object") ? raw : {};
      return {
        id: String(src.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        file: null,
        fileName: String(src.fileName || ""),
        sourceFileName: String(src.sourceFileName || ""),
        recordName: String(src.recordName || ""),
        rowNumber: Number(src.rowNumber) || 0,
        sheetName: String(src.sheetName || ""),
        isRecordRow: !!src.isRecordRow,
        sourceType: String(src.sourceType || "UNKNOWN"),
        recognitionOverride: String(src.recognitionOverride || ""),
        fileId: String(src.fileId || ""),
        rawText: String(src.rawText || ""),
        sourceCode: String(src.sourceCode || ""),
        recordCount: Number(src.recordCount) || 0,
        category: String(src.category || ""),
        fields: { ...createEmptyFields(), ...((src.fields && typeof src.fields === "object") ? src.fields : {}) },
        recognizedFields: { ...createEmptyFields(), ...((src.recognizedFields && typeof src.recognizedFields === "object") ? src.recognizedFields : {}) },
        typedFields: (src.typedFields && typeof src.typedFields === "object") ? src.typedFields : {},
        fieldPipeline: (src.fieldPipeline && typeof src.fieldPipeline === "object") ? src.fieldPipeline : {},
        groupPipeline: (src.groupPipeline && typeof src.groupPipeline === "object") ? src.groupPipeline : {},
        templateName: String(src.templateName || ""),
        matchedBy: String(src.matchedBy || ""),
        templateUserSelected: !!src.templateUserSelected,
        status: String(src.status || "pending"),
        message: String(src.message || "待处理"),
        reportId: String(src.reportId || ""),
        reportDownloadUrl: String(src.reportDownloadUrl || ""),
        reportFileName: String(src.reportFileName || ""),
        reportGenerateMode: String(src.reportGenerateMode || ""),
        modeReports: (src.modeReports && typeof src.modeReports === "object") ? src.modeReports : {},
      };
    }

    function buildWorkspaceDraftPayload() {
      return {
        queue: state.queue.map((item) => normalizeDraftItem(item)),
        active_id: String(state.activeId || ""),
        selected_ids: Array.from(state.selectedIds || []),
        list_filter: state.listFilter,
        source_view_mode: String(state.sourceViewMode || "preview"),
        right_view_mode: String(state.rightViewMode || "preview"),
        saved_at: new Date().toISOString(),
      };
    }

    function applyWorkspaceDraft(draft) {
      const payload = (draft && typeof draft === "object") ? draft : {};
      const queue = Array.isArray(payload.queue) ? payload.queue.map((x) => normalizeDraftItem(x)) : [];
      state.queue = queue;
      const idSet = new Set(queue.map((x) => String(x.id || "")));
      const selectedIds = Array.isArray(payload.selected_ids) ? payload.selected_ids.map((x) => String(x || "")).filter((x) => idSet.has(x)) : [];
      state.selectedIds = new Set(selectedIds);
      const activeId = String(payload.active_id || "");
      state.activeId = idSet.has(activeId) ? activeId : (queue[0] ? String(queue[0].id || "") : "");
      if (!state.selectedIds.size && state.activeId) state.selectedIds.add(state.activeId);
      if (payload.list_filter && typeof payload.list_filter === "object") {
        state.listFilter = {
          keyword: String(payload.list_filter.keyword || ""),
          status: String(payload.list_filter.status || ""),
          sortKey: String(payload.list_filter.sortKey || ""),
          sortDir: payload.list_filter.sortDir === "desc" ? "desc" : "asc",
          columnFilters: (payload.list_filter.columnFilters && typeof payload.list_filter.columnFilters === "object")
            ? payload.list_filter.columnFilters
            : {},
          activeFilterKey: String(payload.list_filter.activeFilterKey || ""),
        };
      }
      state.sourceViewMode = payload.source_view_mode === "fields" ? "fields" : "preview";
      state.rightViewMode = payload.right_view_mode === "field" ? "field" : "preview";
    }

    function applyTaskDefaultTemplateToQueueItems() {
      const defaultTemplateName = getTaskDefaultTemplateName();
      if (!defaultTemplateName) return;
      state.queue.forEach((item) => {
        if (!item || typeof item !== "object") return;
        if (String(item.templateName || "").trim()) return;
        item.templateName = defaultTemplateName;
        item.matchedBy = item.matchedBy || "task:export_default";
        item.templateUserSelected = false;
        if (!item.message || String(item.message || "").includes("待匹配模板")) {
          item.message = "模板已自动命中（task:export_default）";
        }
      });
    }

    async function saveWorkspaceDraft() {
      const taskId = String((state.taskContext && state.taskContext.id) || "").trim();
      if (!taskId) return;
      const payload = buildWorkspaceDraftPayload();
      try {
        await upsertTaskWorkspaceDraftApi(taskId, payload);
      } catch (error) {
        appendLog(`草稿保存失败：${error.message || "unknown"}`);
      }
    }

    async function loadWorkspaceDraft() {
      const taskId = String((state.taskContext && state.taskContext.id) || "").trim();
      if (!taskId) return;
      try {
        const data = await getTaskWorkspaceDraftApi(taskId);
        const draft = (data && data.draft && typeof data.draft === "object") ? data.draft : {};
        if (Array.isArray(draft.queue) && draft.queue.length) {
          applyWorkspaceDraft(draft);
          appendLog(`已恢复草稿：${draft.queue.length} 条`);
        }
      } catch (error) {
        appendLog(`草稿恢复失败：${error.message || "unknown"}`);
      }
    }

    async function uploadFile(file) {
      const data = await uploadFileApi(file);
      appendLog(`上传成功：${data.file_name || file.name} -> ${data.file_id}`);
      return data;
    }

    const {
      runOcr,
      runExtract,
      runInstrumentTableExtract,
      runGeneralCheckStructureExtract,
      runDocxEmbeddedInspect,
      applyStructuredMeasurementItems,
      runTemplateMatch,
      runTemplateFeedback,
      runExcelInspect,
      runExcelPreview,
      runTemplateTextPreview,
      runTemplateEditorSchema,
    } = createRuntimeApisFeature({
      runOcrApi,
      runExtractApi,
      runInstrumentTableExtractApi,
      runGeneralCheckStructureExtractApi,
      runDocxEmbeddedInspectApi,
      runTemplateMatchApi,
      runTemplateFeedbackApi,
      runExcelInspectApi,
      runExcelPreviewApi,
      runTemplateTextPreviewApi,
      runTemplateEditorSchemaApi,
      parseTableRowsFromBlock: (text) => parseTableRowsFromBlock(text),
    });

    const {
      hasMeaningfulValue,
      countMeasurementItems,
      resolveTemplateGenerationRule,
      resolveTemplateRequiredFields,
      validateItemForGeneration,
    } = createMatchingValidationFeature({
      TEMPLATE_GENERATION_RULES,
      TEMPLATE_REQUIRED_FIELDS,
      normalizeValidationToken,
    });

    function applyIncompleteState(item, validation) {
      if (!item || !validation || validation.ok) return;
      item.reportId = "";
      item.reportDownloadUrl = "";
      item.reportFileName = "";
      item.reportGenerateMode = "";
      item.modeReports = {};
      item.status = "incomplete";
      item.message = buildCategoryMessage(item, `待补全：${validation.summary}`);
    }

    const {
      inferCategory,
      resolveSourceProfileLabel,
      buildCategoryMessage,
      persistTemplateDefaultMapping,
      applyAutoTemplateMatch,
    } = createMatchingWorkflowFeature({
      state,
      extFromName,
      isExcelExt,
      isExcelItem,
      runTemplateMatch,
      runTemplateFeedback,
      resolveBlankTemplateName,
      validateItemForGeneration,
      applyIncompleteState,
      appendLog,
      getTaskDefaultTemplateName,
    });

    const {
      parseSupplementalPairs,
      splitRecordBlocks,
      parseDeviceGroupSummary,
      looksLikeMeasurementStandardGroup,
      buildMultiDeviceWordItems,
      buildExcelRecordItems,
    } = createSourceSplittingFeature({
      createEmptyFields,
      extractTemplateCode,
      buildCategoryMessage,
      resolveSourceProfileLabel,
    });

    const { processItem } = createRecognitionWorkflowFeature({
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
      runDocxEmbeddedInspect,
      runExtract,
      applyStructuredMeasurementItems,
      inferCategory,
      extractTemplateCode,
      buildCategoryMessage,
      resolveSourceCode,
      buildMultiDeviceWordItems,
    });

    const { processAllPending, refreshActiveRecognition } = createRecognitionBatchFeature({
      state,
      isExcelItem,
      isExcelExt,
      extFromName,
      processItem,
      setStatus,
      setLoading,
      setPreprocessProgress,
      clearPreprocessProgress,
      renderQueue,
      renderTemplateSelect,
      appendLog,
      runExcelInspect,
      buildExcelRecordItems,
      applyAutoTemplateMatch,
      createEmptyFields,
      runExtract,
      resolveSourceCode,
      inferCategory,
    });

    const { generateItem } = createGenerationWorkflowFeature({
      state,
      isExcelItem,
      uploadFile,
      processItem,
      ensureSourceFileId,
      renderQueue,
      validateItemForGeneration,
      buildCategoryMessage,
      fetchJson,
      persistTemplateDefaultMapping,
    });

    const { generateAllReady, triggerDownload, exportAll, runExcelBatch, authorizeDownloadWindow } = createGenerationBatchFeature({
      state,
      isExcelItem,
      processItem,
      applyAutoTemplateMatch,
      validateItemForGeneration,
      applyIncompleteState,
      generateItem,
      renderQueue,
      renderTemplateSelect,
      setLoading,
      setStatus,
      appendLog,
      fetchJson,
      uploadFile,
    });

    function revokeBlobUrl(kind) {
      const url = state.blobUrls[kind];
      if (url) {
        URL.revokeObjectURL(url);
        state.blobUrls[kind] = "";
      }
    }

    function setPreviewPlaceholder(elId, text) {
      $(elId).innerHTML = `<div class="placeholder">${escapeHtml(text)}</div>`;
    }

    const { ensureDocxLib, renderDocx } = createDocxPreviewFeature({
      $,
      state,
      setPreviewPlaceholder,
      appendLog,
      localJszipUrls: LOCAL_JSZIP_URLS,
      externalJszipUrls: EXTERNAL_JSZIP_URLS,
      localDocxPreviewUrls: LOCAL_DOCX_PREVIEW_URLS,
      externalDocxPreviewUrls: EXTERNAL_DOCX_PREVIEW_URLS,
      localDocxPreviewCssUrls: LOCAL_DOCX_PREVIEW_CSS_URLS,
      externalDocxPreviewCssUrls: EXTERNAL_DOCX_PREVIEW_CSS_URLS,
    });

    async function ensureSourceFileId(item) {
      if (!item) return "";
      if (item.fileId) return item.fileId;
      if (!item.file) return "";
      const up = await uploadFile(item.file);
      item.fileId = up.file_id;
      return item.fileId;
    }

    function getFieldLabel(key) {
      const normalized = String(key || "").trim();
      if (!normalized) return "";
      return SOURCE_FIELD_LABELS[normalized] || normalized;
    }

    function ensureTemplateEditorSchema(templateName, expectedItemId = "") {
      const normalized = String(templateName || "").trim();
      if (!normalized) return;
      if (Object.prototype.hasOwnProperty.call(state.editorSchemaByTemplate, normalized)) return;
      state.editorSchemaByTemplate[normalized] = { loading: true, editor_schema: null };
      runTemplateEditorSchema(normalized).then((data) => {
        state.editorSchemaByTemplate[normalized] = {
          loading: false,
          editor_schema: (data && data.editor_schema) || null,
        };
      }).catch(() => {
        state.editorSchemaByTemplate[normalized] = { loading: false, editor_schema: null };
      }).finally(() => {
        const active = getActiveItem();
        if (!active) return;
        if (expectedItemId && active.id !== expectedItemId) return;
        renderTargetFieldForm(active);
      });
    }

    const { resolveTargetFormFields, getProblemFieldKeys } = createFormSchemaFeature({
      state,
      TARGET_BASIC_FORM_FIELDS,
      ensureTemplateEditorSchema,
      hasMeaningfulValue,
      resolveTemplateRequiredFields,
    });

    const {
      extractMeasurementItemsBlockText,
      normalizeMeasurementItemsText,
      shouldRebuildMeasurementItemsFromRaw,
      parseTableRowsFromBlock,
      renderStructuredTableHtml,
      buildFallbackMeasurementRows,
      getMeasurementHeaderIndexes,
      buildMeasurementCatalogMatchInfo,
      parseKeyValueRowsFromBlock,
      parseListLinesFromBlock,
    } = createMeasurementTableFeature({
      extractBlockByLine,
      normalizeValidationToken,
      renderRichCellHtml,
    });

    const safeNormalizeMeasurementItemsText = typeof normalizeMeasurementItemsText === "function"
      ? normalizeMeasurementItemsText
      : ((item, fields) => {
        const block = typeof extractMeasurementItemsBlockText === "function"
          ? extractMeasurementItemsBlockText(item, fields)
          : String((fields && fields.measurement_items) || "");
        if (!block) return "";
        const tableRows = parseTableRowsFromBlock(String(block || ""));
        if (tableRows && tableRows.length >= 2) return tableRows.map((row) => row.join("\t")).join("\n");
        return String(block || "");
      });

    const safeShouldRebuildMeasurementItemsFromRaw = typeof shouldRebuildMeasurementItemsFromRaw === "function"
      ? shouldRebuildMeasurementItemsFromRaw
      : (() => true);

    const {
      parseGeneralCheckRowsFromBlock,
      buildGeneralCheckWysiwygData,
      renderGeneralCheckWysiwygBlock,
      renderStructuredBlockHtml,
      extractGeneralCheckBlockFromItem,
      extractGeneralCheckFullBlock,
      maybeCopyGeneralCheckForBlankTemplate,
    } = createGeneralCheckFeature({
      createEmptyFields,
      cleanBlockText,
      renderRichCellHtml,
      escapeHtml,
      hasDocxImageToken,
      collectDocxImageTokens,
      parseTableRowsFromBlock,
      renderStructuredTableHtml,
      parseKeyValueRowsFromBlock,
      parseListLinesFromBlock,
      extractAllBlocksByLine,
      extractBlockByLine,
      enrichGeneralCheckWithDocxImages,
    });

    const {
      extractCalibrationInfoFields,
      renderFocusSectionsHtml,
    } = createFocusSectionsFeature({
      extractBlockByLine,
      normalizeOptionalBlank,
      parseDateFromLabelText,
      isCompleteDateText,
      cleanBlockText,
      parseDateParts,
      escapeHtml,
      escapeAttr,
      renderGeneralCheckWysiwygBlock,
      renderStructuredBlockHtml,
    });

    const { renderSourceFieldList, renderTargetFieldForm, applyTargetFieldProblemStyles } = createFormRenderingFeature({
      $,
      state,
      TARGET_EDIT_GROUPS,
      MULTI_EDIT_DISABLED_FIELD_KEYS,
      MULTI_EDIT_MIXED_PLACEHOLDER,
      createEmptyFields,
      getSelectedNormalItems,
      getProblemFieldKeys,
      renderFocusSectionsHtml,
      extractCalibrationInfoFields,
      isCompleteDateText,
      extractGeneralCheckFullBlock,
      safeShouldRebuildMeasurementItemsFromRaw,
      safeNormalizeMeasurementItemsText,
      resolveTargetFormFields,
      getSharedFieldValue,
      parseTableRowsFromBlock,
      buildFallbackMeasurementRows,
      buildMeasurementCatalogMatchInfo,
      getMeasurementHeaderIndexes,
      renderGeneralCheckWysiwygBlock,
      isTargetMultiEditMode,
      parseDateParts,
      escapeHtml,
      escapeAttr,
    });

    const { renderSourcePreview, renderTargetPreview, renderPreviews } = createPreviewWorkflowFeature({
      $,
      state,
      fetchBlob,
      runExcelPreview,
      runTemplateTextPreview,
      runDocxEmbeddedInspect,
      getActiveItem,
      getGenerateMode,
      getSelectedNormalItems,
      updateSourceDeviceNameText,
      renderSourceFieldList,
      renderTargetFieldForm,
      setPreviewPlaceholder,
      revokeBlobUrl,
      extFromName,
      ensureSourceFileId,
      renderDocx,
      escapeHtml,
      escapeAttr,
      toDateOnlyDisplay,
      ensureDocxLib,
    });

    const { bindEvents } = createBindEventsFeature({
      $,
      state,
      FILTER_BLANK_TOKEN,
      MULTI_EDIT_DISABLED_FIELD_KEYS,
      createEmptyFields,
      appendLog,
      applyIncompleteState,
      applyTargetFieldProblemStyles,
      buildCategoryMessage,
      buildGeneralCheckWysiwygData,
      clearPreprocessProgress,
      cleanBlockText,
      createQueueItem,
      ensureTemplateEditorSchema,
      exportAll,
      generateAllReady,
      generateItem,
      getActiveItem,
      getColumnFilterOptionEntries,
      getFilteredSortedQueue,
      getGenerateMode,
      getSelectedNormalItems,
      inferCategory,
      inferDateTriplet,
      isCompleteDateText,
      shiftDateText,
      isSupportedFile,
      isTargetMultiEditMode,
      isTypingTarget,
      maybeCopyGeneralCheckForBlankTemplate,
      navigateActiveItem,
      parseTableRowsFromBlock,
      processAllPending,
      refreshActionButtons,
      refreshActiveRecognition,
      refreshTargetFieldFormBySelection,
      renderPreviews,
      renderQueue,
      renderSourceFieldList,
      renderSourcePreview,
      renderTargetFieldForm,
      renderTargetPreview,
      renderTemplateSelect,
      resolveBlankTemplateName,
      runExcelBatch,
      setLoading,
      setPreviewFullscreen,
      setPreviewPlaceholder,
      setRightViewMode,
      setSourceViewMode,
      setStatus,
      updateTaskStatusApi,
      saveWorkspaceDraft,
      syncGenerateModeUiText,
      triggerDownload,
      authorizeDownloadWindow,
      updateSelectedCountText,
      updateSourceDeviceNameText,
      validateItemForGeneration,
      extFromName,
    });

    (async function init() {
      setLoading(true, "初始化...");
      try {
        await loadRuntimeConfig();
        await loadTemplates();
        await loadSignatures();
        await loadTaskContext();
        await loadWorkspaceDraft();
        applyTaskDefaultTemplateToQueueItems();
        try {
          bindEvents();
        } catch (bindError) {
          appendLog(`事件绑定异常：${bindError.message || "unknown"}`);
        }
        renderQueue();
        renderTemplateSelect();
        const active = getActiveItem();
        if (active) {
          renderSourceFieldList(active);
          renderTargetFieldForm(active);
          applyTargetFieldProblemStyles(active);
          await renderPreviews();
        } else {
          setPreviewPlaceholder("sourcePreview", "来源预览未加载");
          $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
          $("targetFieldForm").innerHTML = '<div class="placeholder">字段表单未加载</div>';
          setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        }
        setStatus("就绪");
        const onExitSave = () => { void saveWorkspaceDraft(); };
        window.addEventListener("pagehide", onExitSave);
        window.addEventListener("beforeunload", onExitSave);
      } catch (error) {
        setStatus(`初始化失败：${error.message || "unknown"}`);
      } finally {
        setLoading(false);
      }
    })();
