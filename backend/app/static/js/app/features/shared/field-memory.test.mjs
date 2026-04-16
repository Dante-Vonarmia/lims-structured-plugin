import test from "node:test";
import assert from "node:assert/strict";

import { createFieldMemoryFeature } from "./field-memory.js";

function makeInput(attrs = {}, value = "") {
  return {
    value,
    type: "text",
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

function makeHint(text = "") {
  return { textContent: text };
}

function attachFieldItem(target, hints = []) {
  const fieldItem = new global.HTMLElement();
  fieldItem.querySelectorAll = () => hints;
  target.closest = (selector) => (selector === ".source-form-item" ? fieldItem : null);
  return target;
}

global.HTMLElement = class HTMLElement {};
global.HTMLInputElement = class HTMLInputElement extends global.HTMLElement {};
global.HTMLTextAreaElement = class HTMLTextAreaElement extends global.HTMLElement {};
global.HTMLSelectElement = class HTMLSelectElement extends global.HTMLElement {};

test("canAcceptSuggestionFromTarget should be false when no current value", () => {
  const state = {};
  const feature = createFieldMemoryFeature({ state });
  feature.rememberFieldValue("record_no", "TEST-001");

  const target = new global.HTMLInputElement();
  Object.assign(target, makeInput({ "data-field": "record_no" }, ""));
  attachFieldItem(target, [makeHint("Tab 使用上次：TEST-001")]);

  assert.equal(feature.canAcceptSuggestionFromTarget(target, null), false);
});

test("canAcceptSuggestionFromTarget should be false when no hint is rendered", () => {
  const state = {};
  const feature = createFieldMemoryFeature({ state });
  feature.rememberFieldValue("record_no", "TEST-002");
  feature.rememberFieldValue("record_no", "TEST-001");

  const target = new global.HTMLInputElement();
  Object.assign(target, makeInput({ "data-field": "record_no" }, "TEST"));
  attachFieldItem(target, []);

  assert.equal(feature.canAcceptSuggestionFromTarget(target, null), false);
});

test("canAcceptSuggestionFromTarget should be true only when a different suggestion exists and hint is rendered", () => {
  const state = {};
  const feature = createFieldMemoryFeature({ state });
  feature.rememberFieldValue("record_no", "TEST-002");
  feature.rememberFieldValue("record_no", "TEST-001");

  const target = new global.HTMLInputElement();
  Object.assign(target, makeInput({ "data-field": "record_no" }, "TEST"));
  attachFieldItem(target, [makeHint("Tab 使用上次：TEST-002")]);

  assert.equal(feature.canAcceptSuggestionFromTarget(target, null), true);
});

test("canAcceptSuggestionFromTarget should be false when current value already matches stored value", () => {
  const state = {};
  const feature = createFieldMemoryFeature({ state });
  feature.rememberFieldValue("record_no", "TEST-001");

  const target = new global.HTMLInputElement();
  Object.assign(target, makeInput({ "data-field": "record_no" }, "TEST-001"));
  attachFieldItem(target, [makeHint("Tab 使用上次：TEST-001")]);

  assert.equal(feature.canAcceptSuggestionFromTarget(target, null), false);
});
