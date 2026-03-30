export function createGeneralCheckFeature(deps = {}) {
  const {
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
  } = deps;
    function formatGeneralCheckMathText(value) {
      const raw = String(value || "");
      if (!raw) return "";
      const re = /(^|[\s(（\[【,，;；:：])([x×])\s*10\s*(?:\^)?\s*([+-]?\d{1,2})(?=$|[\s)）\]】,，;；:：])/g;
      const superscriptMap = {
        "0": "⁰",
        "1": "¹",
        "2": "²",
        "3": "³",
        "4": "⁴",
        "5": "⁵",
        "6": "⁶",
        "7": "⁷",
        "8": "⁸",
        "9": "⁹",
        "+": "⁺",
        "-": "⁻",
      };
      return raw.replace(re, (_, prefix, _x, exponent) => {
        const exp = String(exponent || "");
        const sup = exp.split("").map((ch) => superscriptMap[ch] || ch).join("");
        return `${prefix}×10${sup}`;
      });
    }
    function parseGeneralCheckRowsFromBlock(blockText, forceTable = false) {
      const isGeneralCheckNoiseLine = (line) => {
        const t = String(line || "").trim();
        if (!t) return true;
        if (/^第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页$/i.test(t)) return true;
        if (/^page\s*of\s*total\s*pages$/i.test(t)) return true;
        if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
        if (/^校准证书续页专用$/i.test(t)) return true;
        if (/^continued\s+page\s+of\s+calibration\s+certificate$/i.test(t)) return true;
        if (/上海国缆检测/.test(t)) return true;
        if (/shanghai\s+national\s+center\s+of\s+testing/i.test(t)) return true;
        if (/certificate\s+series\s+number/i.test(t)) return true;
        if (/缆专检号[:：]?/.test(t)) return true;
        return false;
      };
      const titleNoisePatterns = [
        /^校准结果\s*\/\s*说明(?:（续页）|\(续页\))?[:：]?$/i,
        /^results\s+of\s+calibration\s+and\s+additional\s+explanation(?:\s*\(continued\s+page\))?[:：]?$/i,
      ];
      const noiseLinePatterns = [
        /^[`'"\-|_~]+$/,
        /^results\s+of\s+calibration/i,
      ];
      const lines = String(blockText || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((line) => !isGeneralCheckNoiseLine(line))
        .filter((line) => !titleNoisePatterns.some((pattern) => pattern.test(line)))
        .filter((line) => !noiseLinePatterns.some((pattern) => pattern.test(line)));
      if (!lines.length) return null;
      const rows = [];
      let hasGeneralCheckMarkers = false;
      let notePrefix = "";
      const normalizeGeneralCheckTitle = (value) => String(value || "")
        .replace(/一般检查\s*[（(]\s*\*\s*[）)]\s*[:：]?/g, "一般检查：")
        .replace(/General\s*inspection\s*[（(]\s*\*\s*[）)]\s*[:：]?/ig, "General inspection:")
        .trim();
      for (const line of lines) {
        if (/^注[:：]?/i.test(line) || /^notes?[:：]?/i.test(line)) {
          break;
        }
        const normalizedLine = line;
        if (/^(?:一|二|三|四|五|六|七|八|九|十)[、.．]/.test(normalizedLine)) {
          const m = normalizedLine.match(/^((?:一|二|三|四|五|六|七|八|九|十)[、.．])\s*(.*)$/);
          rows.push([m ? m[1] : "", normalizeGeneralCheckTitle(m ? m[2] : line)]);
          hasGeneralCheckMarkers = true;
          continue;
        }
        if (/^\(\d+\)/.test(normalizedLine)) {
          const m = normalizedLine.match(/^(\(\d+\))\s*(.*)$/);
          const marker = m ? m[1] : "";
          const prefix = notePrefix ? `${notePrefix}${marker}` : marker;
          rows.push([prefix, m ? m[2] : normalizedLine]);
          notePrefix = "";
          hasGeneralCheckMarkers = true;
          continue;
        }
        rows.push(["", normalizeGeneralCheckTitle(normalizedLine)]);
      }
      const mergedRows = [];
      for (let i = 0; i < rows.length; i += 1) {
        const current = rows[i];
        const next = rows[i + 1];
        if (
          current
          && next
          && String(current[0] || "").trim()
          && !String(current[1] || "").trim()
          && !String(next[0] || "").trim()
          && String(next[1] || "").trim()
        ) {
          mergedRows.push([current[0], next[1]]);
          i += 1;
          continue;
        }
        if (!String(current[0] || "").trim() && !String(current[1] || "").trim()) continue;
        mergedRows.push(current);
      }
      const compactRows = [];
      for (let i = 0; i < mergedRows.length; i += 1) {
        const marker = String((mergedRows[i] && mergedRows[i][0]) || "").trim();
        const text = String((mergedRows[i] && mergedRows[i][1]) || "").trim();
        const isNestedHeader = /^(?:显\s*示\s*值|实\s*测\s*值)\s*\(?.*?[℃°cC]?\)?\s*[:：]?$/i.test(text);
        if (isNestedHeader) {
          const nums = [];
          let j = i + 1;
          while (j < mergedRows.length) {
            const nextMarker = String((mergedRows[j] && mergedRows[j][0]) || "").trim();
            const nextText = String((mergedRows[j] && mergedRows[j][1]) || "").trim();
            if (nextMarker) break;
            if (!/^[+-]?\d+(?:\.\d+)?$/.test(nextText)) break;
            nums.push(nextText);
            j += 1;
          }
          if (nums.length) {
            compactRows.push([marker, `${text} ${nums.join("  ")}`]);
            i = j - 1;
            continue;
          }
        }
        compactRows.push(mergedRows[i]);
      }
      if (hasGeneralCheckMarkers) return compactRows;
      if (forceTable && compactRows.length) return compactRows;
      return null;
    }

    function parseGeneralCheckRowsForEditor(blockText) {
      const rows = parseGeneralCheckRowsFromBlock(blockText, true);
      if (rows && rows.length) return rows.map((row) => [String(row[0] || "").trim(), String(row[1] || "").trim()]);
      const tableRows = parseTableRowsFromBlock(blockText);
      if (tableRows && tableRows.length) {
        return tableRows.map((row) => [String((row && row[0]) || "").trim(), String((row && row[1]) || "").trim()]);
      }
      return [];
    }

    function renderGeneralCheckEditorCell(cell, rowIdx, colIdx, options = {}) {
      const cellText = formatGeneralCheckMathText(String(cell || ""));
      const baseAttrs = [
        'class="general-check-wysiwyg-cell"',
        'data-field="general_check_cell"',
        `data-row="${rowIdx}"`,
        `data-col="${colIdx}"`,
      ];
      if (hasDocxImageToken(cellText)) {
        return `<td class="general-check-media-cell">${renderRichCellHtml(cellText)}</td>`;
      }
      if (options && options.widthStyle) {
        return `<td style="${options.widthStyle}" ${baseAttrs.join(" ")} contenteditable="true">${escapeHtml(cellText)}</td>`;
      }
      return `<td ${baseAttrs.join(" ")} contenteditable="true">${escapeHtml(cellText)}</td>`;
    }

    function renderGeneralCheckImageGallery(rawText, currentBlockText) {
      const fromBlock = collectDocxImageTokens(currentBlockText, 12);
      if (fromBlock.length) return "";
      const fromRaw = collectDocxImageTokens(rawText, 12);
      if (!fromRaw.length) return "";
      const imgs = fromRaw
        .slice(0, 6)
        .map((token) => `<div class="general-check-media-cell">${renderRichCellHtml(token)}</div>`)
        .join("");
      return `<div class="general-check-image-gallery">${imgs}</div>`;
    }

    function buildGeneralCheckRowsFromTableStruct(tableStruct) {
      const model = (tableStruct && typeof tableStruct === "object") ? tableStruct : null;
      const rowCount = Number((model && model.rows) || 0) || 0;
      const colCount = Number((model && model.cols) || 0) || 0;
      const cells = Array.isArray(model && model.cells) ? model.cells : [];
      if (rowCount <= 0 || colCount <= 0 || !cells.length) return null;

      const grid = Array.from({ length: rowCount }, () => Array(colCount).fill(null));
      for (const rawCell of cells) {
        const cell = rawCell && typeof rawCell === "object" ? rawCell : {};
        const r = Number(cell.r || 0) || 0;
        const c = Number(cell.c || 0) || 0;
        const rowspan = Math.max(1, Number(cell.rowspan || 1) || 1);
        const colspan = Math.max(1, Number(cell.colspan || 1) || 1);
        if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue;
        grid[r][c] = { ...cell, r, c, rowspan, colspan };
        for (let rr = r; rr < Math.min(rowCount, r + rowspan); rr += 1) {
          for (let cc = c; cc < Math.min(colCount, c + colspan); cc += 1) {
            if (rr === r && cc === c) continue;
            grid[rr][cc] = "__covered__";
          }
        }
      }

      const tableRowsRaw = [];
      for (let r = 0; r < rowCount; r += 1) {
        tableRowsRaw.push(Array.from({ length: colCount }, (_, c) => {
          const slot = grid[r][c];
          return slot && slot !== "__covered__" ? String(slot.text || "").trim() : "";
        }));
      }

      const isGeneralCheckTitleRow = (row) => {
        const line = (Array.isArray(row) ? row : []).join(" ").replace(/\s+/g, " ").trim();
        if (!line) return false;
        if (/校准结果\/说明（续页）/.test(line)) return true;
        if (/Results\s+of\s+calibration\s+and\s+additional\s+explanation/i.test(line)) return true;
        return false;
      };
      const isGeneralCheckNoiseLine = (line) => {
        const text = String(line || "").replace(/\s+/g, " ").trim();
        if (!text) return true;
        if (/第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页/i.test(text)) return true;
        if (/page\s*of\s*total\s*pages/i.test(text)) return true;
        if (/page\s+\d+\s+of\s+\d+/i.test(text)) return true;
        if (/中国合格评定国家认可委员会|No\.?\s*CNAS/i.test(text)) return true;
        if (/本次校准所依据的技术规范|Reference documents for the calibration/i.test(text)) return true;
        if (/本次校准所使用的主要计量标准器具|Main measurement standard instruments/i.test(text)) return true;
        if (/(?:其它|其他)校准信息|Calibration Information/i.test(text)) return true;
        if (/^备注[:：]?|^Remarks[:：]?/i.test(text)) return true;
        return false;
      };
      const visibleRowsRaw = tableRowsRaw.filter((row) => {
        if (isGeneralCheckTitleRow(row)) return false;
        const line = (Array.isArray(row) ? row : (row && row.texts) || []).join(" ");
        return !isGeneralCheckNoiseLine(line);
      });
      const startIdx = visibleRowsRaw.findIndex((row) => {
        const line = (Array.isArray(row) ? row : (row && row.texts) || []).join(" ");
        return /(?:^|[\s])(?:一[、.．)]\s*)?一般检查|General inspection/i.test(line) || /^\(\d+\)/.test(String(line || "").trim());
      });
      const scopedRows = startIdx >= 0 ? visibleRowsRaw.slice(startIdx) : [];
      const cutIdx = scopedRows.findIndex((row) => {
        const line = (Array.isArray(row) ? row : []).join(" ");
        return /(?:以下空白|\(以下空白\)|（以下空白）)/.test(line) || /^注[:：]?|^Notes?[:：]?/i.test(String(line || "").trim());
      });
      const body = (cutIdx >= 0 ? scopedRows.slice(0, cutIdx) : scopedRows)
        .map((row) => row.map((cell) => String(cell || "")))
        .filter((row) => row.some((cell) => String(cell || "").trim()));
      if (!body.length) return null;
      let maxUsedCol = -1;
      body.forEach((row) => {
        (Array.isArray(row) ? row : []).forEach((cell, colIdx) => {
          if (String(cell || "").trim()) maxUsedCol = Math.max(maxUsedCol, colIdx);
        });
      });
      const effectiveColCount = Math.min(colCount, Math.max(2, maxUsedCol + 1));
      const trimmedBody = body.map((row) => row.slice(0, effectiveColCount));
      const header = ["序号/标记", "内容", ...Array.from({ length: Math.max(0, effectiveColCount - 2) }, (_, idx) => String(idx + 1))];
      return [header, ...trimmedBody];
    }

    function buildGeneralCheckWysiwygData(blockText, options = {}) {
      const multiColumnTable = parseGeneralCheckMultiColumnTable(String(blockText || ""));
      if (multiColumnTable) {
        const [header, ...body] = multiColumnTable;
        const normalizedHeader = (Array.isArray(header) ? header : []).map((cell) => String(cell || "").trim());
        const normalizedRows = (body.length ? body : [Array(normalizedHeader.length || 1).fill("")])
          .map((row) => row.map((cell) => String(cell || "")));
        return { twoColumn: false, header: normalizedHeader, rows: normalizedRows };
      }
      const fromStruct = buildGeneralCheckRowsFromTableStruct(options && options.tableStruct ? options.tableStruct : null);
      if (fromStruct) {
        const [header, ...body] = fromStruct;
        const normalizedHeader = (Array.isArray(header) ? header : []).map((cell) => String(cell || "").trim());
        const normalizedRows = (body.length ? body : [Array(normalizedHeader.length || 1).fill("")])
          .map((row) => row.map((cell) => String(cell || "")));
        return { twoColumn: false, header: normalizedHeader, rows: normalizedRows };
      }
      const rows = parseGeneralCheckRowsForEditor(String(blockText || ""));
      const normalizedRows = (rows.length ? rows : [["", ""]])
        .map((row) => [String((row && row[0]) || ""), String((row && row[1]) || "")]);
      return { twoColumn: true, header: ["序号/标记", "内容"], rows: normalizedRows };
    }

    function renderGeneralCheckStructuredTable(tableStruct, options = {}) {
      const readOnly = !!(options && options.readOnly);
      const model = (tableStruct && typeof tableStruct === "object") ? tableStruct : null;
      const rowCount = Number((model && model.rows) || 0) || 0;
      const colCount = Number((model && model.cols) || 0) || 0;
      const cells = Array.isArray(model && model.cells) ? model.cells : [];
      if (rowCount <= 0 || colCount <= 0 || !cells.length) return "";

      const grid = Array.from({ length: rowCount }, () => Array(colCount).fill(null));
      for (const rawCell of cells) {
        const cell = rawCell && typeof rawCell === "object" ? rawCell : {};
        const r = Number(cell.r || 0) || 0;
        const c = Number(cell.c || 0) || 0;
        const rowspan = Math.max(1, Number(cell.rowspan || 1) || 1);
        const colspan = Math.max(1, Number(cell.colspan || 1) || 1);
        if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue;
        grid[r][c] = { ...cell, r, c, rowspan, colspan };
        for (let rr = r; rr < Math.min(rowCount, r + rowspan); rr += 1) {
          for (let cc = c; cc < Math.min(colCount, c + colspan); cc += 1) {
            if (rr === r && cc === c) continue;
            grid[rr][cc] = "__covered__";
          }
        }
      }

      const tableRowsRaw = [];
      for (let r = 0; r < rowCount; r += 1) {
        const rowCells = [];
        for (let c = 0; c < colCount; c += 1) {
          const slot = grid[r][c];
          if (slot === "__covered__") {
            rowCells.push({ kind: "covered", col: c });
            continue;
          }
          if (!slot) {
            rowCells.push({ kind: "empty", col: c });
            continue;
          }
          const text = formatGeneralCheckMathText(String(slot.text || ""));
          const align = String(slot.align || "left").toLowerCase();
          const valign = String(slot.valign || "top").toLowerCase();
          const style = [];
          if (["left", "center", "right"].includes(align)) style.push(`text-align:${align}`);
          if (["top", "middle", "bottom"].includes(valign)) style.push(`vertical-align:${valign}`);
          rowCells.push({
            kind: "slot",
            col: c,
            slot,
            text,
            style: style.join(";"),
          });
        }
        tableRowsRaw.push({ cells: rowCells, texts: Array.from({ length: colCount }, (_, c) => {
          const slot = grid[r][c];
          return slot && slot !== "__covered__" ? String(slot.text || "").trim() : "";
        }) });
      }
      const isGeneralCheckTitleRow = (row) => {
        const line = ((row && row.texts) || []).join(" ").replace(/\s+/g, " ").trim();
        if (!line) return false;
        if (/校准结果\/说明（续页）/.test(line)) return true;
        if (/Results\s+of\s+calibration\s+and\s+additional\s+explanation/i.test(line)) return true;
        return false;
      };
      const isGeneralCheckNoiseLine = (line) => {
        const text = String(line || "").replace(/\s+/g, " ").trim();
        if (!text) return true;
        if (/第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页/i.test(text)) return true;
        if (/page\s*of\s*total\s*pages/i.test(text)) return true;
        if (/page\s+\d+\s+of\s+\d+/i.test(text)) return true;
        if (/中国合格评定国家认可委员会|No\.?\s*CNAS/i.test(text)) return true;
        if (/本次校准所依据的技术规范|Reference documents for the calibration/i.test(text)) return true;
        if (/本次校准所使用的主要计量标准器具|Main measurement standard instruments/i.test(text)) return true;
        if (/(?:其它|其他)校准信息|Calibration Information/i.test(text)) return true;
        if (/^备注[:：]?|^Remarks[:：]?/i.test(text)) return true;
        return false;
      };
      const visibleRowsRaw = tableRowsRaw.filter((row) => {
        if (isGeneralCheckTitleRow(row)) return false;
        const line = (row.texts || []).join(" ");
        return !isGeneralCheckNoiseLine(line);
      });
      const startIdx = visibleRowsRaw.findIndex((row) => {
        const line = (row.texts || []).join(" ");
        return /(?:^|[\s])(?:一[、.．)]\s*)?一般检查|General inspection/i.test(line) || /^\(\d+\)/.test(String(line || "").trim());
      });
      const scopedRows = startIdx >= 0 ? visibleRowsRaw.slice(startIdx) : [];
      const cutIdx = scopedRows.findIndex((row) => {
        const line = (row.texts || []).join(" ");
        return /(?:以下空白|\(以下空白\)|（以下空白）)/.test(line) || /^注[:：]?|^Notes?[:：]?/i.test(String(line || "").trim());
      });
      const bodyRows = cutIdx >= 0 ? scopedRows.slice(0, cutIdx) : scopedRows;
      let maxUsedCol = -1;
      bodyRows.forEach((row) => {
        const texts = Array.isArray(row && row.texts) ? row.texts : [];
        texts.forEach((cellText, colIdx) => {
          if (String(cellText || "").trim()) maxUsedCol = Math.max(maxUsedCol, colIdx);
        });
      });
      const lastCol = Math.min(colCount - 1, Math.max(1, maxUsedCol));
      const renderCell = (entry) => {
        if (!entry || entry.kind === "covered") return "";
        if (entry.kind === "empty") return "<td></td>";
        const slot = entry.slot || {};
        const text = String(entry.text || "");
        const attrs = [];
        if (slot.rowspan > 1) attrs.push(`rowspan="${slot.rowspan}"`);
        const safeColspan = Math.max(1, Math.min(Number(slot.colspan || 1) || 1, lastCol - Number(entry.col || 0) + 1));
        if (safeColspan > 1) attrs.push(`colspan="${safeColspan}"`);
        const styleText = String(entry.style || "").trim();
        if (styleText) attrs.push(`style="${styleText}"`);
        if (!readOnly && hasDocxImageToken(text)) {
          return `<td ${attrs.join(" ")} class="general-check-media-cell">${renderRichCellHtml(text)}</td>`;
        }
        if (readOnly) return `<td ${attrs.join(" ")}>${renderRichCellHtml(text)}</td>`;
        const baseAttrs = [
          'class="general-check-wysiwyg-cell"',
          'data-field="general_check_cell"',
          'data-struct-cell="1"',
          `data-row="${slot.r}"`,
          `data-col="${slot.c}"`,
          'contenteditable="true"',
        ];
        return `<td ${[...attrs, ...baseAttrs].join(" ")}>${escapeHtml(text)}</td>`;
      };
      const tableRows = bodyRows.map((row) => {
        const cells = Array.isArray(row && row.cells) ? row.cells : [];
        const rowHtml = cells
          .filter((entry) => Number(entry && entry.col) <= lastCol)
          .map((entry) => renderCell(entry))
          .join("");
        return `<tr>${rowHtml}</tr>`;
      });
      return `
        <div class="source-recog-block source-recog-block-formatted">
          <table class="source-recog-block-table">
            <tbody>${tableRows.join("")}</tbody>
          </table>
        </div>
      `;
    }

    function trimGeneralCheckRowsForSourceReadOnly(rows) {
      const srcRows = Array.isArray(rows) ? rows : [];
      if (!srcRows.length) return [];
      const isGeneralCheckNoiseRow = (row) => {
        const cells = Array.isArray(row) ? row : [];
        const text = cells.map((x) => String(x || "").trim()).join(" ").replace(/\s+/g, " ").trim();
        if (!text) return true;
        if (/第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页/i.test(text)) return true;
        if (/page\s*of\s*total\s*pages/i.test(text)) return true;
        if (/校准证书续页专用/i.test(text)) return true;
        if (/continued\s+page\s+of\s+calibration\s+certificate/i.test(text)) return true;
        if (/shanghai\s+national\s+center\s+of\s+testing/i.test(text)) return true;
        if (/上海国缆检测股份有限公司/.test(text)) return true;
        if (/certificate\s+series\s+number/i.test(text)) return true;
        if (/缆专检号[:：]/.test(text)) return true;
        return false;
      };
      const visibleRows = srcRows.filter((row) => !isGeneralCheckNoiseRow(row));
      if (!visibleRows.length) return [];
      const isNoteStart = (row) => {
        const cells = Array.isArray(row) ? row : [];
        const text = cells.map((x) => String(x || "").trim()).join(" ");
        return /^备注[:：]?|^Remarks[:：]?|^注[:：]?|^Notes?[:：]?/i.test(text);
      };
      const isBlankTail = (row) => {
        const cells = Array.isArray(row) ? row : [];
        const text = cells.map((x) => String(x || "").trim()).join(" ");
        return /(?:以下空白|\(以下空白\)|（以下空白）)/.test(text);
      };
      const cutIdx = visibleRows.findIndex((row) => isNoteStart(row) || isBlankTail(row));
      if (cutIdx < 0) return visibleRows;
      return visibleRows.slice(0, cutIdx);
    }

    function renderGeneralCheckWysiwygBlock(blockText, options = {}) {
      const readOnly = !!(options && options.readOnly);
      const rawText = String((options && options.rawText) || "");
      const tableStruct = (options && options.tableStruct && typeof options.tableStruct === "object")
        ? options.tableStruct
        : null;
      const data = buildGeneralCheckWysiwygData(blockText, { tableStruct });
      const header = Array.isArray(data.header) ? data.header : [];
      const rows = Array.isArray(data.rows) ? data.rows : [];
      if (!header.length) return '<div class="source-recog-block">（空）</div>';
      const galleryHtml = renderGeneralCheckImageGallery(rawText, blockText);
      const toolbarHtml = "";

      if (tableStruct) {
        const structuredHtml = renderGeneralCheckStructuredTable(tableStruct, { readOnly });
        if (structuredHtml) {
          return `
            <div class="gc-editor-shell ${readOnly ? "is-readonly" : ""}">
              ${toolbarHtml}
              <div class="gc-editor-canvas">
                ${structuredHtml}
                ${galleryHtml}
              </div>
            </div>
          `;
        }
      }

      if (readOnly && !data.twoColumn) {
        const visibleRows = trimGeneralCheckRowsForSourceReadOnly(rows);
        const mergedTableHtml = renderStructuredTableHtml([header, ...visibleRows]);
        return `
          <div class="gc-editor-shell is-readonly">
            ${toolbarHtml}
            <div class="gc-editor-canvas">
              ${mergedTableHtml}
              ${galleryHtml}
            </div>
          </div>
        `;
      }

      const headHtml = `<tr>${header.map((cell, colIdx) => {
        if (data.twoColumn && colIdx === 0) return `<th style="width:120px;">${escapeHtml(cell)}</th>`;
        return `<th>${escapeHtml(cell)}</th>`;
      }).join("")}</tr>`;

      const bodyHtml = rows.map((row, rowIdx) => `<tr>${row.map((cell, colIdx) => {
        if (readOnly) {
          if (data.twoColumn && colIdx === 0) {
            return `<td style="width:120px;">${renderRichCellHtml(formatGeneralCheckMathText(cell))}</td>`;
          }
          return `<td>${renderRichCellHtml(formatGeneralCheckMathText(cell))}</td>`;
        }
        if (data.twoColumn && colIdx === 0) {
          return renderGeneralCheckEditorCell(String(cell || ""), rowIdx, colIdx, { widthStyle: "width:120px;" });
        }
        return renderGeneralCheckEditorCell(String(cell || ""), rowIdx, colIdx);
      }).join("")}</tr>`).join("");

      return `
        <div class="gc-editor-shell ${readOnly ? "is-readonly" : ""}">
          ${toolbarHtml}
          <div class="gc-editor-canvas">
            <div class="measurement-table-wrap">
              <table class="measurement-table">
                <thead>${headHtml}</thead>
                <tbody>${bodyHtml}</tbody>
              </table>
            </div>
            ${galleryHtml}
          </div>
        </div>
      `;
    }

    function parseGeneralCheckMultiColumnTable(blockText) {
      const directTableRows = parseTableRowsFromBlock(blockText);
      if (directTableRows && directTableRows.length >= 2) {
        const isGeneralCheckNoiseRow = (row) => {
          const text = (Array.isArray(row) ? row : []).map((x) => String(x || "").trim()).join(" ").replace(/\s+/g, " ").trim();
          if (!text) return true;
          if (/第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页/i.test(text)) return true;
          if (/page\s*of\s*total\s*pages/i.test(text)) return true;
          if (/page\s+\d+\s+of\s+\d+/i.test(text)) return true;
          if (/校准证书续页专用/i.test(text)) return true;
          if (/continued\s+page\s+of\s+calibration\s+certificate/i.test(text)) return true;
          if (/上海国缆检测/.test(text)) return true;
          if (/shanghai\s+national\s+center\s+of\s+testing/i.test(text)) return true;
          if (/certificate\s+series\s+number/i.test(text)) return true;
          if (/缆专检号[:：]?/.test(text)) return true;
          return false;
        };
        const filteredDirectRows = directTableRows
          .filter((row) => !isGeneralCheckNoiseRow(row))
          .filter((row) => (Array.isArray(row) ? row : []).some((cell) => String(cell || "").trim()));
        if (filteredDirectRows.length < 2) return null;
        const noteIdx = filteredDirectRows.findIndex((row) => {
          const text = (Array.isArray(row) ? row : []).map((x) => String(x || "").trim()).join(" ").trim();
          return /^注[:：]?|^Notes?[:：]?/i.test(text);
        });
        const scopedDirectRows = noteIdx >= 0 ? filteredDirectRows.slice(0, noteIdx) : filteredDirectRows;
        if (scopedDirectRows.length < 2) return null;
        const colCount = Array.isArray(scopedDirectRows[0]) ? scopedDirectRows[0].length : 0;
        if (colCount >= 3 && scopedDirectRows.every((row) => Array.isArray(row) && row.length === colCount)) {
          return scopedDirectRows.map((row) => row.map((cell) => String(cell || "").trim()));
        }
      }

      // Rebuild dynamic tables from two-column "序号/内容" lines.
      const twoColRows = parseGeneralCheckRowsFromBlock(blockText, true);
      if (!twoColRows || !twoColRows.length) return null;
      const parseSequentialHeaderDataTable = (rows) => {
        const rawTexts = (Array.isArray(rows) ? rows : [])
          .map((row) => String((row && row[1]) || "").trim())
          .filter(Boolean);
        if (rawTexts.length < 10) return null;

        const texts = [];
        for (let i = 0; i < rawTexts.length; i += 1) {
          const current = String(rawTexts[i] || "").trim();
          const next = String(rawTexts[i + 1] || "").trim();
          const currentCompact = current.replace(/\s+/g, "");
          const nextCompact = next.replace(/\s+/g, "");
          const currentIsStart = /^[A-Za-z]?\d+$/.test(currentCompact);
          const nextIsStart = /^[A-Za-z]?\d+$/.test(nextCompact);
          if (
            next
            && !currentIsStart
            && !nextIsStart
            && !/[()（）]/.test(current)
            && /[()（）]/.test(next)
            && current.length <= 24
          ) {
            texts.push(`${current}${next}`);
            i += 1;
            continue;
          }
          texts.push(current);
        }

        const isStop = (text) => /^(?:\(以下空白\)|（以下空白）|以下空白|检测员|校准员|核验员|结果[:：]?)/.test(String(text || "").trim());
        const looksLikeRowStart = (text) => /^[A-Za-z]?\d+$/.test(String(text || "").trim().replace(/\s+/g, ""));
        const norm = (text) => String(text || "").replace(/\s+/g, "").replace(/[：:，,。.;；]/g, "").toLowerCase();
        const sameHeader = (a, b) => {
          if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
          let matched = 0;
          for (let i = 0; i < a.length; i += 1) {
            if (norm(a[i]) === norm(b[i])) matched += 1;
          }
          return matched >= Math.max(2, a.length - 1);
        };
        const isLikelyHeaderToken = (text) => {
          const value = String(text || "").trim();
          if (!value) return false;
          if (isStop(value)) return false;
          if (looksLikeRowStart(value)) return false;
          return true;
        };
        const hasMetricLikeHeader = (header) => {
          const h = Array.isArray(header) ? header : [];
          const hasComplex = h.some((x) => /[()（）]|[A-Za-z]+\d*|功率|效能|误差|不确定度|结果|测量|标准|实际|频率|位置|参数/.test(String(x || "")));
          const hasShortLead = h.slice(0, 2).some((x) => String(x || "").trim().length <= 4);
          return hasComplex && hasShortLead;
        };

        for (let i = 0; i <= texts.length - 6; i += 1) {
          if (!isLikelyHeaderToken(texts[i])) continue;
          const header = [];
          let j = i;
          while (j < texts.length && header.length < 8) {
            const token = String(texts[j] || "").trim();
            if (!isLikelyHeaderToken(token)) break;
            header.push(token);
            j += 1;
            if (header.length >= 3 && j < texts.length && looksLikeRowStart(texts[j])) break;
          }
          if (header.length < 3 || header.length > 6) continue;
          if (!hasMetricLikeHeader(header)) continue;

          const colCount = header.length;
          const dataRows = [];
          let cursor = j;
          while (cursor + colCount - 1 < texts.length) {
            const first = String(texts[cursor] || "").trim();
            if (!first || isStop(first)) break;
            const maybeHeader = texts.slice(cursor, cursor + colCount);
            if (maybeHeader.length === colCount && sameHeader(maybeHeader, header)) {
              cursor += colCount;
              continue;
            }
            if (!looksLikeRowStart(first)) break;
            const row = texts.slice(cursor, cursor + colCount).map((x) => String(x || "").trim());
            if (row.length !== colCount || row.some((x) => !x || isStop(x))) break;
            dataRows.push(row);
            cursor += colCount;
          }
          if (dataRows.length >= 2) {
            return [header, ...dataRows];
          }
        }
        return null;
      };
      const sequentialTableRows = parseSequentialHeaderDataTable(twoColRows);
      if (sequentialTableRows) return sequentialTableRows;
      const isValueHeader = (text) => /^(?:标\s*称\s*值|实\s*际\s*值|显\s*示\s*值|实\s*测\s*值)\s*(?:\([^)]*\))?\s*[:：]?$/i.test(String(text || "").trim());
      const isGenericHeader = (text) => /[:：]\s*$/.test(String(text || "").trim());
      const isNumberCell = (text) => /^[+-]?\d+(?:\.\d+)?$/.test(String(text || "").trim());
      const isNumberWithUnitCell = (text) => {
        const compact = String(text || "").trim().replace(/\s+/g, "");
        return /^[+-]?\d+(?:\.\d+)?(?:[mMkK]?[ωΩ])?$/.test(compact);
      };
      const isMeasuredValueHeader = (text) => /^(?:实\s*际\s*值|实\s*测\s*值)\s*(?:\([^)]*\))?\s*[:：]?$/i.test(String(text || "").trim());
      const toRoundedIntText = (text) => {
        const compact = String(text || "").trim().replace(/\s+/g, "").replace(/[mMkK]?[ωΩ]$/i, "");
        const n = Number.parseFloat(compact);
        if (!Number.isFinite(n)) return "";
        return String(Math.round(n));
      };
      const isStopText = (text) => /^(?:\(以下空白\)|（以下空白）|以下空白)/.test(String(text || "").trim());
      const isLikelyNextHeader = (text) => isValueHeader(text) || isGenericHeader(text) || /^(?:一|二|三|四|五|六|七|八|九|十)[、.．]/.test(String(text || "").trim());
      const parseResistanceCalibrationBlock = (rows, startIndex) => {
        const current = rows[startIndex] || ["", ""];
        const marker = String(current[0] || "").trim();
        const title = String(current[1] || "").trim();
        if (!marker || !/电阻校准/.test(title)) return null;

        const out = [[marker, title]];
        let j = startIndex + 1;
        const isMarkerRow = (idx) => String((rows[idx] && rows[idx][0]) || "").trim().length > 0;
        const getText = (idx) => String((rows[idx] && rows[idx][1]) || "").trim();
        const isDecimalLike = (v) => /\./.test(String(v || "").replace(/\s+/g, ""));
        const isIntegerLike = (v) => {
          const compact = String(v || "").trim().replace(/\s+/g, "").replace(/[mMkK]?[ωΩ]$/i, "");
          return /^[-+]?\d+$/.test(compact);
        };
        const collectValues = (stopFn, unitAware = false) => {
          const values = [];
          while (j < rows.length) {
            if (isMarkerRow(j)) break;
            const t = getText(j);
            if (!t) { j += 1; continue; }
            if (stopFn && stopFn(t)) break;
            if (isStopText(t) || isLikelyNextHeader(t)) break;
            if (unitAware ? !isNumberWithUnitCell(t) : !isNumberCell(t)) break;
            values.push(t);
            j += 1;
          }
          return values;
        };

        if (j < rows.length && !isMarkerRow(j) && /全检量程/.test(getText(j))) {
          out.push(["", getText(j)]);
          j += 1;
        }

        while (j < rows.length && !isMarkerRow(j) && /标准值.*[ωΩ]/i.test(getText(j))) {
          const standardLabel = getText(j);
          j += 1;
          let nominal1 = collectValues((t) => isMeasuredValueHeader(t));
          let actualLabel = "";
          if (j < rows.length && !isMarkerRow(j) && isMeasuredValueHeader(getText(j))) {
            actualLabel = getText(j);
            j += 1;
          }
          const actualAll = collectValues((t) => /非全检量程/.test(t) || /标准值.*[ωΩ]/i.test(t));

          let actual1 = actualAll.slice();
          let nominal2 = [];
          let actual2 = [];
          for (let k = 1; k < actualAll.length - 1; k += 1) {
            if (!isIntegerLike(actualAll[k])) continue;
            if (!isDecimalLike(actualAll[k - 1])) continue;
            let m = -1;
            for (let n = k + 1; n < actualAll.length; n += 1) {
              if (isDecimalLike(actualAll[n])) { m = n; break; }
            }
            if (m > k) {
              actual1 = actualAll.slice(0, k);
              nominal2 = actualAll.slice(k, m);
              actual2 = actualAll.slice(m);
              break;
            }
          }

          if (nominal1.length && actual1.length === nominal1.length + 1) {
            const roundedActual = actual1.map((v) => toRoundedIntText(v)).filter(Boolean);
            const nominalRounded = nominal1.map((v) => toRoundedIntText(v)).filter(Boolean);
            const canAlignWithSingleMissing = (() => {
              if (roundedActual.length !== nominalRounded.length + 1) return false;
              let iNominal = 0;
              let iActual = 0;
              let usedSkip = false;
              while (iNominal < nominalRounded.length && iActual < roundedActual.length) {
                if (nominalRounded[iNominal] === roundedActual[iActual]) {
                  iNominal += 1;
                  iActual += 1;
                  continue;
                }
                if (usedSkip) return false;
                usedSkip = true;
                iActual += 1;
              }
              return iNominal === nominalRounded.length;
            })();
            if (canAlignWithSingleMissing) nominal1 = roundedActual;
          }

          if (nominal1.length) out.push(["", standardLabel, ...nominal1]);
          if (actual1.length) out.push(["", actualLabel || "实测值(Ω)：", ...actual1]);
          if (nominal2.length) out.push(["", standardLabel, ...nominal2]);
          if (actual2.length) out.push(["", actualLabel || "实测值(Ω)：", ...actual2]);
        }

        if (j < rows.length && !isMarkerRow(j) && /非全检量程/.test(getText(j))) {
          out.push(["", getText(j)]);
          j += 1;
          while (j < rows.length && !isMarkerRow(j) && /量程/.test(getText(j))) {
            let rangeVals = [];
            let standardVals = [];
            if (j < rows.length && !isMarkerRow(j) && /量程/.test(getText(j))) {
              const label = getText(j);
              j += 1;
              rangeVals = collectValues((t) => /标准值/.test(t), true);
              out.push(["", label, ...rangeVals]);
            }
            if (j < rows.length && !isMarkerRow(j) && /标准值/.test(getText(j))) {
              const label = getText(j);
              j += 1;
              standardVals = collectValues((t) => isMeasuredValueHeader(t), true);
              out.push(["", label, ...standardVals]);
            }
            if (j < rows.length && !isMarkerRow(j) && isMeasuredValueHeader(getText(j))) {
              const label = getText(j);
              j += 1;
              const vals = collectValues((t) => /量程/.test(t), true);
              const expectedGroupSize = Math.max(rangeVals.length, standardVals.length);
              if (expectedGroupSize >= 1 && vals.length >= expectedGroupSize * 2) {
                const actual1 = vals.slice(0, expectedGroupSize);
                const tail = vals.slice(expectedGroupSize);
                out.push(["", label, ...actual1]);
                if (tail.length >= expectedGroupSize * 3) {
                  const range2 = tail.slice(0, expectedGroupSize);
                  const standard2 = tail.slice(expectedGroupSize, expectedGroupSize * 2);
                  const actual2 = tail.slice(expectedGroupSize * 2, expectedGroupSize * 3);
                  out.push(["", "量程：", ...range2]);
                  out.push(["", "标准值：", ...standard2]);
                  out.push(["", "实测值：", ...actual2]);
                } else if (tail.length) {
                  out.push(["", "实测值：", ...tail]);
                }
              } else {
                out.push(["", label, ...vals]);
              }
            }
          }
        }

        return { rows: out, nextIndex: Math.max(startIndex, j - 1) };
      };
      const splitCalibrationNumericBlock = (values) => {
        const arr = Array.isArray(values) ? values.map((v) => String(v || "").trim()).filter(Boolean) : [];
        if (arr.length < 6) return null;
        if (arr.length % 2 === 0) {
          const half = arr.length / 2;
          return [arr.slice(0, half), arr.slice(half)];
        }
        const firstDecimalIdx = arr.findIndex((v) => /\./.test(v));
        if (firstDecimalIdx > 0 && firstDecimalIdx < arr.length) {
          const left = arr.slice(0, firstDecimalIdx);
          const right = arr.slice(firstDecimalIdx);
          if (left.length + 1 === right.length && left.length >= 4) {
            const toRoundedInt = (v) => {
              const n = Number.parseFloat(String(v || ""));
              if (!Number.isFinite(n)) return "";
              return String(Math.round(n));
            };
            const leftInt = left.map((v) => toRoundedInt(v));
            const rightInt = right.map((v) => toRoundedInt(v));
            const tailAligned = rightInt.slice(1).every((v, idx) => v && v === leftInt[idx]);
            if (tailAligned && rightInt[0]) {
              return [[rightInt[0], ...left], right];
            }
          }
          if (Math.abs(left.length - right.length) <= 1 && left.length >= 4 && right.length >= 4) {
            return [left, right];
          }
        }
        return null;
      };

      const rebuiltRows = [];
      let hasExpandedNumericRow = false;
      for (let i = 0; i < twoColRows.length; i += 1) {
        const marker = String((twoColRows[i] && twoColRows[i][0]) || "").trim();
        const text = String((twoColRows[i] && twoColRows[i][1]) || "").trim();
        if (!text) continue;
        if (isStopText(text)) {
          rebuiltRows.push([marker, text]);
          continue;
        }
        const resistanceParsed = parseResistanceCalibrationBlock(twoColRows, i);
        if (resistanceParsed && Array.isArray(resistanceParsed.rows) && resistanceParsed.rows.length) {
          rebuiltRows.push(...resistanceParsed.rows);
          hasExpandedNumericRow = true;
          i = Number(resistanceParsed.nextIndex || i);
          continue;
        }
        // Some templates omit "标称值/实际值" labels and only keep two numeric blocks.
        // For these rows, split the contiguous numeric block into two equal rows.
        if (marker && /校准/.test(text)) {
          const numericBlock = [];
          let j = i + 1;
          while (j < twoColRows.length) {
            const nextMarker = String((twoColRows[j] && twoColRows[j][0]) || "").trim();
            const nextText = String((twoColRows[j] && twoColRows[j][1]) || "").trim();
            if (nextMarker) break;
            if (isStopText(nextText) || isLikelyNextHeader(nextText)) break;
            if (!isNumberCell(nextText)) break;
            numericBlock.push(nextText);
            j += 1;
          }
          const splitRows = splitCalibrationNumericBlock(numericBlock);
          if (splitRows) {
            const [nominalValues, actualValues] = splitRows;
            rebuiltRows.push([marker, text]);
            rebuiltRows.push(["", "标称值(mm)：", ...nominalValues]);
            rebuiltRows.push(["", "实际值(mm)：", ...actualValues]);
            hasExpandedNumericRow = true;
            i = j - 1;
            continue;
          }
        }
        if (!isValueHeader(text) && !isGenericHeader(text)) {
          rebuiltRows.push([marker, text]);
          continue;
        }
        const values = [];
        let j = i + 1;
        while (j < twoColRows.length) {
          const nextMarker = String((twoColRows[j] && twoColRows[j][0]) || "").trim();
          const nextText = String((twoColRows[j] && twoColRows[j][1]) || "").trim();
          if (nextMarker) break;
          if (isStopText(nextText)) break;
          if (isLikelyNextHeader(nextText)) break;
          if (!isNumberCell(nextText)) break;
          values.push(nextText);
          j += 1;
        }
        if (values.length >= 1) {
          rebuiltRows.push([marker, text, ...values]);
          hasExpandedNumericRow = true;
          i = j - 1;
        } else {
          rebuiltRows.push([marker, text]);
        }
      }
      if (!hasExpandedNumericRow) return null;
      const maxCols = rebuiltRows.reduce((acc, row) => Math.max(acc, Array.isArray(row) ? row.length : 0), 0);
      if (maxCols < 3) return null;
      const header = ["序号/标记", "内容", ...Array.from({ length: maxCols - 2 }, (_, idx) => String(idx + 1))];
      const body = rebuiltRows.map((row) => {
        const normalized = Array.isArray(row) ? row.map((cell) => String(cell || "").trim()) : [];
        while (normalized.length < maxCols) normalized.push("");
        return normalized;
      });
      return [header, ...body];
    }

    function buildGeneralCheckTextFromRows(rows) {
      const safeRows = Array.isArray(rows) ? rows : [];
      return safeRows
        .map((row) => [String((row && row[0]) || "").trim(), String((row && row[1]) || "").trim()])
        .filter((row) => row[0] || row[1])
        .map((row) => `${row[0]}\t${row[1]}`.trim())
        .join("\n");
    }

    function renderStructuredBlockHtml(blockText, options = {}) {
      const forceGeneralCheckTable = !!(options && options.forceGeneralCheckTable);
      const multiColumnGeneralCheckTable = forceGeneralCheckTable ? parseGeneralCheckMultiColumnTable(blockText) : null;
      if (multiColumnGeneralCheckTable) {
        return renderStructuredTableHtml(multiColumnGeneralCheckTable);
      }
      const generalCheckRows = parseGeneralCheckRowsFromBlock(blockText, forceGeneralCheckTable);
      if (generalCheckRows) {
        const bodyHtml = generalCheckRows
          .map((row) => `<tr><td>${renderRichCellHtml(formatGeneralCheckMathText(row[0] || ""))}</td><td>${renderRichCellHtml(formatGeneralCheckMathText(row[1] || ""))}</td></tr>`)
          .join("");
        return `<div class="source-recog-block source-recog-block-formatted"><table class="source-recog-block-table general-check-table"><tbody>${bodyHtml}</tbody></table></div>`;
      }

      const tableRows = parseTableRowsFromBlock(blockText);
      if (tableRows) {
        return renderStructuredTableHtml(tableRows);
      }

      const kvRows = parseKeyValueRowsFromBlock(blockText);
      if (kvRows) {
        return kvRows.map((row) => `<div class="source-recog-item"><span class="source-recog-key">${escapeHtml(row.key)}</span><span class="source-recog-val">${renderRichCellHtml(row.value)}</span></div>`).join("");
      }

      const listRows = parseListLinesFromBlock(blockText);
      if (listRows) {
        const liHtml = listRows.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        return `<div class="source-recog-block source-recog-block-formatted"><ul class="source-recog-block-list">${liHtml}</ul></div>`;
      }

      return `<div class="source-recog-block">${renderRichCellHtml(blockText)}</div>`;
    }

    function extractGeneralCheckBlockFromItem(item) {
      if (!item) return "";
      const raw = String(
        (item.fields && item.fields.raw_record)
        || item.rawText
        || "",
      );
      return extractGeneralCheckFullBlock(raw, item.fields || {});
    }

    function extractGeneralCheckFullBlock(raw, src = {}) {
      const text = String(raw || "");
      const srcObj = (src && typeof src === "object") ? src : {};
      function sanitizeGeneralCheckFullBlock(blockText) {
        const rawText = String(blockText || "").replace(/\r/g, "");
        if (!rawText.trim()) return "";
        const startMatch = /(?:一[、.．)]\s*)?一般检查(?:\s*[（(]\s*\*\s*[）)])?|General inspection/i.exec(rawText);
        if (!startMatch) return "";
        const startPos = Math.max(0, Number(startMatch.index || 0));
        let cropped = rawText.slice(startPos);
        const stopPattern = /(?:^|\n)\s*(?:注[:：]?|Notes?[:：]?|备注[:：]?|Remarks[:：]?|检测员|校准员|核验员|(?:以下空白|\(以下空白\)|（以下空白）))/i;
        const stopMatch = stopPattern.exec(cropped);
        if (stopMatch && Number(stopMatch.index || 0) > 0) {
          cropped = cropped.slice(0, Number(stopMatch.index || 0));
        }
        const lines = cropped
          .split("\n")
          .map((x) => String(x || "").trim())
          .filter(Boolean);
        if (!lines.length) return "";
        const noisePatterns = [
          /中国合格评定国家认可委员会|No\.?\s*CNAS/i,
          /本次校准所依据的技术规范|Reference documents for the calibration/i,
          /本次校准所使用的主要计量标准器具|Main measurement standard instruments/i,
          /(?:其它|其他)校准信息|Calibration Information/i,
          /^注[:：]?\s*$/i,
          /^备注[:：]?|^Remarks[:：]?/i,
        ];
        const cleaned = [];
        let prevKey = "";
        for (const line of lines) {
          if (noisePatterns.some((pattern) => pattern.test(line)) && !/(?:一[、.．)]\s*)?一般检查|General inspection/i.test(line)) continue;
          const key = line.replace(/\s+/g, " ").toLowerCase();
          if (key && key === prevKey) continue;
          cleaned.push(line);
          prevKey = key;
        }
        return cleaned.join("\n");
      }
      const fullBlock = extractAllBlocksByLine(
        text,
        [/(?:校准结果\s*\/\s*说明|Results\s+of\s+calibration\s+and\s+additional\s+explanation)/i],
        [/(?:以下空白|\(以下空白\)|（以下空白）)/i],
      );
      const fromSrc = cleanBlockText(srcObj.general_check_full || "")
        || cleanBlockText(srcObj.general_check || "");
      if (fromSrc) return enrichGeneralCheckWithDocxImages(sanitizeGeneralCheckFullBlock(fromSrc), text);
      if (fullBlock) return enrichGeneralCheckWithDocxImages(sanitizeGeneralCheckFullBlock(fullBlock), text);
      const fallbackBlock = extractBlockByLine(
        text,
        [/(?:一[、.．)]\s*)?一般检查|General inspection/i],
        [/(?:以下空白|\(以下空白\)|（以下空白）)/i],
      );
      return enrichGeneralCheckWithDocxImages(sanitizeGeneralCheckFullBlock(fallbackBlock), text);
    }

    function maybeCopyGeneralCheckForBlankTemplate(item) {
      if (!item || !item.templateName) return;
      if (!/r[-_ ]?802b/i.test(String(item.templateName || ""))) return;
      if (!item.fields) item.fields = createEmptyFields();
      const raw = String(
        (item.fields && item.fields.raw_record)
        || item.rawText
        || "",
      );
      const extracted = extractGeneralCheckFullBlock(raw, item.fields || {}) || extractGeneralCheckBlockFromItem(item);
      if (!extracted) return;
      if (!String(item.fields.general_check_full || "").trim()) {
        item.fields.general_check_full = extracted;
      }
      if (String(item.fields.general_check || "").trim()) return;
      item.fields.general_check = extracted;
      if (!String(item.fields.measurement_items || "").trim()) {
        item.fields.measurement_items = extracted;
      }
    }

  return {
    parseGeneralCheckRowsFromBlock,
    parseGeneralCheckRowsForEditor,
    buildGeneralCheckRowsFromTableStruct,
    buildGeneralCheckWysiwygData,
    renderGeneralCheckWysiwygBlock,
    parseGeneralCheckMultiColumnTable,
    buildGeneralCheckTextFromRows,
    renderStructuredBlockHtml,
    extractGeneralCheckBlockFromItem,
    extractGeneralCheckFullBlock,
    maybeCopyGeneralCheckForBlankTemplate,
  };
}
