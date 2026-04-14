function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactText(value) {
  return String(value || "").trim();
}

function parseColumnKeyIndex(columnKey) {
  const text = String(columnKey || "").trim();
  const match = text.match(/^col_(\d{1,2})$/i);
  if (!match) return -1;
  const idx = toNumber(match[1], 0) - 1;
  return idx >= 0 ? idx : -1;
}

function buildEmptyFields(columns) {
  const result = {};
  const cols = Array.isArray(columns) ? columns : [];
  for (let i = 0; i < cols.length; i += 1) {
    const key = String((cols[i] && cols[i].key) || "").trim();
    if (!key) continue;
    result[key] = "";
  }
  return result;
}

function normalizeXLines(xLines, cells, columns) {
  if (Array.isArray(xLines) && xLines.length >= 2) return xLines.map((x) => toNumber(x, 0));
  const bboxes = (Array.isArray(cells) ? cells : [])
    .map((cell) => (Array.isArray(cell && cell.bbox) ? cell.bbox : []))
    .filter((bbox) => bbox.length >= 4);
  if (!bboxes.length) return [];
  const minX = Math.min(...bboxes.map((bbox) => toNumber(bbox[0], 0)));
  const maxX = Math.max(...bboxes.map((bbox) => toNumber(bbox[2], 0)));
  const width = Math.max(1, maxX - minX);
  const colCount = Math.max(1, (Array.isArray(columns) ? columns.length : 0));
  const lines = [];
  for (let i = 0; i <= colCount; i += 1) {
    lines.push(minX + (width * i) / colCount);
  }
  return lines;
}

function resolveSlotIndexByX(cell, xLines, colCount) {
  const bbox = Array.isArray(cell && cell.bbox) ? cell.bbox : [];
  if (bbox.length < 4 || !Array.isArray(xLines) || xLines.length < 2) return -1;
  const cx = (toNumber(bbox[0], 0) + toNumber(bbox[2], 0)) / 2;
  for (let i = 0; i < xLines.length - 1; i += 1) {
    if (cx >= xLines[i] && cx < xLines[i + 1]) return i;
  }
  return Math.max(0, Math.min(colCount - 1, xLines.length - 2));
}

function resolveSlotIndex(cell, columns, xLines) {
  const colCount = Math.max(0, Array.isArray(columns) ? columns.length : 0);
  const col = toNumber(cell && cell.col, 0);
  if (col >= 1 && col <= colCount) return col - 1;

  const keyIdx = parseColumnKeyIndex(cell && cell.column_key);
  if (keyIdx >= 0 && keyIdx < colCount) return keyIdx;

  const label = compactText(cell && cell.column_label);
  if (label) {
    for (let i = 0; i < colCount; i += 1) {
      const colLabel = compactText(columns[i] && columns[i].label);
      if (colLabel && colLabel === label) return i;
    }
  }

  return resolveSlotIndexByX(cell, xLines, colCount);
}

export function mergeColumnTokens(tokenTexts) {
  const parts = (Array.isArray(tokenTexts) ? tokenTexts : [])
    .map((x) => compactText(x))
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const simple = parts.every((p) => /^[A-Za-z0-9./:-]+$/.test(p));
  return simple ? parts.join("") : parts.join(" ");
}

export function parseRowFromCellsBySlots({ cells, columns, xLines }) {
  const cols = Array.isArray(columns) ? columns : [];
  const rowCells = Array.isArray(cells) ? cells : [];
  const lines = normalizeXLines(xLines, rowCells, cols);
  const grouped = Array.from({ length: cols.length }, () => []);
  for (let i = 0; i < rowCells.length; i += 1) {
    const cell = rowCells[i] || {};
    const text = compactText(cell.final_text ?? cell.text ?? cell.raw_text ?? "");
    if (!text) continue;
    const slotIdx = resolveSlotIndex(cell, cols, lines);
    if (slotIdx < 0 || slotIdx >= grouped.length) continue;
    const bbox = Array.isArray(cell.bbox) ? cell.bbox : [0, 0, 0, 0];
    grouped[slotIdx].push({
      text,
      x: (toNumber(bbox[0], 0) + toNumber(bbox[2], 0)) / 2,
      y: (toNumber(bbox[1], 0) + toNumber(bbox[3], 0)) / 2,
    });
  }

  const fields = buildEmptyFields(cols);
  for (let i = 0; i < cols.length; i += 1) {
    const key = compactText(cols[i] && cols[i].key);
    if (!key) continue;
    const tokens = grouped[i].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    fields[key] = mergeColumnTokens(tokens.map((x) => x.text));
  }
  return fields;
}

export function buildRowRecordsFromTableCells({ tableCells, columns, xLines }) {
  const cells = Array.isArray(tableCells) ? tableCells : [];
  const rowsMap = new Map();
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i] || {};
    const rowId = toNumber(cell.row, 0);
    if (rowId <= 0) continue;
    if (!rowsMap.has(rowId)) rowsMap.set(rowId, []);
    rowsMap.get(rowId).push(cell);
  }
  const rowIds = Array.from(rowsMap.keys()).sort((a, b) => a - b);
  const rowRecords = [];
  for (let i = 0; i < rowIds.length; i += 1) {
    const rowId = rowIds[i];
    const rowCells = rowsMap.get(rowId) || [];
    const fields = parseRowFromCellsBySlots({ cells: rowCells, columns, xLines });
    const expandedFields = { ...fields };
    const cols = Array.isArray(columns) ? columns : [];
    for (let c = 0; c < cols.length; c += 1) {
      const key = compactText(cols[c] && cols[c].key);
      if (!key) continue;
      const label = compactText(cols[c] && cols[c].label);
      const value = compactText(fields[key]);
      expandedFields[`col_${String(c + 1).padStart(2, "0")}`] = value;
      if (label) expandedFields[label] = value;
    }
    const values = [];
    for (let c = 0; c < cols.length; c += 1) {
      const key = compactText(cols[c] && cols[c].key);
      if (!key) continue;
      const v = compactText(fields[key]);
      if (v) values.push(v);
    }
    rowRecords.push({
      row: rowId,
      fields: expandedFields,
      raw_record: values.join(" ").trim(),
    });
  }
  return rowRecords;
}
