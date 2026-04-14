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

  const DATA_ROW_RE = /^\s*[zZ]?\d{1,2}(?:\s*[./-]\s*\d{1,2})?\b/;

  function getSchemaColumns() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { columns: [] };
    return Array.isArray(schema.columns) ? schema.columns : [];
  }

  function getSchemaRules() {
    const schema = (state.taskContext && state.taskContext.import_template_schema && typeof state.taskContext.import_template_schema === "object")
      ? state.taskContext.import_template_schema
      : { rules: {} };
    const rules = (schema && typeof schema.rules === "object" && schema.rules) ? schema.rules : {};
    return rules;
  }

  function splitTableDataLines(rawText, rules = {}) {
    const lines = String(rawText || "")
      .split(/\r?\n/)
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const rowRules = (rules && typeof rules.row_rules === "object" && rules.row_rules) ? rules.row_rules : {};
    const minTokens = Number(rowRules.min_tokens || 6);
    const dataOnly = lines.filter((line) => {
      if (!DATA_ROW_RE.test(line)) return false;
      const tokens = line.split(/\s+/).filter(Boolean);
      return tokens.length >= minTokens;
    });
    if (dataOnly.length) return dataOnly;
    return [];
  }

  function mapLineToSchemaFields(line, columns, rules = {}) {
    const cols = Array.isArray(columns) ? columns : [];
    const rawLine = String(line || "").trim();
    const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
    const getFieldRule = (label, key) => {
      const byLabel = fieldRules[String(label || "").trim()];
      if (byLabel && typeof byLabel === "object") return byLabel;
      const byKey = fieldRules[String(key || "").trim()];
      return byKey && typeof byKey === "object" ? byKey : {};
    };
    const detectValveSelection = (rule = {}) => {
      const choices = Array.isArray(rule.choices) ? rule.choices : [];
      const matched = choices.filter((choice) => {
        const tokens = Array.isArray(choice && choice.tokens) ? choice.tokens : [];
        return tokens.some((token) => {
          const text = String(token || "").trim();
          return text && rawLine.includes(text);
        });
      });
      if (matched.length > 1) return String(rule.multi_label || "").trim() || matched.map((x) => String(x.label || "").trim()).filter(Boolean).join("/");
      if (matched.length === 1) return String((matched[0] && matched[0].label) || "").trim();
      const hasCal = /(校阀|校调|校調|收阀|收调|政调|农调|回校)/i.test(rawLine);
      const hasSwap = /(换阀|換阀|换间|换询|换具|换惘|換間|换网)/i.test(rawLine);
      if (hasCal && hasSwap) return "校阀/换阀";
      if (hasCal) return "校阀";
      if (hasSwap) return "换阀";
      return "";
    };
    const detectDate = () => {
      const m = rawLine.match(/\b([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})\b/);
      if (!m) return "";
      const mm = String(m[1] || "").replace(/^[zZ]/, "2");
      const dd = String(m[2] || "");
      return `${mm}.${dd}`;
    };
    const normalizeDateToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      const m = t.match(/([zZ]?\d{1,2})\s*[.\-/、]\s*(\d{1,2})/);
      if (!m) return "";
      const mm = String(m[1] || "").replace(/^[zZ]/, "2");
      const dd = String(m[2] || "");
      return `${mm}.${dd}`;
    };
    const normalizeTextToken = (token, rule = {}) => {
      let t = String(token || "").trim();
      const normalize = (rule && typeof rule.normalize === "object" && rule.normalize) ? rule.normalize : {};
      if (normalize.fullwidth_to_halfwidth) {
        t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/\u3000/g, " ");
      }
      if (normalize.o_to_0) t = t.replace(/[oO]/g, "0");
      if (normalize.l_to_1) t = t.replace(/[lI]/g, "1");
      if (normalize.trim !== false) t = t.trim();
      return t;
    };
    const cleaned = rawLine
      .replace(/(口|回|□|▢)?\s*(校阀|校调|校調|收阀|收调|政调|农调|回校)\s*/gi, " ")
      .replace(/(口|回|□|▢)?\s*(换阀|換阀|换间|换询|换具|换惘|換間|换网)\s*/gi, " ")
      .replace(/[√✓]/g, " V ")
      .replace(/[，,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const mapped = {};
    if (!cols.length || !tokens.length) return mapped;
    const dateText = detectDate();
    const isNumericLikeLabel = (label) => {
      const x = String(label || "");
      return /(MPa|kg|mL|mm|min|%|重量|容积|压力|时间|变形|损失率|壁厚|日期)/i.test(x);
    };
    const normalizeNumericToken = (token) => {
      const t = String(token || "").trim();
      if (!t) return "";
      let x = t
        .replace(/[oO]/g, "0")
        .replace(/[lI]/g, "1")
        .replace(/[，]/g, ".")
        .replace(/。/g, ".")
        .replace(/[^\d.+\-]/g, "");
      if (!x) return "";
      x = x.replace(/^\.+/, "").replace(/\.+$/, "");
      return x;
    };
    const nextToken = (() => {
      let idx = 0;
      return (opts = {}) => {
        const allowMarkers = !!opts.allowMarkers;
        while (idx < tokens.length) {
          const t = String(tokens[idx] || "").trim();
          idx += 1;
          if (!t) continue;
          if (!allowMarkers && (t === "V" || t === "v" || t === "/" || t === "／" || t === "\\" || t === "＼")) continue;
          return t;
        }
        return "";
      };
    })();
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i] || {};
      const key = String(col.key || "").trim();
      const label = String(col.label || "").trim();
      const rule = getFieldRule(label, key);
      const ruleType = String(rule.type || "").trim();
      if (!key) continue;
      if (ruleType === "date" || label === "检验日期") {
        const token = nextToken({ allowMarkers: true });
        mapped[key] = normalizeDateToken(token) || dateText || "";
        continue;
      }
      if (ruleType === "date_or_dash" || label === "上次检验日期") {
        const token = nextToken({ allowMarkers: true });
        const dashTokens = Array.isArray(rule.dash_tokens) ? rule.dash_tokens.map((x) => String(x || "")).filter(Boolean) : ["/", "／", "\\", "＼"];
        const dashHit = dashTokens.some((mark) => token === mark);
        mapped[key] = dashHit ? "-" : (normalizeDateToken(token) || "");
        continue;
      }
      if (ruleType === "checkbox_choice" || label === "瓶阀检验") {
        mapped[key] = detectValveSelection(rule) || "";
        continue;
      }
      if (ruleType === "optional_blank" || label === "检验员" || label === "审核员") {
        mapped[key] = "";
        continue;
      }
      if (ruleType === "code" || ruleType === "loose_text" || label === "产权代码编号") {
        const token = nextToken();
        const normalized = normalizeTextToken(token, rule);
        const maxLen = Number(rule.max_len || 16);
        const pattern = String(rule.pattern || "").trim();
        if (pattern) {
          const reg = new RegExp(pattern);
          mapped[key] = reg.test(normalized) ? normalized : "";
        } else {
          mapped[key] = new RegExp(`^[A-Za-z0-9一-龥\\-]{1,${Number.isFinite(maxLen) ? maxLen : 16}}$`).test(normalized) ? normalized : "";
        }
        continue;
      }
      const token = nextToken();
      if (ruleType === "number") {
        mapped[key] = normalizeNumericToken(normalizeTextToken(token, rule)) || "";
        continue;
      }
      if (ruleType === "text") {
        mapped[key] = normalizeTextToken(token, rule);
        continue;
      }
      mapped[key] = isNumericLikeLabel(label) ? (normalizeNumericToken(normalizeTextToken(token, rule)) || token) : normalizeTextToken(token, rule);
    }
    return mapped;
  }

  function applyCarryForwardRows(rows, columns, rules = {}) {
    const items = Array.isArray(rows) ? rows : [];
    const cols = Array.isArray(columns) ? columns : [];
    const fieldRules = (rules && typeof rules.field_rules === "object" && rules.field_rules) ? rules.field_rules : {};
    const carryCols = cols
      .map((col) => {
        const key = String((col && col.key) || "").trim();
        const label = String((col && col.label) || "").trim();
        const byLabel = fieldRules[label];
        const byKey = fieldRules[key];
        const rule = (byLabel && typeof byLabel === "object") ? byLabel : ((byKey && typeof byKey === "object") ? byKey : {});
        return { key, rule };
      })
      .filter((x) => x.key && String((x.rule && x.rule.empty_strategy) || "").trim() === "carry_forward");
    if (!carryCols.length || !items.length) return;
    const cache = {};
    for (let i = 0; i < items.length; i += 1) {
      const row = items[i];
      if (!row || typeof row !== "object") continue;
      row.fields = row.fields && typeof row.fields === "object" ? row.fields : {};
      row.recognizedFields = row.recognizedFields && typeof row.recognizedFields === "object" ? row.recognizedFields : {};
      for (let j = 0; j < carryCols.length; j += 1) {
        const key = carryCols[j].key;
        const value = String((row.recognizedFields[key] ?? row.fields[key] ?? "")).trim();
        if (value) {
          cache[key] = value;
          continue;
        }
        if (cache[key]) {
          row.fields[key] = cache[key];
          row.recognizedFields[key] = cache[key];
        }
      }
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

    item.message = "识别中";
    renderQueue();
    const ocr = await runOcr(item.fileId);
    item.rawText = ocr.raw_text || "";
    item.ocrStructured = (ocr && ocr.structured) || {};
    const schemaColumns = getSchemaColumns();
    const schemaRules = getSchemaRules();
    const structuredRows = Array.isArray(item.ocrStructured && item.ocrStructured.row_records)
      ? item.ocrStructured.row_records
      : [];
    const reviewQueue = Array.isArray(item.ocrStructured && item.ocrStructured.review_queue)
      ? item.ocrStructured.review_queue
      : [];
    if (schemaColumns.length) {
      if (structuredRows.length) {
        const recordRows = structuredRows.map((rowItem, idx) => {
          const rowNumber = Number((rowItem && rowItem.row) || 0) || (idx + 1);
          const rowFields = (rowItem && typeof rowItem.fields === "object" && rowItem.fields) ? rowItem.fields : {};
          const rawRecord = String((rowItem && rowItem.raw_record) || "").trim();
          const mapped = {};
          schemaColumns.forEach((col, colIdx) => {
            const key = String((col && col.key) || "").trim();
            if (!key) return;
            const colKey = `col_${String(colIdx + 1).padStart(2, "0")}`;
            const label = String((col && col.label) || "").trim();
            mapped[key] = String(rowFields[colKey] || rowFields[label] || "").trim();
          });
          const mergedFields = { ...createEmptyFields(), ...mapped, raw_record: rawRecord };
          const firstColKey = String((schemaColumns[0] && schemaColumns[0].key) || "").trim();
          const secondColKey = String((schemaColumns[1] && schemaColumns[1].key) || "").trim();
          const recordName = String(mergedFields[firstColKey] || mergedFields[secondColKey] || `row_${rowNumber}`).trim();
          const rowReviewQueue = reviewQueue.filter((x) => Number((x && x.row) || 0) === rowNumber);
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
            rawText: rawRecord,
            sourceCode: resolveSourceCode({ ...item, fields: mergedFields }),
            recordCount: 1,
            category: inferCategory({ ...item, fields: mergedFields }),
            fields: mergedFields,
            recognizedFields: { ...mergedFields },
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
        });
        for (const row of recordRows) {
          await applyAutoTemplateMatch(row, { force: true });
        }
        const index = state.queue.findIndex((x) => x.id === item.id);
        if (index >= 0) {
          state.queue.splice(index, 1, ...recordRows);
          state.activeId = recordRows[0].id;
        }
        renderQueue();
        renderTemplateSelect();
        appendLog(`结构化表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      const dataLines = splitTableDataLines(item.rawText, schemaRules);
      if (dataLines.length) {
        const recordRows = dataLines.map((line, idx) => {
          const mapped = mapLineToSchemaFields(line, schemaColumns, schemaRules);
          const mergedFields = { ...createEmptyFields(), ...mapped, raw_record: line };
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
        for (const row of recordRows) {
          await applyAutoTemplateMatch(row, { force: true });
        }
        const index = state.queue.findIndex((x) => x.id === item.id);
        if (index >= 0) {
          state.queue.splice(index, 1, ...recordRows);
          state.activeId = recordRows[0].id;
        }
        renderQueue();
        renderTemplateSelect();
        appendLog(`表格拆分完成 ${item.fileName}：${recordRows.length} 行`);
        return;
      }
      item.fields = { ...createEmptyFields(), raw_record: item.rawText || "" };
      item.recognizedFields = { ...item.fields };
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
