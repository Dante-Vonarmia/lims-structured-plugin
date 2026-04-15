export function createBooleanFieldControlRenderer(deps = {}) {
  const { escapeAttr, escapeHtml } = deps;

  function renderBooleanFieldControl(params = {}) {
    const {
      fieldKey,
      fieldLabel,
      checked = false,
      isProblem = false,
    } = params;

    return `
      <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
        <span>${escapeHtml(fieldLabel)}</span>
        <label>
          <input type="checkbox" data-field="${escapeAttr(fieldKey)}" ${checked ? "checked" : ""} style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;" />
          <span class="source-field-value">${checked ? "✓" : "（空）"}</span>
        </label>
      </label>
    `;
  }

  return {
    renderBooleanFieldControl,
  };
}
