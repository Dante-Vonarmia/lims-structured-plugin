import test from "node:test";
import assert from "node:assert/strict";

import {
  TemplateConfigAuditV1,
  TemplateConfigV1,
  buildTemplateConfigV1,
} from "./template-config-v1.js";

function hasAuditMarkers(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((x) => hasAuditMarkers(x));
  if (
    Object.prototype.hasOwnProperty.call(value, "value")
    && Object.prototype.hasOwnProperty.call(value, "status")
    && Object.prototype.hasOwnProperty.call(value, "source")
    && Object.prototype.hasOwnProperty.call(value, "TODO")
  ) {
    return true;
  }
  return Object.values(value).some((x) => hasAuditMarkers(x));
}

test("TemplateConfigAuditV1 keeps audit fields and contract wording", () => {
  assert.equal(TemplateConfigAuditV1.configSpecVersion, "1.0.0");
  assert.ok(TemplateConfigAuditV1.templateVersion);

  const auditContract = TemplateConfigAuditV1.contract;
  assert.equal(auditContract.preserveEmptySlot.source, "contract required");
  assert.equal(auditContract.forbidLeftShiftOnEmpty.source, "target behavior");
  assert.equal(auditContract.sameColumnOnlyMerge.source, "target behavior");

  assert.ok("value" in auditContract.preserveEmptySlot);
  assert.ok("status" in auditContract.preserveEmptySlot);
  assert.ok("source" in auditContract.preserveEmptySlot);
  assert.ok("TODO" in auditContract.preserveEmptySlot);
});

test("TemplateConfigV1 is plain runtime config without audit markers", () => {
  assert.equal(TemplateConfigV1.configSpecVersion, "1.0.0");
  assert.ok(TemplateConfigV1.templateVersion);
  assert.equal(typeof TemplateConfigV1.contract.preserveEmptySlot, "boolean");
  assert.equal(typeof TemplateConfigV1.contract.forbidLeftShiftOnEmpty, "boolean");
  assert.equal(typeof TemplateConfigV1.contract.sameColumnOnlyMerge, "boolean");
  assert.equal(hasAuditMarkers(TemplateConfigV1), false);
});

test("column boundary source mechanism is explicit in runtime config", () => {
  const col = TemplateConfigV1.columns[0];
  assert.ok(col.boundary.boundarySource);
  assert.ok(col.boundary.locatorType);
  assert.equal(typeof col.boundary.runtimeDerived, "boolean");
  assert.ok(col.boundary.fallbackPolicy);
});

test("debug/progress are in execution layer, not template core", () => {
  assert.ok(TemplateConfigV1.execution);
  assert.ok(TemplateConfigV1.execution.debug);
  assert.ok(TemplateConfigV1.execution.progress);
  assert.equal(Object.prototype.hasOwnProperty.call(TemplateConfigV1, "debug"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(TemplateConfigV1, "progress"), false);
});

test("buildTemplateConfigV1 derives plain object from audit config", () => {
  const runtime = buildTemplateConfigV1(TemplateConfigAuditV1);
  assert.equal(runtime.contract.preserveEmptySlot, true);
  assert.equal(runtime.contract.forbidLeftShiftOnEmpty, true);
  assert.equal(runtime.contract.sameColumnOnlyMerge, true);
  assert.equal(runtime.rowGrouping.categories.fallback, "sequentialBanding");
  assert.equal(runtime.provenance.responsibility.includes("where each runtime setting"), true);
  assert.equal(runtime.trace.minimumFields.includes("columnKey"), true);
});
