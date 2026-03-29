export function createCatalogRenderingFeature(deps = {}) {
  const {
    $,
    state,
    escapeHtml,
    escapeAttr,
  } = deps;

  function renderCatalogReadyHint() {
    const hint = $("catalogReadyHint");
    if (!hint) return;
    const total = Array.isArray(state.instrumentCatalogRows) ? state.instrumentCatalogRows.length : 0;
    const ready = total > 0;
    if (!ready) {
      hint.innerHTML = "○ 待装填";
      return;
    }
    const html = `<span class="catalog-ready-dot"></span>已就绪 ${total}`;
    hint.innerHTML = html;
  }

  function renderInstrumentCatalogDetailContent() {
    const root = $("catalogDetailContent");
    if (!root) return;
    const rows = Array.isArray(state.instrumentCatalogRows) ? state.instrumentCatalogRows : [];
    const titleEl = $("catalogDetailTitle");
    if (!rows.length) {
      if (titleEl) titleEl.textContent = "计量标准器具目录识别明细";
      root.innerHTML = '<div class="placeholder">暂无识别数据</div>';
      return;
    }
    if (titleEl) {
      const suffix = state.instrumentCatalogFileName ? `（${state.instrumentCatalogFileName}）` : "";
      titleEl.textContent = `计量标准器具目录识别明细：${rows.length} 项${suffix}`;
    }
    const body = rows.map((row, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td title="${escapeAttr(String((row && row.name) || ""))}">${escapeHtml(String((row && row.name) || ""))}</td>
          <td title="${escapeAttr(String((row && row.model) || ""))}">${escapeHtml(String((row && row.model) || ""))}</td>
          <td title="${escapeAttr(String((row && row.code) || ""))}">${escapeHtml(String((row && row.code) || ""))}</td>
          <td title="${escapeAttr(String((row && row.measurement_range) || ""))}">${escapeHtml(String((row && row.measurement_range) || ""))}</td>
          <td title="${escapeAttr(String((row && row.uncertainty) || ""))}">${escapeHtml(String((row && row.uncertainty) || ""))}</td>
          <td title="${escapeAttr(String((row && row.certificate_no) || ""))}">${escapeHtml(String((row && row.certificate_no) || ""))}</td>
          <td title="${escapeAttr(String((row && row.valid_date) || ""))}">${escapeHtml(String((row && row.valid_date) || ""))}</td>
          <td title="${escapeAttr(String((row && row.traceability_institution) || ""))}">${escapeHtml(String((row && row.traceability_institution) || ""))}</td>
        </tr>
      `).join("");
    root.innerHTML = `
        <table class="catalog-detail-table">
          <thead>
            <tr>
              <th>#</th>
              <th>计量标准器具名称</th>
              <th>型号规格</th>
              <th>器具编号</th>
              <th>测量范围</th>
              <th>不确定度</th>
              <th>证书编号</th>
              <th>有效期</th>
              <th>溯源机构</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      `;
  }

  function setCatalogDetailVisible(show) {
    const mask = $("catalogDetailMask");
    if (!mask) return;
    if (show) renderInstrumentCatalogDetailContent();
    mask.classList.toggle("show", !!show);
  }

  return {
    renderCatalogReadyHint,
    renderInstrumentCatalogDetailContent,
    setCatalogDetailVisible,
  };
}
