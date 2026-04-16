export function createFormSchemaFeature(deps = {}) {
  const {
    state,
    ensureTemplateEditorSchema,
    hasMeaningfulValue,
    resolveTemplateRequiredFields,
  } = deps;

  function resolveEffectiveTemplateName(item) {
    const outputBundleId = String((state && state.taskContext && state.taskContext.output_bundle_id) || "").trim();
    if (outputBundleId) {
      return `bundle:${outputBundleId}`;
    }
    const normalizeName = (raw) => {
      const text = String(raw || "").trim();
      if (!text) return "";
      if (text.startsWith("bundle:")) {
        return text;
      }
      const base = text.split(/[\\/]/).pop() || text;
      return base;
    };
    const itemTemplate = normalizeName(item && item.templateName);
    if (itemTemplate) return itemTemplate;
    return normalizeName(state && state.taskContext && state.taskContext.export_template_name);
  }

  function resolveTargetFormFields(item, fields) {
    const effectiveTemplateName = resolveEffectiveTemplateName(item);
    if (effectiveTemplateName) {
      ensureTemplateEditorSchema(effectiveTemplateName, (item && item.id) || "");
      const schemaState = state.editorSchemaByTemplate[String(effectiveTemplateName || "").trim()];
      if (schemaState && !schemaState.loading && schemaState.editor_schema && Array.isArray(schemaState.editor_schema.fields)) {
        const schemaFields = schemaState.editor_schema.fields.map((x) => ({ ...x, wide: !!x.wide }));
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
          fields: [],
          note: "",
          loading: true,
        };
      }
      if (schemaState && !schemaState.loading) {
        return {
          fields: [],
          note: "模板字段未识别",
          loading: false,
        };
      }
    }
    return {
      fields: [],
      note: "",
      loading: false,
    };
  }

  function getProblemFieldKeys(item, formFields = []) {
    const problemKeys = new Set();
    if (!item || !item.fields) return problemKeys;
    const fields = item.fields || {};

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
