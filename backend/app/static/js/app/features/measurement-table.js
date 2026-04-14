export function createMeasurementTableFeature(deps = {}) {
  const {
    extractBlockByLine,
    normalizeValidationToken,
    renderRichCellHtml,
  } = deps;

  function parseTableRowsFromBlock(blockText) {
    const lines = String(blockText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const docxImageTokenPattern = /\[\[DOCX_IMG\|[^\]]+\]\]/g;
    const maskedLines = lines.map((line) => String(line || "").replace(docxImageTokenPattern, (token) => token.replace(/\|/g, "\u0001")));
    const restoreDocxImageTokens = (value) => String(value || "").replace(/\u0001/g, "|");

    const tryWithSplitter = (splitter, sourceLines = maskedLines) => {
      const rows = sourceLines.map((line) => splitter(line).map((cell) => restoreDocxImageTokens(cell.trim())));
      if (!rows.every((row) => row.length >= 2)) return null;
      const colCount = rows[0].length;
      if (colCount < 2) return null;
      if (!rows.every((row) => row.length === colCount)) return null;
      return rows;
    };

    const tableByTab = tryWithSplitter((line) => line.split("\t"));
    if (tableByTab) return tableByTab;

    const hasPipe = maskedLines.every((line) => line.includes("|"));
    if (hasPipe) {
      const tableByPipe = tryWithSplitter((line) => line.split("|"));
      if (tableByPipe) return tableByPipe;
    }

    const tableBySpace = tryWithSplitter((line) => line.split(/\s{2,}/));
    if (tableBySpace && tableBySpace.length >= 3) return tableBySpace;

    const parseInstrumentBlockTable = () => {
      const hasInstrumentMarker = lines.some((line) => /本次校准所使用的主要计量标准器具|main measurement standard instruments used in this calibration/i.test(line));
      const hasColumnMarker = lines.some((line) => /测量范围|measurement range|证书编号|certificate number|溯源机构|traceability/i.test(line));
      if (!hasInstrumentMarker && !hasColumnMarker) return null;

      const isNoise = (line) => {
        const text = String(line || "").trim();
        if (!text) return true;
        const patterns = [
          /本次校准所使用的主要计量标准器具/i,
          /main measurement standard instruments used in this calibration/i,
          /^(?:编\s*号|number|编号\s*\/?\s*number)$/i,
          /^(?:编号\s*number|number\s*编号)$/i,
          /^(?:测量范围|measurement range)$/i,
          /^(?:测量范围\s*measurement range)$/i,
          /准确度等级/i,
          /最大允许误差/i,
          /不确定度/i,
          /measurement range\s*\/\s*accuracy class/i,
          /maximum permissible errors/i,
          /uncertainty of measurement/i,
          /^(?:证书编号\s*\/\s*有效期|certificate number\s*\/\s*valid date)$/i,
          /^(?:证书编号\s*有效期|certificate number\s*valid date)$/i,
          /^(?:溯源机构名称|name of traceability)$/i,
          /^(?:溯源机构名称\s*name of traceability)$/i,
          /^institution$/i,
          /^以上计量标准器具/u,
          /^quantity values of above measurement standards/i,
        ];
        return patterns.some((pattern) => pattern.test(text));
      };
      const dataLines = lines.filter((line) => !isNoise(line));
      if (dataLines.length < 6) return null;

      const splitMergedInstrumentLines = (sourceLines) => {
        const result = [];
        const namePattern = /[\u4e00-\u9fa5]{2,16}(?:温度表|秒表|直尺|卡尺|天平|砝码|试验仪|试验机|电桥|表|尺|仪)/g;
        for (const rawLine of sourceLines) {
          const line = String(rawLine || "").trim();
          if (!line) continue;
          const matches = [...line.matchAll(namePattern)];
          if (matches.length < 2) {
            result.push(line);
            continue;
          }
          const points = matches.map((m) => m.index || 0).filter((idx) => idx > 0).sort((a, b) => a - b);
          if (!points.length) {
            result.push(line);
            continue;
          }
          let start = 0;
          for (const idx of points) {
            const part = line.slice(start, idx).trim();
            if (part) result.push(part);
            start = idx;
          }
          const tail = line.slice(start).trim();
          if (tail) result.push(tail);
        }
        return result;
      };

      const preparedLines = splitMergedInstrumentLines(dataLines);


      const parseRowsByLikelyName = () => {
        const isLikelyName = (text) => {
          const v = String(text || "").trim();
          if (!v) return false;
          if (v.length > 24) return false;
          if (/[:：]/.test(v)) return false;
          if (/^(?:测量范围|编号|型号|证书编号|有效期|溯源机构|准确度|不确定度|main measurement)/i.test(v)) return false;
          if (/(?:~|～|to|℃|°C|%RH|k=|U=|Urel|年|月|日)/i.test(v)) return false;
          if (/^[A-Za-z]{2,8}$/.test(v)) return false;
          if (/^[A-Za-z]{1,4}[A-Za-z0-9-]{3,}$/.test(v.replace(/\s+/g, ""))) return false;
          return /[\u4e00-\u9fa5]/.test(v);
        };

        const nameIndexes = [];
        for (let i = 0; i < preparedLines.length; i += 1) {
          if (isLikelyName(preparedLines[i])) nameIndexes.push(i);
        }
        if (!nameIndexes.length) return null;

        const looksLikeCode = (v) => /^[A-Za-z]{1,4}[A-Za-z0-9-]{3,}$/.test(String(v || "").replace(/\s+/g, ""));
        const looksLikeRange = (v) => /(?:~|～|至|to|μA|mA|A|V|kV|mm|cm|m|℃|°C|\(\s*[-\d~～]+\s*\))/i.test(String(v || ""));
        const looksLikeUncertainty = (v) => /(?:u\s*=|Urel|U=|k\s*=|电压|电流|长度|重复性|时间间隔|日差|μV|mV|%RH)/i.test(String(v || ""));
        const looksLikeDate = (v) => /(?:\d{4}年\d{1,2}月\d{1,2}日|\d{4}[./-]\d{1,2}[./-]\d{1,2})/.test(String(v || ""));
        const looksLikeInstitution = (v) => /^[A-Z]{2,8}$/.test(String(v || "").trim());
        const header = ["计量标准器具名称", "型号/规格", "编号", "测量范围", "准确度/不确定度", "证书编号/有效期", "溯源机构"];
        const rows = [];

        for (let ni = 0; ni < nameIndexes.length; ni += 1) {
          const start = nameIndexes[ni];
          const end = ni + 1 < nameIndexes.length ? nameIndexes[ni + 1] : preparedLines.length;
          const seg = preparedLines.slice(start, end).map((x) => String(x || "").trim()).filter(Boolean);
          if (!seg.length) continue;
          const name = seg[0];
          let model = "";
          let code = "";
          let range = "";
          const uncertaintyParts = [];
          const certParts = [];
          let institution = "";
          for (let i = 1; i < seg.length; i += 1) {
            const text = seg[i];
            if (!text) continue;
            if (!institution && looksLikeInstitution(text)) {
              institution = text;
              continue;
            }
            if (!code && looksLikeCode(text)) {
              code = text;
              continue;
            }
            if (looksLikeDate(text) || /(?:^[A-Za-z0-9-]{6,}$)/.test(text)) {
              certParts.push(text);
              continue;
            }
            if (!range && looksLikeRange(text)) {
              range = text;
              continue;
            }
            if (looksLikeUncertainty(text)) {
              uncertaintyParts.push(text);
              continue;
            }
            if (!model) {
              model = text;
              continue;
            }
            uncertaintyParts.push(text);
          }
          if (!model && seg.length > 1) model = seg[1];
          rows.push([name, model, code, range, uncertaintyParts.join(" ").trim(), certParts.join(" ").trim(), institution]);
        }
        if (!rows.length) return null;
        return [header, ...rows];
      };

      const rowsByName = parseRowsByLikelyName();
      if (rowsByName && rowsByName.length > 1) return rowsByName;

      let chunkSize = 0;
      if (preparedLines.length % 8 === 0) chunkSize = 8;
      else if (preparedLines.length % 7 === 0) chunkSize = 7;

      const headersBySize = {
        8: ["计量标准器具名称", "型号/规格", "编号", "测量范围", "准确度/不确定度", "证书编号", "有效期", "溯源机构"],
        7: ["计量标准器具名称", "型号/规格", "编号", "测量范围", "准确度/不确定度", "证书编号/有效期", "溯源机构"],
      };
      const looksLikeNoiseCell = (text) => {
        const v = String(text || "").trim();
        if (!v) return true;
        const checks = [
          /准确度等级|最大允许误差|不确定度/i,
          /证书编号|有效期|certificate number|valid date/i,
          /时间间隔|日差|温度[:：]\s*u=|电压[:：]\s*u=|电流[:：]\s*u=/i,
          /以上计量标准器具|quantity values of above measurement standards/i,
        ];
        return checks.some((re) => re.test(v));
      };

      const pruneRows = (rows, nameCol = 0) => rows
        .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()))
        .filter((row) => !looksLikeNoiseCell(row[nameCol]));

      if (chunkSize > 0) {
        const header = headersBySize[chunkSize] || headersBySize[7];
        const rows = [];
        for (let i = 0; i < preparedLines.length; i += chunkSize) {
          rows.push(preparedLines.slice(i, i + chunkSize));
        }
        if (rows.length && rows.every((row) => row.length === chunkSize)) {
          const cleaned = pruneRows(rows, 0);
          if (cleaned.length) return [header, ...cleaned];
        }
      }

      const looksLikeRangeContinuation = (text) => /(?:~|～|至|to|μA|mA|A|V|kV|mm|cm|m|℃|°C)/i.test(String(text || ""));
      const looksLikeUncertaintyContinuation = (text) => /(?:u\s*=|Urel|U=|k\s*=|电压|电流|长度|重复性|μV|mV|V)/i.test(String(text || ""));
      const looksLikeDateLike = (text) => /(?:\d{4}年\d{1,2}月\d{1,2}日|\d{4}[./-]\d{1,2}[./-]\d{1,2})/.test(String(text || ""));
      const looksLikeCertNo = (text) => /(?:\d{2,}|[A-Za-z]{1,6}[-/][A-Za-z0-9-]+)/.test(String(text || ""));

      const rows = [];
      let i = 0;
      while (i < preparedLines.length) {
        const remain = preparedLines.length - i;
        if (remain < 6) break;

        const name = preparedLines[i++] || "";
        const model = preparedLines[i++] || "";
        const code = preparedLines[i++] || "";

        let range = preparedLines[i++] || "";
        if (i < preparedLines.length && looksLikeRangeContinuation(preparedLines[i])) {
          range = `${range} ${preparedLines[i++]}`.trim();
        }

        let uncertainty = i < preparedLines.length ? (preparedLines[i++] || "") : "";
        if (i < preparedLines.length && looksLikeUncertaintyContinuation(preparedLines[i])) {
          uncertainty = `${uncertainty} ${preparedLines[i++]}`.trim();
        }

        let certAndDate = i < preparedLines.length ? (preparedLines[i++] || "") : "";
        if (i < preparedLines.length && (looksLikeDateLike(preparedLines[i]) || (!looksLikeDateLike(certAndDate) && looksLikeCertNo(preparedLines[i])))) {
          certAndDate = `${certAndDate} ${preparedLines[i++]}`.trim();
        }

        const institution = i < preparedLines.length ? (preparedLines[i++] || "") : "";
        rows.push([name, model, code, range, uncertainty, certAndDate, institution]);
      }

      if (!rows.length) return null;
      const cleaned = pruneRows(rows, 0);
      if (!cleaned.length) return null;
      return [headersBySize[7], ...cleaned];
    };

    const instrumentTable = parseInstrumentBlockTable();
    if (instrumentTable) return instrumentTable;

    return null;
  }

  function renderStructuredTableHtml(tableRows) {
    const rows = Array.isArray(tableRows)
      ? tableRows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell || "").trim()) : []))
      : [];
    if (rows.length < 2) return "";
    const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (colCount < 2) return "";
    const grid = rows.map((row) => {
      const next = row.slice(0, colCount);
      while (next.length < colCount) next.push("");
      return next;
    });
    const occupied = grid.map(() => Array(colCount).fill(false));
    const bodyHtml = grid.map((row, rowIdx) => {
      const cells = [];
      for (let colIdx = 0; colIdx < colCount; colIdx += 1) {
        if (occupied[rowIdx][colIdx]) continue;
        const text = String(row[colIdx] || "").trim();
        const tagName = rowIdx === 0 ? "th" : "td";
        if (!text) {
          cells.push(`<${tagName}></${tagName}>`);
          continue;
        }
        let colspan = 1;
        while (colIdx + colspan < colCount && !occupied[rowIdx][colIdx + colspan] && !String(row[colIdx + colspan] || "").trim()) {
          colspan += 1;
        }
        const rowspan = 1;
        for (let mergeRow = rowIdx; mergeRow < rowIdx + rowspan; mergeRow += 1) {
          for (let mergeCol = colIdx; mergeCol < colIdx + colspan; mergeCol += 1) {
            occupied[mergeRow][mergeCol] = true;
          }
        }
        const attrs = [];
        if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`);
        if (colspan > 1) attrs.push(`colspan="${colspan}"`);
        cells.push(`<${tagName}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${renderRichCellHtml(text)}</${tagName}>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    }).join("");
    return `<div class="source-recog-block source-recog-block-formatted"><table class="source-recog-block-table"><tbody>${bodyHtml}</tbody></table></div>`;
  }

  function extractMeasurementItemsBlockText(item, fields) {
    const f = (fields && typeof fields === "object") ? fields : {};
    const recognized = (item && item.recognizedFields && typeof item.recognizedFields === "object")
      ? item.recognizedFields
      : {};
    const direct = String(recognized.measurement_items || "").trim() || String(f.measurement_items || "").trim();
    if (direct) return direct;
    const raw = String(f.raw_record || (item && item.rawText) || "");
    if (!raw) return "";
    const block = extractBlockByLine(
      raw,
      [/(?:本次校准所使用的主要计量标准器具|主要计量标准器具|Main measurement standard instruments)/i],
      [/(?:本次校准所依据的技术规范|检测\/校准依据|校准依据)/i, /(?:其它|其他)校准信息|Calibration Information/i, /(?:一般检查|General inspection)/i, /^备注[:：]?/i],
    );
    return String(block || "").trim();
  }

  function normalizeMeasurementItemsText(item, fields) {
    const block = extractMeasurementItemsBlockText(item, fields);
    if (!block) return "";
    const tableRows = parseTableRowsFromBlock(block);
    if (tableRows && tableRows.length >= 2) return tableRows.map((row) => row.join("\t")).join("\n");
    return block;
  }

  function shouldRebuildMeasurementItemsFromRaw(currentText, item) {
    const tableRows = parseTableRowsFromBlock(String(currentText || ""));
    if (!tableRows || tableRows.length < 2) return true;
    const sourceTag = String((item && item.fields && item.fields.measurement_items_source) || "").trim().toLowerCase();
    if (sourceTag === "structured") return false;
    const [header, ...body] = tableRows;
    const headerText = (Array.isArray(header) ? header : []).map((x) => String(x || "")).join(" ");
    const hasNameHeader = /器具名称|计量标准器具名称|instrument\s*name/i.test(headerText);
    const hasModelHeader = /型号\/规格|model\/specification/i.test(headerText);
    const hasCertHeader = /证书编号/i.test(headerText);
    const hasValidHeader = /有效期/i.test(headerText);
    const hasCombinedCertValid = /证书编号\s*\/\s*有效期|certificate number\s*\/\s*valid date/i.test(headerText);
    const colCount = Array.isArray(header) ? header.length : 0;
    if (!hasNameHeader) return true;
    if (!hasModelHeader) return true;
    if (!hasCertHeader && !hasCombinedCertValid) return true;
    if (!(colCount === 7 || colCount === 8)) return true;
    if (colCount === 7 && hasValidHeader && !hasCombinedCertValid) return true;
    if (colCount === 8 && !hasValidHeader) return true;

    const firstRow = Array.isArray(body) && body.length ? body[0] : [];
    const firstName = String((firstRow && firstRow[0]) || "").trim();
    if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(firstName)) return true;
    if (/^[A-Za-z]\d{4,}/.test(firstName) || /^J\d{6,}/.test(firstName)) return true;
    const idx = getMeasurementHeaderIndexes(header);
    const looksLikeDate = (v) => /(?:\d{4}年\d{1,2}月\d{1,2}日|\d{4}[./-]\d{1,2}[./-]\d{1,2})/.test(String(v || ""));
    const looksLikeCode = (v) => /^[A-Za-z]{1,4}[A-Za-z0-9-]{3,}$/.test(String(v || "").replace(/\s+/g, ""));
    const looksLikeName = (v) => /[\u4e00-\u9fa5]{2,16}(?:温度表|秒表|直尺|卡尺|天平|砝码|试验仪|试验机|电桥|表|尺|仪)/.test(String(v || ""));
    const looksLikeRange = (v) => /(?:~|～|to|℃|°C|mm|cm|m|kV|V|A|\(\s*[-\d~～]+\s*\))/i.test(String(v || ""));
    const looksLikeUncertainty = (v) => /(?:u\s*=|Urel|U=|k\s*=|日差|时间间隔|长度[:：]|电压[:：]|电流[:：])/.test(String(v || ""));
    const looksLikeCertNo = (v) => /(?:J\d{6,}|[A-Za-z]{1,6}[-/][A-Za-z0-9-]{4,})/.test(String(v || ""));

    for (const row of body) {
      const name = String((row && row[idx.nameIdx]) || "").trim();
      const model = String((row && row[idx.modelIdx]) || "").trim();
      const code = String((row && row[idx.codeIdx]) || "").trim();
      const range = String((row && row[idx.codeIdx + 1]) || "").trim();
      const uncertainty = String((row && row[idx.codeIdx + 2]) || "").trim();
      const certCol = String((row && row[idx.codeIdx + 3]) || "").trim();
      if (looksLikeDate(model)) return true;
      if (looksLikeName(code) && !looksLikeCode(code)) return true;
      if (looksLikeUncertainty(range) && !looksLikeRange(range)) return true;
      if (looksLikeCertNo(uncertainty) || looksLikeDate(uncertainty)) return true;
      if (looksLikeDate(certCol) && !looksLikeCertNo(certCol)) return true;
      if (looksLikeRange(name) && !looksLikeName(name)) return true;
    }
    return false;
  }

  function buildFallbackMeasurementRows(text) {
    const header = ["计量标准器具名称", "型号/规格", "编号", "测量范围", "准确度/不确定度", "证书编号/有效期", "溯源机构"];
    const raw = String(text || "").trim();
    if (!raw) return [header, ["", "", "", "", "", "", ""]];
    return [header, [raw, "", "", "", "", "", ""]];
  }

  function getMeasurementHeaderIndexes(headerRow) {
    const header = Array.isArray(headerRow) ? headerRow : [];
    const token = (x) => normalizeValidationToken(String(x || ""));
    const nameIdx = header.findIndex((h) => {
      const t = token(h);
      return t.includes("计量标准器具名称") || t.includes("器具名称") || t.includes("instrumentname");
    });
    const modelIdx = header.findIndex((h) => {
      const t = token(h);
      return t.includes("型号规格") || t.includes("modelspecification");
    });
    const codeIdx = header.findIndex((h) => {
      const t = token(h);
      return t === "编号" || t.includes("器具编号") || t.includes("instrumentserialnumber") || t.includes("serialnumber");
    });
    return {
      nameIdx: nameIdx >= 0 ? nameIdx : 0,
      modelIdx: modelIdx >= 0 ? modelIdx : 1,
      codeIdx: codeIdx >= 0 ? codeIdx : 2,
    };
  }

  function buildMeasurementCatalogMatchInfo(tableRows) {
    if (!Array.isArray(tableRows) || tableRows.length < 2) return [];
    const [, ...body] = tableRows;
    return body.map((row) => {
      return { mismatch: false, reason: "", catalogRow: null };
    });
  }

  function parseKeyValueRowsFromBlock(blockText) {
    const lines = String(blockText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const rows = [];
    for (const line of lines) {
      const m = line.match(/^([^:：]{1,60})[:：]\s*(.+)$/);
      if (!m) return null;
      rows.push({ key: m[1].trim(), value: m[2].trim() });
    }
    return rows.length ? rows : null;
  }

  function parseListLinesFromBlock(blockText) {
    const lines = String(blockText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const items = [];
    const codeLike = (line) => /[A-Za-z]{1,5}\s*\/\s*T\s*\d+(?:\.\d+)?-\d{4}/i.test(String(line || ""));
    for (const line of lines) {
      const m = line.match(/^(?:[-*•]|(?:\d+|[一二三四五六七八九十]+)[、.．)]|\(\d+\))\s*(.+)$/);
      if (m) {
        items.push(m[1].trim());
        continue;
      }
      if (codeLike(line)) {
        items.push(line);
        continue;
      }
      return null;
    }
    return items.length ? items : null;
  }

  return {
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
  };
}
