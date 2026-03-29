export function createFocusSectionsFeature(deps = {}) {
  const {
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
  } = deps;

  function extractCalibrationInfoFields(raw, src = {}) {
    const normalizedSrc = (src && typeof src === "object") ? src : {};
    const block = extractBlockByLine(
      raw,
      [/(?:其它|其他)校准信息|Calibration Information/i],
      [/(?:一般检查|General inspection)/i, /^备注[:：]?/i, /^结果[:：]?/i, /(?:检测员|校准员|核验员)/],
    );
    const source = block || String(raw || "");
    const fullSource = String(raw || "");
    const pick = (...values) => {
      for (const v of values) {
        const t = normalizeOptionalBlank(v);
        if (t) return t;
      }
      return "";
    };
    const fromPattern = (pattern) => {
      const m = String(source || "").match(pattern);
      if (!m || !m[1]) return "";
      return normalizeOptionalBlank(String(m[1] || "").trim());
    };
    const location = pick(
      normalizedSrc.location,
      fromPattern(/(?:地点|Location)[:：]?\s*([^\n|；;]+)/i),
    );
    const temperature = pick(
      normalizedSrc.temperature ? `${String(normalizedSrc.temperature).trim()}℃` : "",
      fromPattern(/(?:温度|Ambient\s*temperature)[:：]?\s*([^\n|；;]+)/i),
    );
    const humidity = pick(
      normalizedSrc.humidity ? `${String(normalizedSrc.humidity).trim()}%RH` : "",
      fromPattern(/(?:湿度|Relative\s*humidity)[:：]?\s*([^\n|；;]+)/i),
    );
    const other = pick(
      normalizedSrc.calibration_other,
      fromPattern(/(?:^|\n)\s*(?:其它|其他|Others)\s*[:：]\s*([^\n|；;]+)/i),
    );
    const receiveDateFromBlock = parseDateFromLabelText(source, "(?:收\\s*样\\s*日\\s*期|Received\\s*date)");
    const receiveDateFromRaw = parseDateFromLabelText(fullSource, "(?:收\\s*样\\s*日\\s*期|Received\\s*date)");
    const receiveDate = pick(
      isCompleteDateText(normalizedSrc.receive_date) ? normalizedSrc.receive_date : "",
      receiveDateFromBlock,
      receiveDateFromRaw,
      normalizedSrc.receive_date,
    );
    const calibrationDateFromBlock = parseDateFromLabelText(source, "(?:校\\s*准\\s*日\\s*期|Date\\s*for\\s*calibration)");
    const calibrationDateFromRaw = parseDateFromLabelText(fullSource, "(?:校\\s*准\\s*日\\s*期|Date\\s*for\\s*calibration)");
    const calibrationDate = pick(
      isCompleteDateText(normalizedSrc.calibration_date) ? normalizedSrc.calibration_date : "",
      calibrationDateFromBlock,
      calibrationDateFromRaw,
      normalizedSrc.calibration_date,
    );
    const releaseDateFromRaw = parseDateFromLabelText(fullSource, "(?:发\\s*布\\s*日\\s*期|发布日期|Issue\\s*date|Date\\s*of\\s*issue|Date\\s*of\\s*publication)");
    const releaseDate = pick(
      isCompleteDateText(normalizedSrc.release_date) ? normalizedSrc.release_date : "",
      releaseDateFromRaw,
      normalizedSrc.release_date,
    );
    const inferred = inferDateTriplet({ receiveDate, calibrationDate, releaseDate });
    return {
      location,
      temperature: temperature.replace(/\s+/g, ""),
      humidity: humidity.replace(/\s+/g, ""),
      other,
      receiveDate: inferred.receiveDate || "",
      calibrationDate: inferred.calibrationDate || "",
      releaseDate: inferred.releaseDate || "",
    };
  }

  function extractBasisSummary(raw, src = {}) {
    const normalizeCode = (code) => String(code || "")
      .replace(/\s+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\/\s*T\s*/ig, "/T ")
      .trim();
    const collectCodes = (text) => {
      const source = String(text || "");
      if (!source.trim()) return [];
      const list = [];
      const seen = new Set();
      const regex = /([A-Za-z]{1,5}\s*\/\s*T\s*\d+(?:\.\d+)?-\d{4})/ig;
      let m;
      while ((m = regex.exec(source)) !== null) {
        const code = normalizeCode(m[1] || "");
        if (!code || seen.has(code)) continue;
        seen.add(code);
        list.push(code);
      }
      return list;
    };
    const fromArray = Array.isArray(src && src.basis_standard_items) ? src.basis_standard_items : [];
    if (fromArray.length) {
      const arrCodes = collectCodes(fromArray.join("\n"));
      if (arrCodes.length) return arrCodes.join("\n");
    }
    const direct = String((src && (src.basis_standard || src.calibration_basis)) || "").trim();
    if (direct) {
      const directCodes = collectCodes(direct);
      return directCodes.length ? directCodes.join("\n") : direct;
    }
    const text = cleanBlockText(raw);
    if (!text) return "";
    const block = extractBlockByLine(
      text,
      [/(?:本次校准所依据的技术规范|Reference documents for the calibration|检测\/?校准依据|校准依据)/i],
      [/(?:本次校准所使用的主要计量标准器具|Main measurement standard instruments)/i, /(?:其它|其他)校准信息|Calibration Information/i, /(?:一般检查|General inspection)/i, /^备注[:：]?/i, /^结果[:：]?/i, /(?:检测员|校准员|核验员)/],
    );
    const codes = collectCodes(block || text);
    return codes.join("\n");
  }

  function buildFocusSections(item, src, problemKeys, includeExtraRows = true) {
    const normalizedSrc = (src && typeof src === "object") ? src : {};
    const raw = String(
      normalizedSrc.raw_record
      || (item && item.fields && item.fields.raw_record)
      || (item && item.rawText)
      || "",
    );
    const sections = [];
    const mainRows = [
      { key: "certificate_no", label: "缆专检号:", value: String(normalizedSrc.certificate_no || "").trim() },
      { key: "client_name", label: "委托单位:", value: String(normalizedSrc.client_name || normalizedSrc.unit_name || "").trim() },
      { key: "address", label: "地址:", value: String(normalizedSrc.address || "").trim() },
      { key: "device_name", label: "器具名称:", value: String(normalizedSrc.device_name || "").trim() },
      { key: "manufacturer", label: "制造厂/商:", value: String(normalizedSrc.manufacturer || "").trim() },
      { key: "device_model", label: "型号/规格:", value: String(normalizedSrc.device_model || "").trim() },
      { key: "device_code", label: "器具编号:", value: String(normalizedSrc.device_code || "").trim() },
    ].filter((row) => !!normalizeOptionalBlank(row.value));
    if (mainRows.length) sections.push({ title: "主要信息", rows: mainRows });

    const calibrationInfo = extractCalibrationInfoFields(raw, normalizedSrc);
    normalizedSrc.receive_date = calibrationInfo.receiveDate || normalizedSrc.receive_date || "";
    normalizedSrc.calibration_date = calibrationInfo.calibrationDate || normalizedSrc.calibration_date || "";
    normalizedSrc.release_date = calibrationInfo.releaseDate || normalizedSrc.release_date || "";
    normalizedSrc.calibration_other = calibrationInfo.other || normalizedSrc.calibration_other || "";

    const basisText = extractBasisSummary(raw, normalizedSrc);
    const basisRows = [
      { key: "release_date", label: "发布日期", value: normalizedSrc.release_date || "", optional: true },
    ].filter((row) => !!normalizeOptionalBlank(row.value));
    if (basisText || basisRows.length) {
      sections.push({
        title: "本次校准所依据的技术规范（代号、名称）",
        rows: basisRows,
        block: basisText,
      });
    }

    const instrumentBlock = extractBlockByLine(
      raw,
      [/(?:本次校准所使用的主要计量标准器具|主要计量标准器具|Main measurement standard instruments)/i],
      [/(?:本次校准所依据的技术规范|检测\/校准依据|校准依据)/i, /(?:其它|其他)校准信息|Calibration Information/i, /(?:一般检查|General inspection)/i, /^备注[:：]?/i],
    );
    const normalizedInstrument = safeNormalizeMeasurementItemsText(
      { recognizedFields: normalizedSrc, rawText: raw, fields: normalizedSrc },
      normalizedSrc,
    );
    const measurementItemsRaw = String(normalizedSrc.measurement_items || "").trim();
    const measurementItemsRows = measurementItemsRaw ? parseTableRowsFromBlock(measurementItemsRaw) : null;
    const safeMeasurementItems = (measurementItemsRows && measurementItemsRows.length >= 2) ? measurementItemsRaw : "";
    const instrumentText = String(
      normalizedInstrument
      || instrumentBlock
      || safeMeasurementItems
      || "",
    ).trim();
    if (instrumentText) {
      sections.push({
        title: "本次校准所使用的主要计量标准器具",
        block: instrumentText,
      });
    }

    const calibrationRows = [
      { key: "location", label: "地点", value: calibrationInfo.location, optional: true },
      { key: "temperature", label: "温度", value: calibrationInfo.temperature, optional: true },
      { key: "humidity", label: "湿度", value: calibrationInfo.humidity, optional: true },
      { key: "calibration_other", label: "其它", value: calibrationInfo.other, optional: true },
      { key: "receive_date", label: "收样日期", value: calibrationInfo.receiveDate, optional: true },
      { key: "calibration_date", label: "校准日期", value: calibrationInfo.calibrationDate, optional: true },
    ].filter((row) => !!normalizeOptionalBlank(row.value));
    if (calibrationRows.length) {
      sections.push({
        title: "其它校准信息",
        rows: calibrationRows,
      });
    }

    const generalCheckFull = extractGeneralCheckFullBlock(raw, normalizedSrc);
    if (generalCheckFull) {
      normalizedSrc.general_check_full = generalCheckFull || normalizedSrc.general_check_full || "";
      normalizedSrc.general_check = normalizedSrc.general_check || generalCheckFull;
      sections.push({
        title: "校准结果/说明（续页）",
        block: normalizedSrc.general_check_full || "",
        rawText: raw,
        tableStruct: item && item.generalCheckStruct ? item.generalCheckStruct : null,
        forceGeneralCheckTable: true,
      });
    }

    if (includeExtraRows) {
      const groupedKeys = new Set([
        "raw_record",
        "device_name",
        "device_model",
        "device_code",
        "manufacturer",
        "client_name",
        "unit_name",
        "address",
        "certificate_no",
        "basis_standard",
        "calibration_basis",
        "location",
        "temperature",
        "humidity",
        "calibration_other",
        "receive_date",
        "calibration_date",
        "release_date",
        "general_check_full",
        "general_check",
        "general_check_part1",
        "general_check_part2",
        "measurement_items",
      ]);
      const extraRows = Object.keys(normalizedSrc)
        .map((x) => String(x || "").trim())
        .filter((key) => !!key && !groupedKeys.has(key) && !SOURCE_HIDDEN_SYSTEM_KEYS.has(key))
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((key) => ({
          key,
          label: getFieldLabel(key),
          value: String(normalizedSrc[key] || "").trim(),
        }))
        .filter((row) => !!row.value);
      if (extraRows.length) {
        sections.push({
          title: "其它识别信息",
          rows: extraRows,
        });
      }
    }
    return sections;
  }

  function renderFocusSectionsHtml(sections, problemKeys = new Set(), options = {}) {
    if (!Array.isArray(sections) || !sections.length) return "";
    const collapsible = !!options.collapsible;
    const collapseState = (options && options.collapseState && typeof options.collapseState === "object")
      ? options.collapseState
      : null;
    const scope = String((options && options.scope) || "group");
    return sections.map((section, index) => {
      const groupTitle = String(section.title || "");
      const groupKey = `${scope}:${index}:${groupTitle}`;
      const collapsed = !!(collapsible && collapseState && collapseState[groupKey]);
      const rows = Array.isArray(section.rows) ? section.rows : [];
      const rowHtml = rows.map((row) => {
        const value = String(row.value || "").trim();
        const isMissing = !value;
        const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
        let display = '<span class="source-recog-empty">（空）</span>';
        const isDateLikeKey = ["receive_date", "calibration_date", "release_date"].includes(String(row.key || ""));
        if (isDateLikeKey) {
          const parts = parseDateParts(value);
          if (parts) {
            display = `<span class="calib-date-grid"><span class="calib-date-part">${escapeHtml(parts.year)}</span><span class="calib-date-unit">年</span><span class="calib-date-part">${escapeHtml(parts.month)}</span><span class="calib-date-unit">月</span><span class="calib-date-part">${escapeHtml(parts.day)}</span><span class="calib-date-unit">日</span></span>`;
          } else if (value) {
            display = escapeHtml(value);
          }
        } else if (value) {
          display = escapeHtml(value);
        }
        return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(row.label || row.key || "")}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
      }).join("");
      const buildCalibInfoLayout = () => {
        const rowByKey = new Map(rows.map((r) => [String(r.key || ""), r]));
        const cell = (key, label) => {
          const row = rowByKey.get(key) || { key, label, value: "" };
          const value = String(row.value || "").trim();
          const isMissing = !value;
          const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
          const display = value ? escapeHtml(value) : '<span class="source-recog-empty">（空）</span>';
          return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(label)}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
        };
        const dateCell = (key, label) => {
          const row = rowByKey.get(key) || { key, label, value: "" };
          const value = String(row.value || "").trim();
          const isMissing = !value;
          const isProblem = (!row.optional && isMissing) || (row.key && problemKeys.has(row.key));
          const parts = parseDateParts(value);
          let display = '<span class="source-recog-empty">（空）</span>';
          if (parts) {
            display = `<span class="calib-date-grid"><span class="calib-date-part">${escapeHtml(parts.year)}</span><span class="calib-date-unit">年</span><span class="calib-date-part">${escapeHtml(parts.month)}</span><span class="calib-date-unit">月</span><span class="calib-date-part">${escapeHtml(parts.day)}</span><span class="calib-date-unit">日</span></span>`;
          } else if (value) {
            display = escapeHtml(value);
          }
          return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(label)}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
        };
        return `
            <div class="calib-info-layout">
              <div class="calib-info-row one">
                ${cell("location", "地点")}
              </div>
              <div class="calib-info-row three">
                ${cell("temperature", "温度")}
                ${cell("humidity", "湿度")}
                ${cell("calibration_other", "其它")}
              </div>
              <div class="calib-info-row two">
                ${dateCell("receive_date", "收样日期")}
                ${dateCell("calibration_date", "校准日期")}
              </div>
            </div>
          `;
      };
      const renderedRowsHtml = groupTitle === "其它校准信息" ? buildCalibInfoLayout() : rowHtml;
      const blockText = cleanBlockText(section.block || "");
      const isGeneralCheckGroup = groupTitle === "校准结果/说明（续页）";
      const blockHtml = blockText
        ? (isGeneralCheckGroup
          ? renderGeneralCheckWysiwygBlock(blockText, {
            readOnly: true,
            rawText: String(section.rawText || ""),
            tableStruct: section && section.tableStruct ? section.tableStruct : null,
          })
          : renderStructuredBlockHtml(blockText, {
            forceGeneralCheckTable: !!section.forceGeneralCheckTable,
          }))
        : "";
      const toggleHtml = collapsible
        ? `<button type="button" class="source-recog-group-toggle" data-group-toggle="1" data-group-key="${escapeAttr(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "展开" : "收起"}">${collapsed ? "▶" : "▼"}</button>`
        : "";
      let contentHtml = "";
      if (!collapsed) {
        const hasRows = !!String(renderedRowsHtml || "").trim();
        const hasBlock = !!String(blockHtml || "").trim();
        if (hasRows) contentHtml += renderedRowsHtml;
        if (hasBlock) contentHtml += blockHtml;
        if (!hasRows && !hasBlock) contentHtml = '<div class="source-recog-block">（空）</div>';
      }
      return `<div class="source-recog-group ${collapsed ? "is-collapsed" : ""}"><div class="source-recog-group-title">${toggleHtml}<span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span></div>${contentHtml}</div>`;
    }).join("");
  }

  return {
    extractCalibrationInfoFields,
    extractBasisSummary,
    buildFocusSections,
    renderFocusSectionsHtml,
  };
}
