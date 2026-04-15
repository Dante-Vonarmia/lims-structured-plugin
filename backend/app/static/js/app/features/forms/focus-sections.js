import { isBooleanTextValue, renderBooleanDisplayHtml } from "../shared/boolean-display.js";

export function createFocusSectionsFeature(deps = {}) {
  const {
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
    return {
      location,
      temperature: temperature.replace(/\s+/g, ""),
      humidity: humidity.replace(/\s+/g, ""),
      other,
      receiveDate: receiveDate || "",
      calibrationDate: calibrationDate || "",
      releaseDate: releaseDate || "",
    };
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
        } else if (isBooleanTextValue(value)) {
          display = renderBooleanDisplayHtml(value);
        } else if (value) {
          display = escapeHtml(value);
        }
        return `<div class="source-recog-item ${isProblem ? "is-problem" : ""}"><span class="source-recog-key">${escapeHtml(row.label || row.key || "")}</span><span class="source-recog-val ${isProblem ? "is-problem" : ""}">${display}</span></div>`;
      }).join("");
      const blockText = cleanBlockText(section.block || "");
      const blockHtml = blockText
        ? (section && section.renderAsWysiwyg
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
        const hasRows = !!String(rowHtml || "").trim();
        const hasBlock = !!String(blockHtml || "").trim();
        if (hasRows) contentHtml += rowHtml;
        if (hasBlock) contentHtml += blockHtml;
        if (!hasRows && !hasBlock) contentHtml = '<div class="source-recog-block">（空）</div>';
      }
      return `<div class="source-recog-group ${collapsed ? "is-collapsed" : ""}"><div class="source-recog-group-title">${toggleHtml}<span class="source-recog-group-title-text">${escapeHtml(groupTitle)}</span></div>${contentHtml}</div>`;
    }).join("");
  }

  return {
    extractCalibrationInfoFields,
    renderFocusSectionsHtml,
  };
}
