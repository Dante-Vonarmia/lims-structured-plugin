export function createSourceSplittingFeature(deps = {}) {
  const {
    createEmptyFields,
    extractTemplateCode,
    buildCategoryMessage,
    resolveSourceProfileLabel,
  } = deps;

  function normalizeExtraKey(key) {
    return String(key || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
  }

  const EXTRA_HIDDEN_KEYS = new Set([
    "devicename", "device_model", "devicemodel", "devicecode", "manufacturer", "unitname", "address",
    "powerrating", "manufacturedate", "contactinfo", "measurementitems", "measurementitemcount", "rawrecord",
    "器具名称", "设备名称", "仪器名称", "型号规格", "型号", "编号", "器具编号", "设备编号",
    "生产厂商", "制造厂商", "厂家", "厂商", "使用部门", "单位名称", "地址", "电源功率", "制造日期", "生产日期",
    "联系方式", "检测项数",
  ]);

  function parseSupplementalPairs(item) {
    const raw = String((item && item.fields && item.fields.raw_record) || (item && item.rawText) || "");
    if (!raw) return [];
    const pairs = [];
    const seen = new Set();
    raw.split("\n").map((x) => x.trim()).filter(Boolean).forEach((line) => {
      const match = line.match(/^([^:：]{1,80})[:：]\s*(.+)$/);
      if (!match) return;
      const key = match[1].trim();
      const value = match[2].trim();
      if (!key || !value) return;
      const normalizedKey = normalizeExtraKey(key);
      if (!normalizedKey || EXTRA_HIDDEN_KEYS.has(normalizedKey)) return;
      const dedupeKey = `${normalizedKey}::${value}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      pairs.push([key, value]);
    });
    return pairs;
  }

  function splitRecordBlocks(rawText) {
    const text = String(rawText || "").replace(/\r/g, "");
    if (!text.trim()) return [];
    const marker = /(设备名称|器具名称|仪器名称|设备名)\s*[:：]?/g;
    const starts = [];
    let match;
    while ((match = marker.exec(text)) !== null) {
      starts.push(match.index);
    }
    if (starts.length <= 1) {
      const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
      const softStarts = [];
      const deviceNameLike = /(试验仪|高温箱|电桥|局放仪|击穿|伸长|冲击|老化|温度|耐压|绝缘)/;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.length < 3 || line.length > 40) continue;
        if (!deviceNameLike.test(line)) continue;
        const prev = i > 0 ? lines[i - 1] : "";
        if (/(单位名称|地址|联系方式|电话)/.test(prev)) continue;
        softStarts.push(i);
      }
      if (softStarts.length <= 1) return [text];
      const blocks = [];
      for (let i = 0; i < softStarts.length; i += 1) {
        const from = softStarts[i];
        const to = i + 1 < softStarts.length ? softStarts[i + 1] : lines.length;
        const chunk = lines.slice(from, to).join("\n").trim();
        if (chunk) blocks.push(chunk);
      }
      return blocks.length ? blocks : [text];
    }
    const blocks = [];
    for (let i = 0; i < starts.length; i += 1) {
      let from = starts[i];
      const to = i + 1 < starts.length ? starts[i + 1] : text.length;
      const lookback = text.slice(Math.max(0, from - 220), from);
      const lbLines = lookback.split("\n");
      let offset = 0;
      for (let j = lbLines.length - 1; j >= 0; j -= 1) {
        const raw = lbLines[j] || "";
        const line = raw.trim();
        offset += raw.length + 1;
        if (!line) continue;
        if (/^(?:\d+|[一二三四五六七八九十]+)[、.．)]/.test(line)) break;
        if (/(有限公司|厂商|厂家|制造|联系方式|电话|单位名称|地址)/.test(line)) {
          from = Math.max(0, from - offset);
          break;
        }
        if (offset > 120) break;
      }
      const chunk = text.slice(from, to).trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  function parseDeviceGroupSummary(summaryText) {
    const lines = String(summaryText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const rows = [];
    lines.forEach((line) => {
      const match = line.match(/^\s*\d+\.\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/);
      if (!match) return;
      const normalize = (value) => {
        const text = String(value || "").trim();
        if (!text || text === "-" || text === "—") return "";
        return text;
      };
      const name = normalize(match[1]);
      const model = normalize(match[2]);
      const code = normalize(match[3]);
      if (!name) return;
      rows.push({ name, model, code });
    });
    return rows;
  }

  function looksLikeMeasurementStandardGroup(group, allGroups = []) {
    const name = String((group && group.name) || "").trim();
    const model = String((group && group.model) || "").trim();
    const code = String((group && group.code) || "").trim();
    if (!name) return true;

    const standardNameLike = /(数字温度表|热电偶|铜卷尺|标准器具|测量范围|溯源机构|证书编号|有效期限|measurement\s*range|traceability|certificate\s*number)/i;
    const hasColon = /[:：]/.test(name);
    const noModel = !model || model === "-" || model === "—";

    let duplicateCode = false;
    if (code) {
      const count = allGroups.filter((x) => String((x && x.code) || "").trim() === code).length;
      duplicateCode = count >= 2;
    }

    if (hasColon && noModel && duplicateCode) return true;
    if (standardNameLike.test(name) && noModel && (duplicateCode || !code)) return true;
    return false;
  }

  function buildMultiDeviceWordItems(sourceItem, baseFields) {
    const groups = parseDeviceGroupSummary(baseFields && baseFields.device_group_summary);
    if (groups.length < 2) return [];
    const filteredGroups = groups.filter((g) => !looksLikeMeasurementStandardGroup(g, groups));
    if (filteredGroups.length < 2) return [];
    const sharedFields = {};
    ["manufacturer", "unit_name", "address", "client_name", "certificate_no", "receive_date", "calibration_date", "release_date"].forEach((key) => {
      const value = String((baseFields && baseFields[key]) || "").trim();
      if (value) sharedFields[key] = value;
    });
    return filteredGroups.map((group, idx) => {
      const rowNumber = idx + 1;
      const rowRawRecord = [
        `器具名称: ${group.name || (baseFields && baseFields.device_name) || ""}`,
        `型号规格: ${group.model || ""}`,
        `器具编号: ${group.code || ""}`,
      ].join("\n");
      const fields = {
        ...createEmptyFields(),
        ...sharedFields,
        device_name: group.name || (baseFields && baseFields.device_name) || "",
        device_model: group.model || "",
        device_code: group.code || "",
        source_profile: "multi_device_baseinfo_word_split",
        source_profile_label: "多基础信息Word-拆分",
        device_group_count: "1",
        device_group_summary: "",
        raw_record: rowRawRecord,
      };
      const category = fields.device_name || `第${rowNumber}组`;
      const recordName = fields.device_name || fields.device_code || `group_${rowNumber}`;
      return {
        id: `${sourceItem.id}-g${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
        file: sourceItem.file,
        fileName: sourceItem.fileName,
        sourceFileName: sourceItem.sourceFileName || sourceItem.fileName,
        recordName,
        rowNumber,
        sheetName: "",
        isRecordRow: true,
        sourceType: sourceItem.sourceType,
        fileId: sourceItem.fileId,
        rawText: rowRawRecord,
        sourceCode: extractTemplateCode(`${sourceItem.fileName || ""}\n${fields.device_name || ""}\n${fields.device_model || ""}\n${fields.device_code || ""}`),
        recordCount: 1,
        category,
        fields,
        recognizedFields: { ...fields },
        templateName: "",
        matchedBy: "",
        templateUserSelected: false,
        status: "ready",
        message: buildCategoryMessage({ category, fields }, "已按多器具分组拆分，待匹配模板"),
        reportId: "",
        reportDownloadUrl: "",
        reportFileName: "",
        reportGenerateMode: "",
        modeReports: {},
        generalCheckStruct: sourceItem.generalCheckStruct || null,
      };
    });
  }

  function buildExcelRecordItems(sourceItem, inspect) {
    const records = Array.isArray(inspect && inspect.records) ? inspect.records : [];
    return records.map((rec, idx) => {
      const fields = { ...createEmptyFields(), ...(rec.fields || {}) };
      const templateName = String(rec.template_name || "").trim();
      const rowNumber = Number(rec.row_number || 0) || (idx + 1);
      const sheetName = String(rec.sheet_name || "").trim();
      const rowName = String(rec.row_name || "").trim();
      const recordName = rowName || fields.device_name || fields.device_code || `第${rowNumber}条`;
      return {
        id: `${sourceItem.id}-r${rowNumber}-${Math.random().toString(16).slice(2, 8)}`,
        file: sourceItem.file,
        fileName: sourceItem.fileName,
        sourceFileName: sourceItem.sourceFileName || sourceItem.fileName,
        recordName,
        rowNumber,
        sheetName,
        isRecordRow: true,
        sourceType: sourceItem.sourceType,
        fileId: sourceItem.fileId,
        rawText: fields.raw_record || "",
        sourceCode: "",
        recordCount: 1,
        category: fields.device_name || "Excel记录",
        fields,
        recognizedFields: { ...fields },
        templateName,
        matchedBy: templateName ? "excel:auto" : "",
        templateUserSelected: false,
        status: "ready",
        message: templateName
          ? `记录${rowNumber} 识别完成（形态:${resolveSourceProfileLabel({ fields }) || "Excel行"}），模板已匹配`
          : `记录${rowNumber} 识别完成（形态:${resolveSourceProfileLabel({ fields }) || "Excel行"}），待匹配模板`,
        reportId: "",
        reportDownloadUrl: "",
        reportFileName: "",
        reportGenerateMode: "",
        modeReports: {},
      };
    });
  }

  return {
    parseSupplementalPairs,
    splitRecordBlocks,
    parseDeviceGroupSummary,
    looksLikeMeasurementStandardGroup,
    buildMultiDeviceWordItems,
    buildExcelRecordItems,
  };
}
