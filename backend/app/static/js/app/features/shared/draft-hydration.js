export function buildRecognizedFieldsRuntimeShape({
  fields = {},
  recognizedFields = {},
  createEmptyFields = () => ({}),
} = {}) {
  return {
    ...createEmptyFields(),
    ...(fields && typeof fields === "object" ? fields : {}),
    ...(recognizedFields && typeof recognizedFields === "object" ? recognizedFields : {}),
  };
}

export function buildDisplayRawMapped(item = {}) {
  const fields = (item && item.fields && typeof item.fields === "object") ? item.fields : {};
  const recognizedFields = (item && item.recognizedFields && typeof item.recognizedFields === "object")
    ? item.recognizedFields
    : {};
  return {
    ...fields,
    ...recognizedFields,
  };
}
