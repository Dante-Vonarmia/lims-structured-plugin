export function createPreviewWorkflowFeature(deps = {}) {
  const {
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
  } = deps;

  function _escapeHtml(value) {
    return escapeHtml(String(value == null ? "" : value));
  }

  function _parseXml(text) {
    try {
      return new DOMParser().parseFromString(String(text || ""), "application/xml");
    } catch (_) {
      return null;
    }
  }

  function _escapeCellHtml(value) {
    return _escapeHtml(String(value == null ? "" : value));
  }

  function _parseSharedStringsMap(xZip) {
    const path = Object.keys(xZip.files).find((p) => /^xl\/sharedStrings\.xml$/i.test(p));
    if (!path) return [];
    return xZip.file(path).async("text").then((xmlText) => {
      const doc = _parseXml(xmlText);
      if (!doc) return [];
      const siList = Array.from(doc.getElementsByTagNameNS("*", "si"));
      return siList.map((si) => {
        const runs = Array.from(si.getElementsByTagNameNS("*", "r"));
        if (!runs.length) {
          const t = _text(si.getElementsByTagNameNS("*", "t")[0]);
          return _escapeCellHtml(t);
        }
        const html = runs.map((r) => {
          const t = _text(r.getElementsByTagNameNS("*", "t")[0]);
          const rPr = r.getElementsByTagNameNS("*", "rPr")[0];
          const vert = _text(rPr && rPr.getElementsByTagNameNS("*", "vertAlign")[0]);
          const szText = _text(rPr && rPr.getElementsByTagNameNS("*", "sz")[0]);
          const szVal = Number((szText || "").replace(/[^\d.]/g, ""));
          const escaped = _escapeCellHtml(t);
          if (vert === "subscript" || (Number.isFinite(szVal) && szVal > 0 && szVal <= 8)) return `<sub>${escaped}</sub>`;
          if (vert === "superscript") return `<sup>${escaped}</sup>`;
          return escaped;
        }).join("");
        return html;
      });
    }).catch(() => []);
  }

  function _readXlsxCellHtml(cellNode, sharedStrings) {
    if (!cellNode) return "";
    const cellType = String(cellNode.getAttribute("t") || "").trim().toLowerCase();
    if (cellType === "inlineStr") {
      const t = _text(cellNode.getElementsByTagNameNS("*", "t")[0]);
      return _escapeCellHtml(t);
    }
    const vText = _text(cellNode.getElementsByTagNameNS("*", "v")[0]);
    if (!vText) return "";
    if (cellType === "s") {
      const idx = Number.parseInt(vText, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length) return String(sharedStrings[idx] || "");
      return _escapeCellHtml(vText);
    }
    return _escapeCellHtml(vText);
  }

  function _colLettersToIndex(colLetters) {
    const text = String(colLetters || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (!text) return 0;
    let n = 0;
    for (let i = 0; i < text.length; i += 1) n = n * 26 + (text.charCodeAt(i) - 64);
    return n;
  }

  function _parseCellRef(ref) {
    const m = String(ref || "").match(/^([A-Z]+)(\d+)$/i);
    if (!m) return null;
    return { c: _colLettersToIndex(m[1]), r: Number.parseInt(m[2], 10) || 0 };
  }

  function _parseMergeRef(ref) {
    const m = String(ref || "").split(":");
    if (m.length !== 2) return null;
    const a = _parseCellRef(m[0]);
    const b = _parseCellRef(m[1]);
    if (!a || !b) return null;
    const r1 = Math.min(a.r, b.r);
    const r2 = Math.max(a.r, b.r);
    const c1 = Math.min(a.c, b.c);
    const c2 = Math.max(a.c, b.c);
    return { r1, c1, r2, c2 };
  }

  function _buildSheetGridModel(sheetDoc, sharedStrings, maxRows = 40, maxCols = 12) {
    const rowNodes = Array.from(sheetDoc.getElementsByTagNameNS("*", "row"));
    const cellMap = new Map();
    let maxR = 0;
    let maxC = 0;
    rowNodes.forEach((rowNode) => {
      const rAttr = Number.parseInt(String(rowNode.getAttribute("r") || "0"), 10) || 0;
      const cells = Array.from(rowNode.getElementsByTagNameNS("*", "c"));
      cells.forEach((cellNode) => {
        const ref = _parseCellRef(cellNode.getAttribute("r"));
        if (!ref) return;
        const key = `${ref.r}:${ref.c}`;
        const html = _readXlsxCellHtml(cellNode, sharedStrings);
        cellMap.set(key, html);
        if (ref.r > maxR) maxR = ref.r;
        if (ref.c > maxC) maxC = ref.c;
      });
      if (rAttr > maxR) maxR = rAttr;
    });
    maxR = Math.min(Math.max(1, maxR), maxRows);
    maxC = Math.min(Math.max(1, maxC), maxCols);

    const mergeMaster = new Map();
    const mergeCovered = new Set();
    const mergeNodes = Array.from(sheetDoc.getElementsByTagNameNS("*", "mergeCell"));
    mergeNodes.forEach((mNode) => {
      const parsed = _parseMergeRef(mNode.getAttribute("ref"));
      if (!parsed) return;
      if (parsed.r1 > maxR || parsed.c1 > maxC) return;
      const r2 = Math.min(parsed.r2, maxR);
      const c2 = Math.min(parsed.c2, maxC);
      const rowspan = Math.max(1, r2 - parsed.r1 + 1);
      const colspan = Math.max(1, c2 - parsed.c1 + 1);
      const masterKey = `${parsed.r1}:${parsed.c1}`;
      mergeMaster.set(masterKey, { rowspan, colspan });
      for (let r = parsed.r1; r <= r2; r += 1) {
        for (let c = parsed.c1; c <= c2; c += 1) {
          if (r === parsed.r1 && c === parsed.c1) continue;
          mergeCovered.add(`${r}:${c}`);
        }
      }
    });

    return { maxR, maxC, cellMap, mergeMaster, mergeCovered };
  }

  function _text(node) {
    return String((node && node.textContent) || "").trim();
  }

  function _ptValues(cacheNode) {
    if (!cacheNode) return [];
    const pts = Array.from(cacheNode.getElementsByTagNameNS("*", "pt"));
    const parsed = pts.map((pt) => ({
      idx: Number((pt && pt.getAttribute && pt.getAttribute("idx")) || 0) || 0,
      value: _text(pt.getElementsByTagNameNS("*", "v")[0]),
    }));
    parsed.sort((a, b) => a.idx - b.idx);
    return parsed.map((x) => x.value);
  }

  function _extractSeriesValues(serNode) {
    const txNode = serNode && serNode.getElementsByTagNameNS("*", "tx")[0];
    const name = _text((txNode && txNode.getElementsByTagNameNS("*", "v")[0]) || (txNode && txNode.getElementsByTagNameNS("*", "t")[0]) || null) || "Series";
    const catNode = serNode && serNode.getElementsByTagNameNS("*", "cat")[0];
    const valNode = serNode && serNode.getElementsByTagNameNS("*", "val")[0];
    const catCache = (catNode && (catNode.getElementsByTagNameNS("*", "strCache")[0] || catNode.getElementsByTagNameNS("*", "numCache")[0])) || null;
    const valCache = (valNode && (valNode.getElementsByTagNameNS("*", "numCache")[0] || valNode.getElementsByTagNameNS("*", "strCache")[0])) || null;
    const categories = _ptValues(catCache);
    const valuesRaw = _ptValues(valCache);
    const values = valuesRaw.map((x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    });
    return { name, categories, values };
  }

  function _extractScatterSeriesValues(serNode) {
    const txNode = serNode && serNode.getElementsByTagNameNS("*", "tx")[0];
    const name = _text((txNode && txNode.getElementsByTagNameNS("*", "v")[0]) || (txNode && txNode.getElementsByTagNameNS("*", "t")[0]) || null) || "Series";
    const xNode = serNode && serNode.getElementsByTagNameNS("*", "xVal")[0];
    const yNode = serNode && serNode.getElementsByTagNameNS("*", "yVal")[0];
    const xCache = (xNode && (xNode.getElementsByTagNameNS("*", "numCache")[0] || xNode.getElementsByTagNameNS("*", "strCache")[0])) || null;
    const yCache = (yNode && (yNode.getElementsByTagNameNS("*", "numCache")[0] || yNode.getElementsByTagNameNS("*", "strCache")[0])) || null;
    const xs = _ptValues(xCache).map((x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    });
    const ys = _ptValues(yCache).map((x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    });
    const points = [];
    const len = Math.min(xs.length, ys.length);
    for (let i = 0; i < len; i += 1) {
      if (typeof xs[i] === "number" && typeof ys[i] === "number") points.push([xs[i], ys[i]]);
    }
    return { name, points };
  }

  function _renderSimpleLineChartHtml(chart, index) {
    const series = Array.isArray(chart.series) ? chart.series : [];
    const categories = Array.isArray(chart.categories) ? chart.categories : [];
    const width = 760;
    const height = 320;
    const padLeft = 56;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 36;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const allValues = [];
    series.forEach((s) => {
      (s.values || []).forEach((v) => {
        if (typeof v === "number" && Number.isFinite(v)) allValues.push(v);
      });
    });
    const min = allValues.length ? Math.min(...allValues) : 0;
    const max = allValues.length ? Math.max(...allValues) : 1;
    const lo = min === max ? min - 1 : min;
    const hi = min === max ? max + 1 : max;
    const xCount = Math.max(2, categories.length || ((series[0] && series[0].values && series[0].values.length) || 2));
    const xAt = (i) => padLeft + (plotW * i) / (xCount - 1);
    const yAt = (v) => padTop + ((hi - v) / (hi - lo)) * plotH;
    const colors = ["#222", "#136f63", "#9a3412", "#1d4ed8"];
    const lines = series.map((s, si) => {
      const pts = (s.values || []).map((v, i) => {
        if (typeof v !== "number" || !Number.isFinite(v)) return "";
        return `${xAt(i)},${yAt(v)}`;
      }).filter(Boolean).join(" ");
      return `<polyline fill="none" stroke="${colors[si % colors.length]}" stroke-width="2" points="${pts}" />`;
    }).join("");
    const xTicks = Array.from({ length: Math.min(xCount, 8) }).map((_, i) => {
      const idx = Math.round((i * (xCount - 1)) / Math.max(1, Math.min(xCount, 8) - 1));
      const x = xAt(idx);
      const label = categories[idx] || String(idx + 1);
      return `<g><line x1="${x}" y1="${padTop + plotH}" x2="${x}" y2="${padTop + plotH + 4}" stroke="#666"/><text x="${x}" y="${padTop + plotH + 18}" font-size="10" text-anchor="middle" fill="#333">${_escapeHtml(label)}</text></g>`;
    }).join("");
    const yTicks = Array.from({ length: 5 }).map((_, i) => {
      const t = i / 4;
      const v = hi - (hi - lo) * t;
      const y = padTop + plotH * t;
      return `<g><line x1="${padLeft - 4}" y1="${y}" x2="${padLeft}" y2="${y}" stroke="#666"/><line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#eee"/><text x="${padLeft - 8}" y="${y + 3}" font-size="10" text-anchor="end" fill="#333">${_escapeHtml(v.toFixed(2))}</text></g>`;
    }).join("");
    const legend = series.map((s, i) => `<span style="margin-right:10px;"><i style="display:inline-block;width:10px;height:2px;background:${colors[i % colors.length]};vertical-align:middle;margin-right:4px;"></i>${_escapeHtml(s.name || `Series ${i + 1}`)}</span>`).join("");
    return `<div style="width:100%;box-sizing:border-box;border:1px solid #d9e2ef;border-radius:6px;background:#fff;padding:8px;margin-top:8px;">
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;background:#fff">
        <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#cfd8e3"/>
        ${yTicks}
        ${xTicks}
        ${lines}
      </svg>
      <div style="font-size:11px;color:#334155;">${legend}</div>
    </div>`;
  }

  function _renderSimpleScatterChartHtml(chart, index) {
    const series = Array.isArray(chart.series) ? chart.series : [];
    const width = 760;
    const height = 320;
    const padLeft = 56;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 36;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const allX = [];
    const allY = [];
    series.forEach((s) => {
      (s.points || []).forEach((pt) => {
        if (Array.isArray(pt) && pt.length >= 2) {
          if (typeof pt[0] === "number") allX.push(pt[0]);
          if (typeof pt[1] === "number") allY.push(pt[1]);
        }
      });
    });
    const xMin0 = allX.length ? Math.min(...allX) : 0;
    const xMax0 = allX.length ? Math.max(...allX) : 1;
    const yMin0 = allY.length ? Math.min(...allY) : 0;
    const yMax0 = allY.length ? Math.max(...allY) : 1;
    const xMin = xMin0 === xMax0 ? xMin0 - 1 : xMin0;
    const xMax = xMin0 === xMax0 ? xMax0 + 1 : xMax0;
    const yMin = yMin0 === yMax0 ? yMin0 - 1 : yMin0;
    const yMax = yMin0 === yMax0 ? yMax0 + 1 : yMax0;
    const xAt = (x) => padLeft + ((x - xMin) / (xMax - xMin)) * plotW;
    const yAt = (y) => padTop + ((yMax - y) / (yMax - yMin)) * plotH;
    const colors = ["#222", "#136f63", "#9a3412", "#1d4ed8"];
    const lines = series.map((s, si) => {
      const pts = (s.points || []).map((pt) => `${xAt(pt[0])},${yAt(pt[1])}`).join(" ");
      return `<polyline fill="none" stroke="${colors[si % colors.length]}" stroke-width="2" points="${pts}" />`;
    }).join("");
    const xTicks = Array.from({ length: 6 }).map((_, i) => {
      const xVal = xMin + ((xMax - xMin) * i) / 5;
      const x = xAt(xVal);
      return `<g><line x1="${x}" y1="${padTop + plotH}" x2="${x}" y2="${padTop + plotH + 4}" stroke="#666"/><text x="${x}" y="${padTop + plotH + 18}" font-size="10" text-anchor="middle" fill="#333">${_escapeHtml(xVal.toFixed(2))}</text></g>`;
    }).join("");
    const yTicks = Array.from({ length: 5 }).map((_, i) => {
      const t = i / 4;
      const v = yMax - (yMax - yMin) * t;
      const y = padTop + plotH * t;
      return `<g><line x1="${padLeft - 4}" y1="${y}" x2="${padLeft}" y2="${y}" stroke="#666"/><line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#eee"/><text x="${padLeft - 8}" y="${y + 3}" font-size="10" text-anchor="end" fill="#333">${_escapeHtml(v.toFixed(2))}</text></g>`;
    }).join("");
    return `<div style="width:100%;box-sizing:border-box;border:1px solid #d9e2ef;border-radius:6px;background:#fff;padding:8px;margin-top:8px;">
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;background:#fff">
        <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#cfd8e3"/>
        ${yTicks}
        ${xTicks}
        ${lines}
      </svg>
    </div>`;
  }

  function _normalizeDocxPartPath(baseDir, target) {
    const raw = String(target || "").trim().replace(/\\/g, "/");
    if (!raw) return "";
    if (/^[a-z]+:/i.test(raw)) return "";
    const base = String(baseDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (raw.startsWith("/")) return raw.replace(/^\/+/, "");
    const stack = base ? base.split("/").filter(Boolean) : [];
    const parts = raw.split("/").filter((x) => x && x !== ".");
    parts.forEach((part) => {
      if (part === "..") {
        if (stack.length) stack.pop();
        return;
      }
      stack.push(part);
    });
    return stack.join("/");
  }

  function _readRelId(node) {
    if (!node || !node.attributes) return "";
    if (typeof node.getAttribute === "function") {
      const rid = node.getAttribute("r:id")
        || node.getAttribute("id")
        || node.getAttribute("r:embed")
        || node.getAttribute("embed")
        || node.getAttribute("r:link")
        || node.getAttribute("link");
      if (rid) return String(rid || "").trim();
    }
    const attrs = Array.from(node.attributes || []);
    const relAttr = attrs.find((attr) => {
      const local = String((attr && attr.localName) || "");
      const name = String((attr && attr.name) || "");
      return local === "id"
        || local === "embed"
        || local === "link"
        || name === "r:id"
        || name === "r:embed"
        || name === "r:link"
        || name.endsWith(":id")
        || name.endsWith(":embed")
        || name.endsWith(":link");
    });
    return String((relAttr && relAttr.value) || "").trim();
  }

  function _extractParagraphText(pNode) {
    if (!pNode) return "";
    const tNodes = Array.from(pNode.getElementsByTagNameNS("*", "t"));
    return tNodes.map((t) => String((t && t.textContent) || "")).join("").replace(/\s+/g, " ").trim();
  }

  function _imageMimeFromPath(path) {
    const p = String(path || "").toLowerCase();
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    if (p.endsWith(".gif")) return "image/gif";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".bmp")) return "image/bmp";
    if (p.endsWith(".tif") || p.endsWith(".tiff")) return "image/tiff";
    return "";
  }

  function _emuToPx(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round((n * 96) / 914400);
  }

  function _readImageSizeFromBlipNode(imageNode) {
    if (!imageNode) return { widthPx: 0, heightPx: 0 };
    let drawingNode = null;
    let cursor = imageNode;
    while (cursor && cursor.nodeType === 1) {
      if (String(cursor.localName || "").toLowerCase() === "drawing") {
        drawingNode = cursor;
        break;
      }
      cursor = cursor.parentNode;
    }
    if (!drawingNode) return { widthPx: 0, heightPx: 0 };
    const extentNode = drawingNode.getElementsByTagNameNS("*", "extent")[0] || null;
    if (!extentNode || typeof extentNode.getAttribute !== "function") return { widthPx: 0, heightPx: 0 };
    const widthPx = _emuToPx(extentNode.getAttribute("cx"));
    const heightPx = _emuToPx(extentNode.getAttribute("cy"));
    return { widthPx, heightPx };
  }

  function _renderEmbeddedImageHtml(dataUrl, widthPx, heightPx) {
    const widthStyle = Number.isFinite(Number(widthPx)) && Number(widthPx) > 0 ? `width:${Math.round(Number(widthPx))}px;` : "";
    const heightStyle = Number.isFinite(Number(heightPx)) && Number(heightPx) > 0 ? `max-height:${Math.round(Number(heightPx))}px;` : "";
    return `<div style="width:auto;max-width:100%;display:inline-block;box-sizing:border-box;margin-top:8px;">
      <img alt="embedded-image" src="${dataUrl}" style="display:block;max-width:100%;height:auto;${widthStyle}${heightStyle}margin:0 auto;" />
    </div>`;
  }

  async function _readDocxRelationships(zip, relPath, baseDir) {
    if (!zip) return new Map();
    const relFile = zip.file(relPath);
    if (!relFile) return new Map();
    let text = "";
    try {
      text = await relFile.async("text");
    } catch (_) {
      text = "";
    }
    const doc = _parseXml(text);
    if (!doc) return new Map();
    const map = new Map();
    const relNodes = Array.from(doc.getElementsByTagNameNS("*", "Relationship"));
    relNodes.forEach((relNode) => {
      const id = String((relNode && relNode.getAttribute && relNode.getAttribute("Id")) || "").trim();
      const target = String((relNode && relNode.getAttribute && relNode.getAttribute("Target")) || "").trim();
      const targetMode = String((relNode && relNode.getAttribute && relNode.getAttribute("TargetMode")) || "").trim().toLowerCase();
      if (!id || !target || targetMode === "external") return;
      const normalizedPath = _normalizeDocxPartPath(baseDir, target);
      if (normalizedPath) map.set(id, normalizedPath);
    });
    return map;
  }

  async function _extractDocxEmbeddedObjectSequence(zip) {
    if (!zip) return [];
    const docFile = zip.file("word/document.xml");
    if (!docFile) return [];
    let docText = "";
    try {
      docText = await docFile.async("text");
    } catch (_) {
      docText = "";
    }
    const doc = _parseXml(docText);
    if (!doc) return [];
    const relMap = await _readDocxRelationships(zip, "word/_rels/document.xml.rels", "word");
    if (!relMap.size) return [];

    const blocks = [];
    const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"));
    const pTexts = paragraphs.map((pNode) => _extractParagraphText(pNode));
    const findPrevNonEmptyText = (idx) => {
      for (let i = idx; i >= 0; i -= 1) {
        const t = String(pTexts[i] || "").trim();
        if (t) return t;
      }
      return "";
    };
    const findNextNonEmptyText = (idx) => {
      for (let i = idx; i < pTexts.length; i += 1) {
        const t = String(pTexts[i] || "").trim();
        if (t) return t;
      }
      return "";
    };
    paragraphs.forEach((pNode, idx) => {
      const pText = pTexts[idx];
      const anchorBefore = findPrevNonEmptyText(idx);
      const anchorAfter = findNextNonEmptyText(idx + 1);
      const anchorText = pText || anchorBefore || anchorAfter;
      const chartNodes = Array.from(pNode.getElementsByTagNameNS("*", "chart"));
      chartNodes.forEach((chartNode) => {
        const rid = _readRelId(chartNode);
        const path = relMap.get(rid) || "";
        if (!path || !/^word\/charts\/chart\d+\.xml$/i.test(path)) return;
        blocks.push({ type: "chart", path, anchorText, anchorBefore, anchorAfter });
      });
      const imageNodes = Array.from(pNode.getElementsByTagNameNS("*", "blip"));
      imageNodes.forEach((imageNode) => {
        const rid = _readRelId(imageNode);
        const path = relMap.get(rid) || "";
        if (!path || !/^word\/media\/.+\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(path)) return;
        const size = _readImageSizeFromBlipNode(imageNode);
        blocks.push({ type: "image", path, anchorText, anchorBefore, anchorAfter, widthPx: Number(size.widthPx || 0), heightPx: Number(size.heightPx || 0) });
      });
      const oleNodes = Array.from(pNode.getElementsByTagNameNS("*", "OLEObject"))
        .concat(Array.from(pNode.getElementsByTagNameNS("*", "oleObject")));
      oleNodes.forEach((oleNode) => {
        const rid = _readRelId(oleNode);
        const path = relMap.get(rid) || "";
        if (!path || !/^word\/embeddings\/.*\.xlsx$/i.test(path)) return;
        blocks.push({ type: "table", path, anchorText, anchorBefore, anchorAfter });
      });
    });
    return blocks;
  }

  async function _readDocxEmbeddedOnlyReadHtml(arrayBuffer) {
    if (!window.JSZip || !arrayBuffer) return "";
    let zip;
    try {
      zip = await window.JSZip.loadAsync(arrayBuffer);
    } catch (_) {
      return "";
    }

    const chartEntries = Object.keys(zip.files).filter((p) => /^word\/charts\/chart\d+\.xml$/i.test(p)).sort();
    const chartLinkedXlsxSet = new Set();
    const chartRelEntries = Object.keys(zip.files).filter((p) => /^word\/charts\/_rels\/chart\d+\.xml\.rels$/i.test(p)).sort();
    for (let i = 0; i < chartRelEntries.length; i += 1) {
      const relPath = chartRelEntries[i];
      let relText = "";
      try {
        relText = await zip.file(relPath).async("text");
      } catch (_) {
        relText = "";
      }
      const relDoc = _parseXml(relText);
      if (!relDoc) continue;
      const rels = Array.from(relDoc.getElementsByTagNameNS("*", "Relationship"));
      rels.forEach((rel) => {
        const target = String((rel && rel.getAttribute && rel.getAttribute("Target")) || "").trim();
        if (!/embeddings\/.*\.xlsx$/i.test(target)) return;
        const normalized = target.startsWith("../")
          ? `word/${target.replace(/^\.\.\//, "")}`
          : (target.startsWith("word/") ? target : `word/charts/${target}`);
        const clean = normalized.replace(/^word\/charts\/\.\.\//, "word/");
        chartLinkedXlsxSet.add(clean);
      });
    }
    const chartItems = [];
    const chartHtmlByPath = new Map();
    for (let i = 0; i < chartEntries.length; i += 1) {
      const path = chartEntries[i];
      let text = "";
      try {
        text = await zip.file(path).async("text");
      } catch (_) {
        text = "";
      }
      const doc = _parseXml(text);
      if (!doc) continue;
      const chartNode = doc.getElementsByTagNameNS("*", "chart")[0];
      let title = "";
      if (chartNode && chartNode.children) {
        const directTitle = Array.from(chartNode.children).find((n) => String((n && n.localName) || "") === "title");
        if (directTitle) title = _text(directTitle);
      }
      const lineChart = doc.getElementsByTagNameNS("*", "lineChart")[0];
      const scatterChart = doc.getElementsByTagNameNS("*", "scatterChart")[0];
      if (lineChart) {
        const serNodes = Array.from(lineChart.getElementsByTagNameNS("*", "ser"));
        if (serNodes.length) {
          const series = serNodes.map((node) => _extractSeriesValues(node));
          const categories = (series.find((s) => Array.isArray(s.categories) && s.categories.length) || {}).categories || [];
          const html = _renderSimpleLineChartHtml({ title, series, categories }, i);
          chartItems.push({ type: "chart", path, html });
          chartHtmlByPath.set(path, html);
        }
      } else if (scatterChart) {
        const serNodes = Array.from(scatterChart.getElementsByTagNameNS("*", "ser"));
        if (serNodes.length) {
          const series = serNodes.map((node) => _extractScatterSeriesValues(node));
          const html = _renderSimpleScatterChartHtml({ title, series }, i);
          chartItems.push({ type: "chart", path, html });
          chartHtmlByPath.set(path, html);
        }
      }
    }

    const imageEntries = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(p)).sort();
    const imageDataUrlByPath = new Map();
    for (let i = 0; i < imageEntries.length; i += 1) {
      const path = imageEntries[i];
      const mime = _imageMimeFromPath(path);
      if (!mime) continue;
      let base64 = "";
      try {
        base64 = await zip.file(path).async("base64");
      } catch (_) {
        base64 = "";
      }
      if (!base64) continue;
      imageDataUrlByPath.set(path, `data:${mime};base64,${base64}`);
    }

    const xlsxEntriesAll = Object.keys(zip.files).filter((p) => /^word\/embeddings\/.*\.xlsx$/i.test(p)).sort();
    const xlsxEntriesPreferred = xlsxEntriesAll.filter((p) => !chartLinkedXlsxSet.has(p));
    const xlsxEntries = xlsxEntriesPreferred.length ? xlsxEntriesPreferred : xlsxEntriesAll;
    const tableItems = [];
    const tableHtmlByPath = new Map();
    for (let i = 0; i < xlsxEntries.length; i += 1) {
      const xlsxPath = xlsxEntries[i];
      let xZip;
      try {
        const xArr = await zip.file(xlsxPath).async("arraybuffer");
        xZip = await window.JSZip.loadAsync(xArr);
      } catch (_) {
        xZip = null;
      }
      if (!xZip) continue;
      const sharedStrings = await _parseSharedStringsMap(xZip);
      let sheetXml = "";
      const sheetPath = Object.keys(xZip.files).find((p) => /^xl\/worksheets\/sheet1\.xml$/i.test(p)) || Object.keys(xZip.files).find((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p));
      if (!sheetPath) continue;
      try {
        sheetXml = await xZip.file(sheetPath).async("text");
      } catch (_) {
        sheetXml = "";
      }
      const sheetDoc = _parseXml(sheetXml);
      if (!sheetDoc) continue;
      const model = _buildSheetGridModel(sheetDoc, sharedStrings, 160, 12);
      const trs = Array.from({ length: model.maxR }).map((_, rIdx) => {
        const r = rIdx + 1;
        const cellsHtml = [];
        for (let c = 1; c <= model.maxC; c += 1) {
          const key = `${r}:${c}`;
          if (model.mergeCovered.has(key)) continue;
          const vHtml = model.cellMap.get(key) || "";
          const span = model.mergeMaster.get(key) || null;
          const spanAttr = `${span && span.rowspan > 1 ? ` rowspan="${span.rowspan}"` : ""}${span && span.colspan > 1 ? ` colspan="${span.colspan}"` : ""}`;
          if (r === 1) {
            cellsHtml.push(`<th${spanAttr} style="border:1px solid #cbd5e1;padding:3px 6px;font-size:11px;font-weight:600;background:#f8fafc;">${vHtml}</th>`);
          } else {
            cellsHtml.push(`<td${spanAttr} style="border:1px solid #dbe3ef;padding:2px 6px;font-size:11px;">${vHtml}</td>`);
          }
        }
        return `<tr>${cellsHtml.join("")}</tr>`;
      }).join("");
      if (!trs) continue;
      const html = `<div style="display:inline-block;border:1px solid #d9e2ef;border-radius:6px;background:#fff;padding:8px;margin-top:8px;">
        <div><table style="border-collapse:collapse;background:#fff;">${trs}</table></div>
      </div>`;
      tableItems.push({ type: "table", path: xlsxPath, html });
      tableHtmlByPath.set(xlsxPath, html);
    }

    const chartItemsUnused = [...chartItems];
    const imageItemsUnused = imageEntries
      .filter((p) => imageDataUrlByPath.has(p))
      .map((p) => ({ type: "image", path: p, html: _renderEmbeddedImageHtml(String(imageDataUrlByPath.get(p) || ""), 0, 0) }));
    const tableItemsUnused = [...tableItems];
    const takeByPathOrShift = (unused, htmlByPath, path) => {
      const normalizedPath = String(path || "").trim();
      const hasPathHit = normalizedPath && htmlByPath.has(normalizedPath);
      if (hasPathHit) {
        const index = unused.findIndex((x) => String(x.path || "") === normalizedPath);
        if (index >= 0) {
          const hit = unused.splice(index, 1)[0];
          return hit && hit.html ? hit.html : "";
        }
      }
      const next = unused.shift();
      return next && next.html ? next.html : "";
    };
    const orderedBlocks = [];
    const objectSequence = await _extractDocxEmbeddedObjectSequence(zip);
    objectSequence.forEach((objectNode) => {
      if (!objectNode || !objectNode.type) return;
      if (objectNode.type === "chart") {
        const html = takeByPathOrShift(chartItemsUnused, chartHtmlByPath, objectNode.path);
        if (html) {
          orderedBlocks.push({
            type: "chart",
            html,
            anchorText: objectNode.anchorText || "",
            anchorBefore: objectNode.anchorBefore || "",
            anchorAfter: objectNode.anchorAfter || "",
          });
        }
        return;
      }
      if (objectNode.type === "table") {
        const html = takeByPathOrShift(tableItemsUnused, tableHtmlByPath, objectNode.path);
        if (html) {
          orderedBlocks.push({
            type: "table",
            html,
            anchorText: objectNode.anchorText || "",
            anchorBefore: objectNode.anchorBefore || "",
            anchorAfter: objectNode.anchorAfter || "",
          });
        }
        return;
      }
      if (objectNode.type === "image") {
        const dataUrl = String(imageDataUrlByPath.get(String(objectNode.path || "").trim()) || "");
        const html = dataUrl
          ? _renderEmbeddedImageHtml(dataUrl, Number(objectNode.widthPx || 0), Number(objectNode.heightPx || 0))
          : takeByPathOrShift(imageItemsUnused, new Map(), objectNode.path);
        if (html) {
          orderedBlocks.push({
            type: "image",
            html,
            anchorText: objectNode.anchorText || "",
            anchorBefore: objectNode.anchorBefore || "",
            anchorAfter: objectNode.anchorAfter || "",
          });
        }
      }
    });
    chartItemsUnused.forEach((item) => {
      if (item && item.html) orderedBlocks.push({ type: "chart", html: item.html, anchorText: "", anchorBefore: "", anchorAfter: "" });
    });
    imageItemsUnused.forEach((item) => {
      if (item && item.html) orderedBlocks.push({ type: "image", html: item.html, anchorText: "", anchorBefore: "", anchorAfter: "" });
    });
    tableItemsUnused.forEach((item) => {
      if (item && item.html) orderedBlocks.push({ type: "table", html: item.html, anchorText: "", anchorBefore: "", anchorAfter: "" });
    });
    const chartBlocks = orderedBlocks.filter((x) => x.type === "chart").map((x) => x.html);
    const tableBlocks = orderedBlocks.filter((x) => x.type === "table").map((x) => x.html);
    if (!orderedBlocks.length) return null;
    return {
      blocks: orderedBlocks,
      chartBlocks,
      tableBlocks,
      summaryHtml: "",
    };
  }

  function _findSourceAnchorByPattern(sourceEl, pattern) {
    if (!sourceEl) return null;
    const nodes = Array.from(sourceEl.querySelectorAll("p, div, span, td"));
    return nodes.find((node) => pattern.test(String((node && node.textContent) || "").replace(/\s+/g, ""))) || null;
  }

  function _injectEmbeddedBlocksAtAnchors(sourceEl, parsed) {
    if (!sourceEl || !parsed) return { inserted: 0, total: 0 };
    const allowImageBlocks = String((sourceEl && sourceEl.id) || "") === "targetPreview";
    const orderedBlocks = Array.isArray(parsed.blocks) && parsed.blocks.length
      ? parsed.blocks.map((x) => ({
        type: String((x && x.type) || ""),
        html: String((x && x.html) || ""),
        anchorText: String((x && x.anchorText) || ""),
        anchorBefore: String((x && x.anchorBefore) || ""),
        anchorAfter: String((x && x.anchorAfter) || ""),
      })).filter((x) => allowImageBlocks || x.type !== "image")
      : [
        ...(Array.isArray(parsed.tableBlocks) ? parsed.tableBlocks.map((html) => ({ type: "table", html: String(html || ""), anchorText: "", anchorBefore: "", anchorAfter: "" })) : []),
        ...(Array.isArray(parsed.chartBlocks) ? parsed.chartBlocks.map((html) => ({ type: "chart", html: String(html || ""), anchorText: "", anchorBefore: "", anchorAfter: "" })) : []),
      ];
    const total = orderedBlocks.length;
    if (!total) return { inserted: 0, total: 0 };

    const used = [];
    const insertAfter = (anchor, html) => {
      if (!anchor || !html) return false;
      const wrap = document.createElement("div");
      wrap.className = "docx-embedded-onlyread";
      wrap.style.margin = "6px 0";
      wrap.style.display = "flex";
      wrap.style.width = "100%";
      wrap.style.justifyContent = "center";
      wrap.innerHTML = html;
      anchor.insertAdjacentElement("afterend", wrap);
      used.push(wrap);
      return true;
    };
    const insertInCell = (anchor, html) => {
      if (!anchor || !html) return false;
      const cell = anchor.closest ? anchor.closest("td,th") : null;
      if (!cell) return insertAfter(anchor, html);
      const wrap = document.createElement("div");
      wrap.className = "docx-embedded-onlyread";
      wrap.style.margin = "6px 0";
      wrap.style.display = "flex";
      wrap.style.width = "100%";
      wrap.style.justifyContent = "center";
      wrap.innerHTML = html;
      cell.appendChild(wrap);
      used.push(wrap);
      return true;
    };
    const norm = (x) => String(x || "").replace(/\s+/g, "").replace(/[^\p{L}\p{N}%.-]/gu, "");
    const nodes = Array.from(sourceEl.querySelectorAll("p,span,div,td,th")).filter((node) => !node.closest(".docx-embedded-onlyread"));
    const fallbackNodes = nodes.filter((node) => /频带宽度|曲线图|曲线绘制|图表|散点|line|scatter/i.test(String((node && node.textContent) || "")));

    const pickAnchorNode = (anchorTexts, cursorIdx) => {
      const candidates = (Array.isArray(anchorTexts) ? anchorTexts : [anchorTexts])
        .map((x) => norm(x))
        .filter(Boolean)
        .map((x) => x.slice(0, 24))
        .filter(Boolean);
      if (!candidates.length) return null;
      const start = Math.max(0, Number(cursorIdx || 0));
      for (let i = start; i < nodes.length; i += 1) {
        const nodeText = norm(nodes[i].textContent);
        if (!nodeText) continue;
        if (candidates.some((key) => nodeText.includes(key) || key.includes(nodeText))) return { node: nodes[i], idx: i };
      }
      for (let i = 0; i < start && i < nodes.length; i += 1) {
        const nodeText = norm(nodes[i].textContent);
        if (!nodeText) continue;
        if (candidates.some((key) => nodeText.includes(key) || key.includes(nodeText))) return { node: nodes[i], idx: i };
      }
      return null;
    };

    const rows = Array.from(sourceEl.querySelectorAll("tr"));
    const rowText = rows.map((r) => norm(r.textContent));
    const findSectionBandAnchor = (numberRe, titleRe) => {
      if (!rows.length) return null;
      let sectionIdx = -1;
      for (let i = 0; i < rowText.length; i += 1) {
        const t = rowText[i];
        if (numberRe.test(t) && titleRe.test(t)) {
          sectionIdx = i;
          break;
        }
      }
      if (sectionIdx < 0) {
        for (let i = 0; i < rowText.length; i += 1) {
          if (!numberRe.test(rowText[i])) continue;
          for (let j = i; j < Math.min(rowText.length, i + 8); j += 1) {
            if (titleRe.test(rowText[j])) {
              sectionIdx = j;
              break;
            }
          }
          if (sectionIdx >= 0) break;
        }
      }
      if (sectionIdx < 0) return null;
      let bandIdx = sectionIdx;
      for (let i = sectionIdx; i < Math.min(rowText.length, sectionIdx + 10); i += 1) {
        if (/频带宽度/.test(rowText[i])) {
          bandIdx = i;
          break;
        }
      }
      const row = rows[bandIdx];
      if (!row) return null;
      const candidates = Array.from(row.querySelectorAll("p,span,div,td,th"));
      return candidates.find((n) => /频带宽度/.test(norm(n.textContent))) || row;
    };

    const pending = [...orderedBlocks];
    const extractFirstByType = (type) => {
      const idx = pending.findIndex((x) => String((x && x.type) || "") === type && String((x && x.html) || ""));
      if (idx < 0) return null;
      return pending.splice(idx, 1)[0] || null;
    };
    const table9 = extractFirstByType("table");
    if (table9 && table9.html) {
      const anchor9 = findSectionBandAnchor(/九[、,，]?/, /双脉冲曲线绘制/);
      if (anchor9) insertInCell(anchor9, table9.html);
      else pending.unshift(table9);
    }
    const chart10 = extractFirstByType("chart");
    if (chart10 && chart10.html) {
      const anchor10 = findSectionBandAnchor(/十[、,，]?/, /双脉冲曲线图/);
      if (anchor10) insertInCell(anchor10, chart10.html);
      else pending.unshift(chart10);
    }

    let fallbackIdx = 0;
    let cursor = 0;
    pending.forEach((block) => {
      const html = String((block && block.html) || "");
      if (!html) return;
      let found = pickAnchorNode([block.anchorText, block.anchorBefore, block.anchorAfter], cursor);
      if (!found && fallbackIdx < fallbackNodes.length) {
        const node = fallbackNodes[fallbackIdx];
        const idx = nodes.indexOf(node);
        fallbackIdx += 1;
        if (node) found = { node, idx: idx >= 0 ? idx : cursor };
      }
      if (!found || !found.node) return;
      if (insertAfter(found.node, html)) cursor = Math.max(0, Number(found.idx || 0));
    });

    // Strict placement: if anchors missing, skip to avoid misplaced insertion.
    return { inserted: used.length, total };
  }

  function buildDocxEmbeddedInspectText(inspect) {
    const data = inspect && typeof inspect === "object" ? inspect : {};
    const embeddedExcelCount = Number(data.embedded_excel_count || 0);
    const chartCount = Number(data.chart_count || 0);
    const chartLinkedExcelCount = Number(data.chart_linked_excel_count || 0);
    if (embeddedExcelCount <= 0 && chartCount <= 0) {
      return "内嵌识别：未检测到内嵌Excel/图表";
    }
    return `内嵌识别：Excel工作簿 ${embeddedExcelCount} 个；图表 ${chartCount} 个；图表绑定Excel ${chartLinkedExcelCount} 处（只读显示）`;
  }

  async function injectEmbeddedReadonlyPreview(elId, arrayBuffer) {
    const rootEl = $(elId);
    if (!rootEl || !arrayBuffer) return { inserted: 0, total: 0 };
    rootEl.querySelectorAll(".docx-embedded-onlyread,.docx-embedded-onlyread-summary").forEach((x) => x.remove());
    rootEl.querySelectorAll(".docx-embedded-unresolved-hint").forEach((x) => x.remove());
    const parsedReadonly = await _readDocxEmbeddedOnlyReadHtml(arrayBuffer);
    const injected = _injectEmbeddedBlocksAtAnchors(rootEl, parsedReadonly);
    const inserted = Number((injected && injected.inserted) || 0);
    const total = Number((injected && injected.total) || 0);
    if (total > 0 && inserted < total) {
      const unresolved = total - inserted;
      const warn = document.createElement("div");
      warn.className = "docx-embedded-unresolved-hint";
      warn.style.margin = "8px";
      warn.style.padding = "6px 10px";
      warn.style.fontSize = "12px";
      warn.style.lineHeight = "1.4";
      warn.style.color = "#7a1f1f";
      warn.style.background = "#fff1f2";
      warn.style.border = "1px solid #fecdd3";
      warn.style.borderRadius = "6px";
      warn.textContent = `内嵌对象位置无法识别：${unresolved}/${total}（已跳过，避免放错位置）`;
      rootEl.prepend(warn);
    }
    if (total === 0 && parsedReadonly && parsedReadonly.summaryHtml) {
      rootEl.insertAdjacentHTML("beforeend", parsedReadonly.summaryHtml);
    }
    return { inserted, total };
  }

  async function injectTargetEmbeddedWithSourceFallback(item, targetArrayBuffer) {
    const injected = await injectEmbeddedReadonlyPreview("targetPreview", targetArrayBuffer);
    const targetRootEl = $("targetPreview");
    const targetHasImage = !!(targetRootEl && targetRootEl.querySelector('img[alt="embedded-image"]'));
    if (targetHasImage || !item || !targetRootEl) return injected;
    try {
      if (item.isRecordRow) await ensureSourceFileId(item);
      const sourceBlob = item.fileId ? await fetchBlob(`/api/upload/${item.fileId}/download`) : item.file;
      if (!sourceBlob || typeof sourceBlob.arrayBuffer !== "function") return injected;
      const sourceArrayBuffer = await sourceBlob.arrayBuffer();
      const sourceParsed = await _readDocxEmbeddedOnlyReadHtml(sourceArrayBuffer);
      const sourceBlocks = Array.isArray(sourceParsed && sourceParsed.blocks) ? sourceParsed.blocks : [];
      const imageBlocksRaw = sourceBlocks
        .filter((x) => String((x && x.type) || "") === "image" && String((x && x.html) || ""))
        .filter((x) => {
          const anchor = `${String((x && x.anchorText) || "")} ${String((x && x.anchorBefore) || "")} ${String((x && x.anchorAfter) || "")}`;
          return /图\s*[1-9]\d*\s*[：:]/.test(anchor) || /fig(?:ure)?\s*[1-9]\d*/i.test(anchor);
        });
      const seen = new Set();
      const imageBlocks = imageBlocksRaw
        .filter((x) => {
          const key = `${String((x && x.path) || "")}|${String((x && x.anchorText) || "")}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((x) => ({
          type: "image",
          html: String((x && x.html) || ""),
          anchorText: String((x && x.anchorText) || ""),
          anchorBefore: String((x && x.anchorBefore) || ""),
          anchorAfter: String((x && x.anchorAfter) || ""),
        }));
      if (!imageBlocks.length) return injected;
      _injectEmbeddedBlocksAtAnchors(targetRootEl, { blocks: imageBlocks });
      return injected;
    } catch (_) {
      return injected;
    }
  }

  async function renderSourcePreview(item) {
    if (!item) {
      setPreviewPlaceholder("sourcePreview", "来源预览未加载");
      return;
    }
    const selectedNormalItems = getSelectedNormalItems();
    if (selectedNormalItems.length > 1) {
      setPreviewPlaceholder("sourcePreview", `来源预览：已选 ${selectedNormalItems.length} 条记录`);
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
      if (ext === ".docx") await ensureSourceFileId(item);
      const sourceBlob = item.fileId ? await fetchBlob(`/api/upload/${item.fileId}/download`) : item.file;
      if (ext === ".docx") {
        const sourceArrayBuffer = await sourceBlob.arrayBuffer();
        await renderDocx("sourcePreview", sourceArrayBuffer);
        let inspect = null;
        try {
          inspect = await runDocxEmbeddedInspect(item.fileId || "");
        } catch (_) {
          inspect = null;
        }
        const infoText = buildDocxEmbeddedInspectText(inspect);
        const sourceEl = $("sourcePreview");
        if (sourceEl) {
          sourceEl.style.position = "relative";
          const oldHint = sourceEl.querySelector(".source-embedded-inspect-hint");
          if (oldHint) oldHint.remove();
          const infoEl = document.createElement("div");
          infoEl.className = "source-embedded-inspect-hint";
          infoEl.style.position = "absolute";
          infoEl.style.top = "8px";
          infoEl.style.left = "8px";
          infoEl.style.zIndex = "999";
          infoEl.style.maxWidth = "calc(100% - 16px)";
          infoEl.style.padding = "6px 10px";
          infoEl.style.fontSize = "12px";
          infoEl.style.lineHeight = "1.4";
          infoEl.style.color = "#1f2d3d";
          infoEl.style.background = "rgba(244, 246, 250, 0.96)";
          infoEl.style.border = "1px solid #d9e2ef";
          infoEl.style.borderRadius = "6px";
          infoEl.style.pointerEvents = "none";
          infoEl.textContent = infoText;
          sourceEl.appendChild(infoEl);
          sourceEl.querySelectorAll(".docx-embedded-onlyread,.docx-embedded-onlyread-summary").forEach((x) => x.remove());
          sourceEl.querySelectorAll(".docx-embedded-unresolved-hint").forEach((x) => x.remove());
          const parsedReadonly = await _readDocxEmbeddedOnlyReadHtml(sourceArrayBuffer);
          const injected = _injectEmbeddedBlocksAtAnchors(sourceEl, parsedReadonly);
          const inserted = Number((injected && injected.inserted) || 0);
          const total = Number((injected && injected.total) || 0);
          if (total > 0 && inserted < total) {
            const unresolved = total - inserted;
            const warn = document.createElement("div");
            warn.className = "docx-embedded-unresolved-hint";
            warn.style.margin = "8px";
            warn.style.padding = "6px 10px";
            warn.style.fontSize = "12px";
            warn.style.lineHeight = "1.4";
            warn.style.color = "#7a1f1f";
            warn.style.background = "#fff1f2";
            warn.style.border = "1px solid #fecdd3";
            warn.style.borderRadius = "6px";
            warn.textContent = `内嵌对象位置无法识别：${unresolved}/${total}（已跳过，避免放错位置）`;
            sourceEl.prepend(warn);
          }
          if (total === 0 && parsedReadonly && parsedReadonly.summaryHtml) {
            sourceEl.insertAdjacentHTML("beforeend", parsedReadonly.summaryHtml);
          }
        }
        const globalStatus = $("globalStatus");
        if (globalStatus) {
          globalStatus.textContent = infoText;
        }
      } else if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".heic", ".heif", ".pic"].includes(ext)) {
        const url = URL.createObjectURL(sourceBlob);
        state.blobUrls.source = url;
        $("sourcePreview").innerHTML = `<img alt="source" src="${url}" />`;
      } else if (ext === ".pdf") {
        const url = URL.createObjectURL(sourceBlob);
        state.blobUrls.source = url;
        $("sourcePreview").innerHTML = `<iframe src="${url}"></iframe>`;
      } else {
        setPreviewPlaceholder("sourcePreview", "该类型不支持来源预览");
      }
    } catch (error) {
      setPreviewPlaceholder("sourcePreview", `来源预览失败：${error.message || "unknown"}`);
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
      setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "导出预览" : "原始记录预览"}：已选 ${selectedNormalItems.length} 条记录`);
      return;
    }
    try {
      if (isModifyCertificate) {
        if (hasCurrentModeReport) {
          revokeBlobUrl("target");
          const blob = await fetchBlob(currentReportUrl);
          const ext = extFromName(currentReportName || item.sourceFileName || item.fileName);
          if (ext === ".docx") {
            const buf = await blob.arrayBuffer();
            await renderDocx("targetPreview", buf);
            await injectEmbeddedReadonlyPreview("targetPreview", buf);
          } else {
            const url = URL.createObjectURL(blob);
            state.blobUrls.target = url;
            $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
          }
          return;
        }
        revokeBlobUrl("target");
        const previewTemplateName = resolveModifyPreviewTemplateName(item);
        if (!previewTemplateName) {
          setPreviewPlaceholder("targetPreview", "导出模版未配置");
          return;
        }
        const tplBlob = await fetchBlob(`/api/templates/download?template_name=${encodeURIComponent(previewTemplateName)}`);
        const tplExt = extFromName(previewTemplateName);
        if (tplExt === ".docx") {
          const docxReady = await ensureDocxLib();
          if (docxReady) {
            const buf = await tplBlob.arrayBuffer();
            await renderDocx("targetPreview", buf);
            await injectEmbeddedReadonlyPreview("targetPreview", buf);
          } else {
            const data = await runTemplateTextPreview(previewTemplateName);
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
            const buf = await tplBlob.arrayBuffer();
            await renderDocx("targetPreview", buf);
            await injectEmbeddedReadonlyPreview("targetPreview", buf);
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
        const buf = await blob.arrayBuffer();
        await renderDocx("targetPreview", buf);
        await injectEmbeddedReadonlyPreview("targetPreview", buf);
        applyTargetPreviewSlotHighlights(item);
      } else {
        const url = URL.createObjectURL(blob);
        state.blobUrls.target = url;
        $("targetPreview").innerHTML = `<iframe src="${url}"></iframe>`;
      }
    } catch (error) {
      setPreviewPlaceholder("targetPreview", `${isModifyCertificate ? "导出预览" : "原始记录预览"}失败：${error.message || "unknown"}`);
    }
  }

  function resolveModifyPreviewTemplateName(item) {
    const templates = Array.isArray(state.templates) ? state.templates.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!templates.length) return "";
    const exists = (name) => !!name && templates.includes(name);
    const outputBundleId = String((state.taskContext && state.taskContext.output_bundle_id) || "").trim();
    if (outputBundleId) {
      const bundleRef = `bundle:${outputBundleId}`;
      if (exists(bundleRef)) return bundleRef;
    }
    const taskDefaultRaw = String((state.taskContext && state.taskContext.export_template_name) || "").trim();
    const taskDefaultBase = taskDefaultRaw.split(/[\\/]/).pop() || taskDefaultRaw;
    const taskDefaultName = taskDefaultBase;
    if (exists(taskDefaultName)) return taskDefaultName;
    const configuredBlueprint = String((state.runtime && state.runtime.modifyCertificateBlueprintTemplateName) || "modify-certificate-blueprint.docx").trim();
    if (exists(configuredBlueprint)) return configuredBlueprint;
    const itemTemplateRaw = String((item && item.templateName) || "").trim();
    const itemTemplateName = itemTemplateRaw;
    if (exists(itemTemplateName)) return itemTemplateName;
    const firstDocx = templates.find((x) => /\.docx$/i.test(x));
    if (firstDocx) return firstDocx;
    return templates[0] || "";
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
      setPreviewPlaceholder("sourcePreview", "来源预览未加载");
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
