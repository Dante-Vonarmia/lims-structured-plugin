import { resolveSchemaGroups } from "./data/resolve-schema-groups.js";
import { resolveInfoFields } from "./data/resolve-info-fields.js";
import { createDateValueWidgetRenderer } from "./renderers/date-value-widget.js";
import { createSourceFieldRowRenderer } from "./renderers/source-field-row.js";

export function createSourceFieldComponents(deps = {}) {
  const { escapeHtml, escapeAttr, parseDateParts } = deps;

  const { renderDateValueWidget } = createDateValueWidgetRenderer({
    escapeHtml,
    parseDateParts,
  });
  const { renderSourceFieldRow } = createSourceFieldRowRenderer({
    escapeHtml,
    escapeAttr,
    renderDateValueWidget,
  });

  return {
    resolveSchemaGroups,
    resolveInfoFields,
    renderSourceFieldRow,
  };
}

