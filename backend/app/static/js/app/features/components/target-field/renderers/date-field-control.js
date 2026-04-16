import { parseTargetDateParts, renderTargetDateControl, resolveTargetDateMode } from "../../../shared/target-date-control.js";

export function createDateFieldControlRenderer(deps = {}) {
  const {
    escapeAttr,
    escapeHtml,
    parseDateParts,
    mixedPlaceholder = "",
  } = deps;

  function renderDateFieldControl(params = {}) {
    const {
      fieldKey,
      fieldLabel,
      value = "",
      isProblem = false,
      isMixed = false,
      suggestion = "",
    } = params;

    const dateMode = resolveTargetDateMode(fieldKey, fieldLabel);
    const suggestionParts = parseTargetDateParts(suggestion, dateMode, parseDateParts);

    return `
      <label class="source-form-item slot-field ${isProblem ? "is-problem" : ""}">
        <span>${escapeHtml(fieldLabel)}</span>
        ${renderTargetDateControl({
          fieldKey,
          fieldLabel,
          value,
          isProblem,
          isMixed,
          suggestionParts,
          parseDateParts,
          escapeAttr,
          escapeHtml,
          mixedPlaceholder,
        })}
        ${suggestion ? `<div class="field-memory-hint">Tab 使用上次：${escapeHtml(suggestion)}</div>` : ""}
      </label>
    `;
  }

  return {
    renderDateFieldControl,
  };
}
