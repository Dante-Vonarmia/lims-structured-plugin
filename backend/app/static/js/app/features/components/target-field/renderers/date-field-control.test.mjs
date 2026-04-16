import test from "node:test";
import assert from "node:assert/strict";

import { createDateFieldControlRenderer } from "./date-field-control.js";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const escapeAttr = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

test("date field control should render month-day compact UI for inspection dates", () => {
  const { renderDateFieldControl } = createDateFieldControlRenderer({
    escapeHtml,
    escapeAttr,
    parseDateParts: () => null,
    mixedPlaceholder: "",
  });

  const html = renderDateFieldControl({
    fieldKey: "last_inspection_date",
    fieldLabel: "上次检验日期",
    value: "1.15",
    suggestion: "",
  });

  assert.match(html, /data-date-mode="month_day"/);
  assert.doesNotMatch(html, /data-date-part="year"/);
  assert.match(html, /data-date-part="month"/);
  assert.match(html, /data-date-part="day"/);
});

test("date field control should render year-month compact UI for manufacture date", () => {
  const { renderDateFieldControl } = createDateFieldControlRenderer({
    escapeHtml,
    escapeAttr,
    parseDateParts: () => null,
    mixedPlaceholder: "",
  });

  const html = renderDateFieldControl({
    fieldKey: "manufacture_date",
    fieldLabel: "制造年月",
    value: "20.06",
    suggestion: "",
  });

  assert.match(html, /data-date-mode="year_month"/);
  assert.match(html, /data-date-part="year"/);
  assert.match(html, /data-date-part="month"/);
  assert.doesNotMatch(html, /data-date-part="day"/);
});
