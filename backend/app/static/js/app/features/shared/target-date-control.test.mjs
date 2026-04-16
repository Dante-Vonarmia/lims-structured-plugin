import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTargetDateText,
  parseTargetDateParts,
  resolveTargetDateMode,
} from "./target-date-control.js";

test("resolveTargetDateMode should map existing compact date fields", () => {
  assert.equal(resolveTargetDateMode("manufacture_date", "制造年月"), "year_month");
  assert.equal(resolveTargetDateMode("last_inspection_date", "上次检验日期"), "month_day");
  assert.equal(resolveTargetDateMode("next_inspection_date", "下次检验日期"), "month_day");
  assert.equal(resolveTargetDateMode("release_date", "发布日期"), "full_date");
});

test("parseTargetDateParts should support year-month and month-day values", () => {
  assert.deepEqual(parseTargetDateParts("20.06", "year_month"), { year: "20", month: "06", day: "" });
  assert.deepEqual(parseTargetDateParts("1.15", "month_day"), { year: "", month: "01", day: "15" });
});

test("formatTargetDateText should format by mode", () => {
  assert.equal(formatTargetDateText({ year: "20", month: "06", day: "" }, "year_month"), "20年06月");
  assert.equal(formatTargetDateText({ year: "", month: "01", day: "15" }, "month_day"), "01月15日");
  assert.equal(formatTargetDateText({ year: "2026", month: "04", day: "16" }, "full_date"), "2026年04月16日");
});
