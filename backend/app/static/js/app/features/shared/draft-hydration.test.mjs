import test from "node:test";
import assert from "node:assert/strict";

import { buildDisplayRawMapped, buildRecognizedFieldsRuntimeShape } from "./draft-hydration.js";

test("buildRecognizedFieldsRuntimeShape should hydrate sparse recognizedFields from fields", () => {
  const recognizedFields = buildRecognizedFieldsRuntimeShape({
    fields: {
      hydro_holding_test_pressure_mpa: "22.5",
      hydro_holding_time_min: "2",
      inspector: "梁光志",
    },
    recognizedFields: {
      ownership_code: "金鸽",
    },
    createEmptyFields: () => ({
      hydro_holding_test_pressure_mpa: "",
      hydro_holding_time_min: "",
      inspector: "",
      ownership_code: "",
    }),
  });

  assert.equal(recognizedFields.hydro_holding_test_pressure_mpa, "22.5");
  assert.equal(recognizedFields.hydro_holding_time_min, "2");
  assert.equal(recognizedFields.inspector, "梁光志");
  assert.equal(recognizedFields.ownership_code, "金鸽");
});

test("buildDisplayRawMapped should merge fields with recognized diffs", () => {
  const rawMapped = buildDisplayRawMapped({
    fields: {
      hydro_holding_test_pressure_mpa: "22.5",
      ownership_code: "金鸽气体（测试）",
    },
    recognizedFields: {
      ownership_code: "金鸽",
    },
  });

  assert.deepEqual(rawMapped, {
    hydro_holding_test_pressure_mpa: "22.5",
    ownership_code: "金鸽",
  });
});
