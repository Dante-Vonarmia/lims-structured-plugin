import { resolveSchemaGroups } from "./data/resolve-schema-groups.js";
import { resolveInfoFields } from "./data/resolve-info-fields.js";
import { resolveDisplayFieldState } from "./data/resolve-display-pipeline.js";
import { createDateValueWidgetRenderer } from "./renderers/date-value-widget.js";
import { createSourceFieldRowRenderer } from "./renderers/source-field-row.js";

export function createSourceFieldComponents(deps = {}) {
  const {
    escapeHtml,
    escapeAttr,
    parseDateParts,
    getSignatureImageUrl,
  } = deps;

  const { renderDateValueWidget } = createDateValueWidgetRenderer({
    escapeHtml,
    parseDateParts,
  });
  const { renderSourceFieldRow } = createSourceFieldRowRenderer({
    escapeHtml,
    escapeAttr,
    renderDateValueWidget,
    getSignatureImageUrl,
  });

  return {
    resolveDisplayFieldState,
    resolveSchemaGroups,
    resolveInfoFields,
    renderSourceFieldRow,
  };
}
