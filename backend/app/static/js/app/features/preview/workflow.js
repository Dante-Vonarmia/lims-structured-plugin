export function createPreviewWorkflowFeature(deps = {}) {
  const {
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
  } = deps;

  async function renderSourcePreview(item) {
    if (!item) {
      setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
      return;
    }
    const selectedNormalItems = getSelectedNormalItems();
    if (selectedNormalItems.length > 1) {
      setPreviewPlaceholder("sourcePreview", `证书模板预览：已选 ${selectedNormalItems.length} 条记录`);
      return;
    }
    try {
      revokeBlobUrl("source");
      const ext = extFromName(item.fileName);
      if (item.isRecordRow) await ensureSourceFileId(item);
      if (ext === ".xlsx") {
        await ensureSourceFileId(item);
        const fileKey = String(item.fileId || item.fileName || "");
        const preferSheet = String(item.sheetName || state.excelPreviewSheetByFileId[fileKey] || "").trim();
        const preview = await runExcelPreview(item.fileId, preferSheet);
        const sheetNames = Array.isArray(preview.sheet_names) ? preview.sheet_names.map((x) => String(x || "").trim()).filter(Boolean) : [];
        const currentSheetName = String(preview.sheet_name || "").trim();
        if (fileKey && currentSheetName) state.excelPreviewSheetByFileId[fileKey] = currentSheetName;
        const title = String(preview.title || "").trim();
        const headers = Array.isArray(preview.headers) ? preview.headers : [];
        const rows = Array.isArray(preview.rows) ? preview.rows : [];
        const rowNumbers = Array.isArray(preview.row_numbers) ? preview.row_numbers.map((x) => Number(x || 0) || 0) : [];
        if (!headers.length) {
          setPreviewPlaceholder("sourcePreview", "Excel 无可预览内容");
          return;
        }
        const targetRowNumber = Number(item.rowNumber || 0) || 0;
        const matchSheet = !item.sheetName || !currentSheetName || String(item.sheetName) === currentSheetName;
        const rowIsTarget = (rowNo) => !!(targetRowNumber > 0 && matchSheet && rowNo === targetRowNumber);
        const thead = `<tr><th>行号</th>${headers.map((h) => `<th>${escapeHtml(String(h || ""))}</th>`).join("")}</tr>`;
        const tbody = rows.map((r, idx) => {
          const rowNo = rowNumbers[idx] || 0;
          const located = rowIsTarget(rowNo);
          return `<tr data-row-number="${rowNo}" class="${located ? "located" : ""}"><td>${rowNo > 0 ? rowNo : "-"}</td>${r.map((c) => `<td>${escapeHtml(toDateOnlyDisplay(c))}</td>`).join("")}</tr>`;
        }).join("");
        const headTitle = escapeHtml(title || currentSheetName || "Excel预览");
        const sheetSelectHtml = sheetNames.length > 1
          ? `<label>Sheet：<select id="excelPreviewSheetSelect">${sheetNames.map((name) => `<option value="${escapeAttr(name)}" ${name === currentSheetName ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>`
          : "";
        const tailText = preview.truncated
          ? `仅预览前 ${rows.length} 行，实际共 ${preview.total_rows} 行`
          : "";
        const locateMiss = targetRowNumber > 0 && !rows.some((_, idx) => rowIsTarget(rowNumbers[idx] || 0))
          ? `，当前记录行 ${targetRowNumber} 未在预览范围内`
          : "";
        const tail = (tailText || locateMiss)
          ? `<div class="placeholder" style="padding:6px;">${escapeHtml(`${tailText}${locateMiss}`.replace(/^，/, ""))}</div>`
          : "";
        $("sourcePreview").innerHTML = `<div class="excel-preview-wrap"><div class="excel-preview-head"><span>${headTitle}</span><span class="excel-meta">${sheetSelectHtml || ""}</span></div><table class="excel-preview-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>${tail}</div>`;
        const locatedRow = $("sourcePreview").querySelector("tr.located");
        if (locatedRow && typeof locatedRow.scrollIntoView === "function") {
          locatedRow.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }
      const sourceBlob = item.fileId ? await fetchBlob(`/api/upload/${item.fileId}/download`) : item.file;
      if (ext === ".docx") {
        await renderDocx("sourcePreview", await sourceBlob.arrayBuffer());
      } else if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".pic"].includes(ext)) {
        const url = URL.createObjectURL(sourceBlob);
        state.blobUrls.source = url;
        $("sourcePreview").innerHTML = `<img alt="source" src="${url}" />`;
      } else if (ext === ".pdf") {
        const url = URL.createObjectURL(sourceBlob);
        state.blobUrls.source = url;
        $("sourcePreview").innerHTML = `<iframe src="${url}"></iframe>`;
      } else {
        setPreviewPlaceholder("sourcePreview", "该类型不支持证书模板预览");
      }
    } catch (error) {
      setPreviewPlaceholder("sourcePreview", `证书模板预览失败：${error.message || "unknown"}`);
    }
  }

  async function renderTargetPreview(item) {
    if (!item) {
      setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
      return;
    }
    const generateMode = getGenerateMode();
    const isModifyCertificate = generateMode === "source_file";
    const modeReports = item.modeReports && typeof item.modeReports === "object" ? item.modeReports : {};
    const modeReport = modeReports[generateMode] && typeof modeReports[generateMode] === "object" ? modeReports[generateMode] : null;
    const currentReportUrl = String((modeReport && modeReport.reportDownloadUrl) || "").trim();
    const currentReportName = String((modeReport && modeReport.reportFileName) || "").trim();
    const hasCurrentModeReport = !!(
      currentReportUrl
    );
    const selectedNormalItems = getSelectedNormalItems();
    if (selectedNormalItems.length > 1) {
      setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "证书预览" : "原始记录预览"}：已选 ${selectedNormalItems.length} 条记录`);
      return;
    }
    try {
      if (isModifyCertificate) {
        if (hasCurrentModeReport) {
          revokeBlobUrl("target");
          const blob = await fetchBlob(currentReportUrl);
          const ext = extFromName(currentReportName || item.sourceFileName || item.fileName);
          if (ext === ".docx") {
            await renderDocx("targetPreview", await blob.arrayBuffer());
          } else {
            const url = URL.createObjectURL(blob);
            state.blobUrls.target = url;
            $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
          }
          return;
        }
        revokeBlobUrl("target");
        const blueprintTemplateName = String((state.runtime && state.runtime.modifyCertificateBlueprintTemplateName) || "修改证书蓝本.docx").trim();
        if (!blueprintTemplateName) {
          setPreviewPlaceholder("targetPreview", "修改证书蓝本未配置");
          return;
        }
        const tplBlob = await fetchBlob(`/api/templates/download?template_name=${encodeURIComponent(blueprintTemplateName)}`);
        const tplExt = extFromName(blueprintTemplateName);
        if (tplExt === ".docx") {
          const docxReady = await ensureDocxLib();
          if (docxReady) {
            await renderDocx("targetPreview", await tplBlob.arrayBuffer());
          } else {
            const data = await runTemplateTextPreview(blueprintTemplateName);
            const text = String((data && data.text) || "").trim();
            const truncated = !!(data && data.truncated);
            const tail = truncated ? "\n\n[文本过长，已截断]" : "";
            $("targetPreview").innerHTML = `<div style="padding:10px;white-space:pre-wrap;line-height:1.5;font-size:12px;">${escapeHtml(text || "模板文本预览为空")}${escapeHtml(tail)}</div>`;
          }
        } else {
          const url = URL.createObjectURL(tplBlob);
          state.blobUrls.target = url;
          $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
        }
        return;
      }
      if (!hasCurrentModeReport) {
        if (!item.templateName) {
          setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
          return;
        }
        revokeBlobUrl("target");
        const tplBlob = await fetchBlob(`/api/templates/download?template_name=${encodeURIComponent(item.templateName)}`);
        const tplExt = extFromName(item.templateName);
        if (tplExt === ".docx") {
          const docxReady = await ensureDocxLib();
          if (docxReady) {
            await renderDocx("targetPreview", await tplBlob.arrayBuffer());
          } else {
            const data = await runTemplateTextPreview(item.templateName);
            const text = String((data && data.text) || "").trim();
            const truncated = !!(data && data.truncated);
            const tail = truncated ? "\n\n[文本过长，已截断]" : "";
            $("targetPreview").innerHTML = `<div style="padding:10px;white-space:pre-wrap;line-height:1.5;font-size:12px;">${escapeHtml(text || "模板文本预览为空")}${escapeHtml(tail)}</div>`;
          }
        } else {
          const url = URL.createObjectURL(tplBlob);
          state.blobUrls.target = url;
          $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
        }
        return;
      }
      revokeBlobUrl("target");
      const blob = await fetchBlob(currentReportUrl);
      const ext = extFromName(currentReportName || item.templateName || item.fileName);
      if (ext === ".docx") {
        await renderDocx("targetPreview", await blob.arrayBuffer());
        applyTargetPreviewSlotHighlights(item);
      } else {
        const url = URL.createObjectURL(blob);
        state.blobUrls.target = url;
        $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
      }
    } catch (error) {
      setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "证书预览" : "原始记录预览"}失败：${error.message || "unknown"}`);
    }
  }

  function normalizePreviewText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function classifyPreviewSlotText(text) {
    const t = normalizePreviewText(text);
    if (!t) return "";
    if (/^(温度|湿度|器具名称|制造厂\/商|型号\/规格|器具编号|序号|检测\/校准依据|检测\/校准地点)[:：]?$/.test(t)) {
      return "";
    }

    if (/结果[:：]/.test(t)) {
      return /结果[:：]\s*[√☑■]/.test(t) ? "filled" : "missing";
    }
    if (/最大(?:起始)?距离/.test(t) && /mm/i.test(t)) {
      return /最大(?:起始)?距离(?:为)?\s*\d+(?:\.\d+)?\s*mm/i.test(t) ? "filled" : "missing";
    }
    if (/检测.*校准.*依据/.test(t)) {
      const basisTailMatch = t.match(/依据[:：]?\s*(.*)$/);
      const basisTail = normalizePreviewText((basisTailMatch && basisTailMatch[1]) || "");
      if (basisTail) return "filled";
      return /(☑|√|■)/.test(t) ? "filled" : "missing";
    }
    if (/检测.*校准.*地点/.test(t)) {
      const locationTailMatch = t.match(/地点[:：]?\s*(.*)$/);
      const locationTail = normalizePreviewText((locationTailMatch && locationTailMatch[1]) || "");
      if (locationTail) return "filled";
      return /(☑|√|■)/.test(t) ? "filled" : "missing";
    }
    const labelMatch = t.match(/(序号|器具名称|制造厂\/商|型号\/规格|器具编号|检测\/校准地点|温度|湿度)\s*[:：]\s*(.*)$/);
    if (labelMatch) {
      const tail = normalizePreviewText(labelMatch[2] || "");
      if (!tail) return "missing";
      if (/^(?:[-—_/\\.%℃:：]+)$/.test(tail)) return "missing";
      if (/^(?:℃|%RH|mm)$/i.test(tail)) return "missing";
      return "filled";
    }
    if (/序号/.test(t) && /[:：]/.test(t)) {
      return /[:：]\s*.+$/.test(t) ? "filled" : "missing";
    }
    if (/检测\/校准地点/.test(t)) {
      return /[:：]\s*.+$/.test(t) ? "filled" : "missing";
    }
    if (/温度/.test(t) || /湿度/.test(t)) {
      const hasTemp = /温度\s*\d+(?:\.\d+)?\s*℃/.test(t);
      const hasHumidity = /湿度\s*\d+(?:\.\d+)?\s*%RH/i.test(t);
      if (hasTemp || hasHumidity) return "filled";
      if (/^(温度|湿度)$/.test(t)) return "";
      if (/温度|湿度/.test(t)) return "missing";
    }
    return "";
  }

  function applyTargetPreviewSlotHighlights(item) {
    if (!item || !item.reportDownloadUrl) return;
    const root = $("targetPreview");
    if (!root) return;
    const docRoot = root.querySelector(".docx") || root;
    docRoot.querySelectorAll(".preview-slot-filled,.preview-slot-missing,.preview-slot-cell").forEach((el) => {
      el.classList.remove("preview-slot-filled", "preview-slot-missing", "preview-slot-cell");
    });
    const candidates = docRoot.querySelectorAll("p, td, th");
    candidates.forEach((el) => {
      if (el.closest(".preview-slot-filled, .preview-slot-missing")) return;
      const text = normalizePreviewText(el.textContent);
      if (!text || text.length > 160) return;
      const cls = classifyPreviewSlotText(text);
      if (cls === "filled") el.classList.add("preview-slot-filled");
      if (cls === "missing") el.classList.add("preview-slot-missing");
    });
    const tables = Array.from(docRoot.querySelectorAll("table"));
    tables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (!rows.length) return;
      const headerText = rows.slice(0, 3).map((row) => normalizePreviewText(row.textContent)).join(" ");
      const isTargetValueTable = /(倍率|标准值|实际值|不确定度)/.test(headerText);
      if (!isTargetValueTable) return;
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("th, td"));
        if (cells.length < 2) return;
        const valueCell = cells[cells.length - 1];
        if (!valueCell || valueCell.classList.contains("preview-slot-filled") || valueCell.classList.contains("preview-slot-missing")) return;
        const leftText = cells.slice(0, -1).map((cell) => normalizePreviewText(cell.textContent)).join(" ");
        if (!leftText) return;
        if (/^(?:倍率|标准值|实际值|单位|序号)$/i.test(normalizePreviewText(valueCell.textContent))) return;
        const valueText = normalizePreviewText(valueCell.textContent);
        if (!valueText) {
          valueCell.classList.add("preview-slot-missing");
          return;
        }
        if (!/^(?:倍率|标准值|实际值)$/i.test(valueText)) {
          valueCell.classList.add("preview-slot-filled");
        }
      });
    });
    docRoot.querySelectorAll(".preview-slot-filled .preview-slot-filled, .preview-slot-missing .preview-slot-missing, .preview-slot-filled .preview-slot-missing, .preview-slot-missing .preview-slot-filled").forEach((el) => {
      el.classList.remove("preview-slot-filled", "preview-slot-missing");
    });
  }

  async function renderPreviews() {
    const item = getActiveItem();
    if (!item) {
      setPreviewPlaceholder("sourcePreview", "证书模板预览未加载");
      $("sourceFieldList").innerHTML = '<div class="placeholder">识别字段未加载</div>';
      $("targetFieldForm").innerHTML = '<div class="placeholder">字段表单未加载</div>';
      setPreviewPlaceholder("targetPreview", "原始记录预览未加载");
      return;
    }
    updateSourceDeviceNameText(item);
    renderSourceFieldList(item);
    renderTargetFieldForm(item);
    await renderSourcePreview(item);
    await renderTargetPreview(item);
  }

  return {
    renderSourcePreview,
    renderTargetPreview,
    renderPreviews,
  };
}
