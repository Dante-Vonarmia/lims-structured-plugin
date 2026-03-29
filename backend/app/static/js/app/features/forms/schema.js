export function createFormSchemaFeature(deps = {}) {
  const {
    state,
    TARGET_BASIC_FORM_FIELDS,
    ensureTemplateEditorSchema,
    hasMeaningfulValue,
    resolveTemplateRequiredFields,
  } = deps;

  function resolveTargetFormFields(item, fields) {
    if (item && item.templateName) {
      ensureTemplateEditorSchema(item.templateName, item.id || "");
      const schemaState = state.editorSchemaByTemplate[String(item.templateName || "").trim()];
      if (schemaState && !schemaState.loading && schemaState.editor_schema && Array.isArray(schemaState.editor_schema.fields)) {
        const schemaFields = schemaState.editor_schema.fields.map((x) => ({
          key: x.key,
          label: x.label,
          wide: !!x.wide,
        }));
        if (schemaFields.length) {
          return {
            fields: schemaFields,
            note: String(schemaState.editor_schema.note || "").trim(),
            loading: false,
          };
        }
      }
      if (schemaState && schemaState.loading) {
        return {
          fields: TARGET_BASIC_FORM_FIELDS,
          note: "",
          loading: true,
        };
      }
    }
    return {
      fields: TARGET_BASIC_FORM_FIELDS,
      note: "",
      loading: false,
    };
  }

  function getProblemFieldKeys(item, formFields = []) {
    const problemKeys = new Set();
    if (!item || !item.fields) return problemKeys;
    const fields = item.fields || {};

    if (!hasMeaningfulValue(fields.device_name)) problemKeys.add("device_name");

    const hasModel = hasMeaningfulValue(fields.device_model);
    const hasCode = hasMeaningfulValue(fields.device_code);
    if (!hasModel && !hasCode) {
      problemKeys.add("device_model");
      problemKeys.add("device_code");
    }

    if (!hasMeaningfulValue(fields.manufacturer)) problemKeys.add("manufacturer");

    const templateRequired = resolveTemplateRequiredFields(item);
    templateRequired.forEach((key) => {
      if (!hasMeaningfulValue(fields[key])) problemKeys.add(key);
    });

    return problemKeys;
  }

  return {
    resolveTargetFormFields,
    getProblemFieldKeys,
  };
}
