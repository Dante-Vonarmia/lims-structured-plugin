import test from "node:test";
import assert from "node:assert/strict";

import { shiftDateText } from "../shared/text-date-utils.js";
import { applyDateLinkageRules, createDateLinkageRules } from "./date-linkage.js";

test("createDateLinkageRules returns composable rules", () => {
  const rules = createDateLinkageRules({ shiftDateText });
  assert.equal(Array.isArray(rules), true);
  assert.equal(rules.length >= 2, true);
  rules.forEach((rule) => {
    assert.equal(typeof rule.id, "string");
    assert.equal(typeof rule.when, "function");
    assert.equal(typeof rule.apply, "function");
  });
});

test("sync receive/calibration same date part", () => {
  const next = applyDateLinkageRules({
    changedField: "receive_date",
    changedPart: "month",
    shiftDateText,
    fields: {
      receive_date: { year: "2026", month: "03", day: "20" },
      calibration_date: { year: "2026", month: "01", day: "10" },
      release_date: { year: "2026", month: "03", day: "21" },
    },
  });
  assert.equal(next.calibration_date.month, "03");
  assert.equal(next.calibration_date.value, "2026年03月10日");
});

test("release date is one day after calibration date", () => {
  const next = applyDateLinkageRules({
    changedField: "calibration_date",
    changedPart: "day",
    shiftDateText,
    fields: {
      receive_date: { year: "2026", month: "03", day: "31" },
      calibration_date: { year: "2026", month: "03", day: "31" },
      release_date: { year: "2026", month: "03", day: "20" },
    },
  });
  assert.equal(next.release_date.value, "2026年04月01日");
  assert.equal(next.release_date.exact, true);
});

test("incomplete base date does not force release date", () => {
  const next = applyDateLinkageRules({
    changedField: "receive_date",
    changedPart: "year",
    shiftDateText,
    fields: {
      receive_date: { year: "2026", month: "", day: "" },
      calibration_date: { year: "2025", month: "12", day: "30" },
      release_date: { year: "2025", month: "12", day: "31" },
    },
  });
  assert.equal(next.release_date.value, "2025年12月31日");
});
