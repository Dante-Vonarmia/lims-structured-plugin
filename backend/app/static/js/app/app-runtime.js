import {
  autoLoadInstrumentCatalogApi,
  fetchBlob,
  fetchJson,
  listTemplatesApi,
  loadRuntimeConfigApi,
  parseInstrumentCatalogApi,
  runExcelInspectApi,
  runExcelPreviewApi,
  runExtractApi,
  runGeneralCheckStructureExtractApi,
  runInstrumentTableExtractApi,
  runOcrApi,
  runTemplateEditorSchemaApi,
  runTemplateFeedbackApi,
  runTemplateMatchApi,
  runTemplateTextPreviewApi,
  uploadFileApi,
} from "../infra/api/client.js";
import {
  EXTERNAL_DOCX_PREVIEW_CSS_URLS,
  EXTERNAL_DOCX_PREVIEW_URLS,
  EXTERNAL_JSZIP_URLS,
  FILTER_BLANK_TOKEN,
  LOCAL_DOCX_PREVIEW_CSS_URLS,
  LOCAL_DOCX_PREVIEW_URLS,
  LOCAL_JSZIP_URLS,
  SOURCE_FIELD_LABELS,
  SOURCE_FORM_FIELDS,
  SOURCE_HIDDEN_SYSTEM_KEYS,
  SOURCE_RECOGNITION_CORE_KEYS,
  SUPPORTED_EXTS,
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
import { createCatalogRenderingFeature } from "./features/catalog/rendering.js";
import { createCatalogWorkflowFeature } from "./features/catalog/workflow.js";
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
  normalizeCatalogToken,
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
        fileId: "",
        rawText: "",
        sourceCode: "",
        recordCount: 0,
        category: "",
        fields: createEmptyFields(),
        recognizedFields: createEmptyFields(),
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
      $("batchLog").textContent += `\n${line}`;
      $("batchLog").scrollTop = $("batchLog").scrollHeight;
    }

    function setStatus(text) {
      const raw = String(text || "").trim();
      const loadedMatch = raw.match(/计量标准器具目录已装填[:：]?\s*(\d+)\s*项/);
      if (loadedMatch) { $("globalStatus").textContent = "就绪"; return; }
      if (/计量标准器具目录已清除/.test(raw)) {
        $("globalStatus").textContent = "就绪";
        return;
      }
      $("globalStatus").textContent = raw || "";
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

    function statusLabel(s) {
      return {
        pending: "待处理",
        processing: "处理中",
        ready: "可生成",
        incomplete: "待补全",
        generated: "已生成",
        confirmed: "已确认",
        error: "失败",
      }[s] || s;
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
    const MULTI_EDIT_DISABLED_FIELD_KEYS = new Set(["measurement_items", "general_check_full"]);

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
      renderMeasurementCatalogNameOptions,
    } = createRuntimeListUiFeature({
      $,
      state,
      FILTER_BLANK_TOKEN,
      toDateOnlyDisplay,
      getModelCodeDisplay,
      getDeviceCodeDisplay,
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
      setFullscreenButtonUi,
      resolveBlankTemplateName,
      isExcelItem,
    });

    const { renderCatalogReadyHint, renderInstrumentCatalogDetailContent, setCatalogDetailVisible } = createCatalogRenderingFeature({
      $,
      state,
      escapeHtml,
      escapeAttr,
    });

    const {
      loadRuntimeConfig,
      loadTemplates,
      uploadFile,
      setInstrumentCatalog,
      parseInstrumentCatalog,
      autoLoadInstrumentCatalog,
    } = createCatalogWorkflowFeature({
      $,
      state,
      setButtonText,
      isPlaceholderValue: (value) => isPlaceholderValue(value),
      normalizeCatalogToken,
      renderCatalogReadyHint,
      renderMeasurementCatalogNameOptions,
      getActiveItem,
      getRenderTargetFieldForm: () => renderTargetFieldForm,
      getApplyTargetFieldProblemStyles: () => applyTargetFieldProblemStyles,
      getRenderQueue: () => renderQueue,
      renderTemplateSelect,
      appendLog,
      loadRuntimeConfigApi,
      listTemplatesApi,
      uploadFileApi,
      parseInstrumentCatalogApi,
      autoLoadInstrumentCatalogApi,
    });

    const {
      runOcr,
      runExtract,
      runInstrumentTableExtract,
      runGeneralCheckStructureExtract,
      applyStructuredMeasurementItems,
      runTemplateMatch,
      runTemplateFeedback,
      runExcelInspect,
      runExcelPreview,
      runTemplateTextPreview,
      runTemplateEditorSchema,
      isDeviceNameAllowedByCatalog,
    } = createRuntimeApisFeature({
      state,
      normalizeCatalogToken,
      runOcrApi,
      runExtractApi,
      runInstrumentTableExtractApi,
      runGeneralCheckStructureExtractApi,
      runTemplateMatchApi,
      runTemplateFeedbackApi,
      runExcelInspectApi,
      runExcelPreviewApi,
      runTemplateTextPreviewApi,
      runTemplateEditorSchemaApi,
      parseTableRowsFromBlock: (text) => parseTableRowsFromBlock(text),
    });

    const {
      isPlaceholderValue,
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
      runExtract,
      applyStructuredMeasurementItems,
      inferCategory,
      extractTemplateCode,
      buildCategoryMessage,
      resolveSourceCode,
      buildMultiDeviceWordItems,
    });

    const { processAllPending, refreshAllRecognition } = createRecognitionBatchFeature({
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

    const { generateAllReady, triggerDownload, exportAll, runExcelBatch } = createGenerationBatchFeature({
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
      state,
      extractBlockByLine,
      normalizeCatalogToken,
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
      buildFocusSections,
      renderFocusSectionsHtml,
    } = createFocusSectionsFeature({
      SOURCE_HIDDEN_SYSTEM_KEYS,
      extractBlockByLine,
      normalizeOptionalBlank,
      parseDateFromLabelText,
      isCompleteDateText,
      inferDateTriplet,
      cleanBlockText,
      safeNormalizeMeasurementItemsText,
      parseTableRowsFromBlock,
      extractGeneralCheckFullBlock,
      getFieldLabel,
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
      buildFocusSections,
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
      getMeasurementHeaderIndexes,
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
      normalizeCatalogToken,
      parseInstrumentCatalog,
      parseTableRowsFromBlock,
      processAllPending,
      refreshActionButtons,
      refreshAllRecognition,
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
      setCatalogDetailVisible,
      setInstrumentCatalog,
      setLoading,
      setPreviewFullscreen,
      setPreviewPlaceholder,
      setRightViewMode,
      setSourceViewMode,
      setStatus,
      syncGenerateModeUiText,
      triggerDownload,
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
        try {
          bindEvents();
        } catch (bindError) {
          appendLog(`事件绑定异常：${bindError.message || "unknown"}`);
        }
        await autoLoadInstrumentCatalog();
        renderQueue();
        setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
        $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
        setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
        setStatus("就绪");
      } catch (error) {
        setStatus(`初始化失败：${error.message || "unknown"}`);
      } finally {
        setLoading(false);
      }
    })();
