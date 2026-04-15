import { resolveFieldRule } from "../data/resolve-field-rule.js";

export function createSourceFieldRowRenderer(deps = {}) {
  const {
    escapeHtml,
    escapeAttr,
    renderDateValueWidget,
    getSignatureImageUrl,
  } = deps;

  function renderSourceFieldRow(params = {}) {
    const {
      col,
      itemFields,
      itemTypedFields,
      fieldPipeline,
      schemaRules,
    } = params;
    const key = String((col && col.key) || "").trim();
    const label = String((col && col.label) || "").trim() || key;
    if (!key) return "";
    const staged = fieldPipeline[key] && typeof fieldPipeline[key] === "object" ? fieldPipeline[key] : null;
    const typed = itemTypedFields[key] && typeof itemTypedFields[key] === "object" ? itemTypedFields[key] : null;
    const rawValue = staged ? String(staged.rawValue || "").trim() : String(itemFields[key] || "").trim();
    const normalizedValue = staged ? String(staged.normalizedValue || "").trim() : String(itemFields[key] || "").trim();
    const displayValue = staged
      ? String(staged.displayValue || staged.normalizedValue || staged.rawValue || "").trim()
      : String((typed && (typed.display || typed.isoDate || typed.raw)) || normalizedValue || rawValue || "").trim();
    const errors = staged && Array.isArray(staged.errors) ? staged.errors : [];
    const warnings = staged && Array.isArray(staged.warnings) ? staged.warnings : [];
    const status = staged
      ? String(staged.status || "waiting").trim() || "waiting"
      : (displayValue ? "parsed" : "waiting");
    const rule = resolveFieldRule(schemaRules, col);
    const ruleType = String((rule && rule.type) || "").trim();
    const ruleStdType = String((rule && rule.std_type) || "").trim();
    const keyOrLabel = `${key} ${label}`;
    const looksLikeDateField = /日期|年月/.test(keyOrLabel);
    const pipelineType = staged ? String(staged.type || "").trim() : "";
    const typedType = typed ? String(typed.type || "").trim() : "";
    const isDateType = ruleStdType === "date"
      || ruleType === "date"
      || ruleType === "date_or_dash"
      || pipelineType === "date"
      || pipelineType === "date_or_dash"
      || typedType === "date"
      || typedType === "date_or_dash"
      || looksLikeDateField;
    const isCheckType = ruleStdType === "check"
      || ruleType === "check"
      || pipelineType === "check"
      || typedType === "check";
    const isCheckboxChoiceType = ruleType === "checkbox_choice"
      || pipelineType === "checkbox_choice"
      || typedType === "checkbox_choice";
    const isPlainCheckType = isCheckType && !isCheckboxChoiceType;
    const isSignatureType = ruleStdType === "signature"
      || ruleType === "signature"
      || pipelineType === "signature"
      || typedType === "signature";
    const dateObjectText = (typed && typed.type === "date" && !typed.dash && !typed.inferredYear)
      ? `${String(typed.year).padStart(4, "0")}-${String(typed.month).padStart(2, "0")}-${String(typed.day).padStart(2, "0")}`
      : "";
    const finalDisplayValue = dateObjectText || displayValue;
    const dateWidgetHtml = (isDateType && finalDisplayValue && finalDisplayValue !== "-")
      ? renderDateValueWidget(finalDisplayValue)
      : "";
    const checkValue = (() => {
      if (!isPlainCheckType) return false;
      if (typed && typed.type === "check") return !!typed.value;
      const candidate = String(finalDisplayValue || normalizedValue || rawValue || "").trim().toLowerCase();
      return candidate === "true" || candidate === "1" || candidate === "v" || candidate === "√" || candidate === "✓" || candidate === "☑";
    })();
    const checkWidgetHtml = isPlainCheckType
      ? (checkValue
        ? '<span class="source-field-value">✓</span>'
        : '<span class="source-field-value source-recog-empty">（空）</span>')
      : "";
    const choiceWidgetHtml = isCheckboxChoiceType
      ? (finalDisplayValue
        ? `<span class="source-choice-chip">${escapeHtml(finalDisplayValue)}</span>`
        : '<span class="source-field-value source-recog-empty">（空）</span>')
      : "";
    const signatureImageUrl = (isSignatureType && finalDisplayValue && typeof getSignatureImageUrl === "function")
      ? String(getSignatureImageUrl(finalDisplayValue) || "").trim()
      : "";
    const signatureWidgetHtml = isSignatureType
      ? (finalDisplayValue
        ? `<span class="source-signature-wrap"><span class="source-signature-name">${escapeHtml(finalDisplayValue)}</span>${signatureImageUrl ? `<img class="source-signature-thumb" src="${escapeAttr(signatureImageUrl)}" alt="${escapeAttr(finalDisplayValue)}" loading="lazy" />` : ""}</span>`
        : '<span class="source-field-value source-recog-empty">（空）</span>')
      : "";
    const renderedValueHtml = dateWidgetHtml
      || checkWidgetHtml
      || choiceWidgetHtml
      || signatureWidgetHtml
      || `<span class="source-field-value ${finalDisplayValue ? "" : "source-recog-empty"}">${finalDisplayValue ? escapeHtml(finalDisplayValue) : "（空）"}</span>`;
    const issues = []
      .concat(errors.map((x) => `<li class="source-field-issue error">${escapeHtml(String(x || ""))}</li>`))
      .concat(warnings.map((x) => `<li class="source-field-issue warning">${escapeHtml(String(x || ""))}</li>`))
      .join("");
    const issueHtml = issues ? `<ul class="source-field-issues">${issues}</ul>` : "";
    const showStateBadge = status === "warning" || status === "failed" || status === "processing";
    const stateBadgeHtml = showStateBadge
      ? `<span class="source-field-status source-field-status-${escapeAttr(status)}">${escapeHtml(status)}</span>`
      : "";
    return `
      <tr class="source-field-row source-field-item-${escapeAttr(status)}">
        <td class="source-field-col-key">${escapeHtml(label)}</td>
        <td class="source-field-col-value">
          <span class="source-recog-val source-field-val-wrap">
          ${stateBadgeHtml}
          ${renderedValueHtml}
          ${issueHtml}
          </span>
        </td>
      </tr>
    `;
  }

  return {
    renderSourceFieldRow,
  };
}
