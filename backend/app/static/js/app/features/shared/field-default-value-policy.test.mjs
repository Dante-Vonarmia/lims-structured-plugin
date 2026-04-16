import test from "node:test";
import assert from "node:assert/strict";

import { getTodayDateParts, resolveFieldDefaultValue } from "./field-default-value-policy.js";

test("getTodayDateParts should format local date parts", () => {
  const parts = getTodayDateParts(new Date(2026, 3, 16, 9, 30, 0));
  assert.deepEqual(parts, { year: "2026", month: "04", day: "16" });
});

test("resolveFieldDefaultValue should return today when policy matches empty field", () => {
  const value = resolveFieldDefaultValue({
    field: {
      key: "inspector_sign_date",
      defaultValuePolicy: { type: "today", when: "empty" },
    },
    value: "",
    now: new Date(2026, 3, 16, 9, 30, 0),
  });
  assert.equal(value, "2026年04月16日");
});

test("resolveFieldDefaultValue should not override existing field value", () => {
  const value = resolveFieldDefaultValue({
    field: {
      key: "inspector_sign_date",
      defaultValuePolicy: { type: "today", when: "empty" },
    },
    value: "2026年04月15日",
    now: new Date(2026, 3, 16, 9, 30, 0),
  });
  assert.equal(value, "");
});
