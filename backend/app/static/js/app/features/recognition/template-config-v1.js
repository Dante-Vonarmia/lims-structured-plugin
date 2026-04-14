function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeAuditEntry(value, status, source, todo) {
  return {
    value,
    status,
    source,
    TODO: todo,
  };
}

export const TemplateConfigAuditV1 = {
  configSpecVersion: "1.0.0",
  templateVersion: "steel-cylinder-periodic-inspection@v1",
  templateKey: "steel-cylinder-periodic-inspection",
  templateLabel: "钢质无缝气瓶定期检验与评定记录",
  contract: {
    preserveEmptySlot: makeAuditEntry(
      true,
      "required",
      "contract required",
      "Enforce fixed slot output in parser/mapper for every row."
    ),
    forbidLeftShiftOnEmpty: makeAuditEntry(
      true,
      "required",
      "target behavior",
      "Reject any non-empty-compaction mapping path in row assembly."
    ),
    sameColumnOnlyMerge: makeAuditEntry(
      true,
      "required",
      "target behavior",
      "Merge tokens only under same columnKey + rowIndex."
    ),
  },
  columns: [
    {
      key: "inspectionDate",
      label: "检验日期",
      index: 0,
      boundary: {
        xMin: 0,
        xMax: 100,
        boundarySource: "templateDefined",
        locatorType: "xRange",
        runtimeDerived: false,
        fallbackPolicy: "keepSlotEmpty",
      },
    },
    {
      key: "propertyCode",
      label: "产权代码编号",
      index: 1,
      boundary: {
        xMin: 100,
        xMax: 200,
        boundarySource: "templateDefined",
        locatorType: "xRange",
        runtimeDerived: false,
        fallbackPolicy: "keepSlotEmpty",
      },
    },
    {
      key: "fillMedium",
      label: "充装介质",
      index: 2,
      boundary: {
        xMin: 200,
        xMax: 300,
        boundarySource: "templateDefined",
        locatorType: "xRange",
        runtimeDerived: false,
        fallbackPolicy: "keepSlotEmpty",
      },
    },
    {
      key: "manufacturerCode",
      label: "制造单位代码",
      index: 3,
      boundary: {
        xMin: 300,
        xMax: 400,
        boundarySource: "templateDefined",
        locatorType: "xRange",
        runtimeDerived: false,
        fallbackPolicy: "keepSlotEmpty",
      },
    },
    {
      key: "factoryNo",
      label: "出厂编号",
      index: 4,
      boundary: {
        xMin: 400,
        xMax: 520,
        boundarySource: "templateDefined",
        locatorType: "xRange",
        runtimeDerived: false,
        fallbackPolicy: "keepSlotEmpty",
      },
    },
    {
      key: "hydroTestPressure",
      label: "水压试验压力MPa",
      index: 5,
      boundary: {
        xMin: 520,
        xMax: 620,
        boundarySource: "runtimeDerived",
        locatorType: "xAnchorInterpolation",
        runtimeDerived: true,
        fallbackPolicy: "useNearestTemplateBoundary",
      },
    },
  ],
  rowGrouping: {
    strategy: "rowBands",
    parameters: {
      source: "tableLinesOrYCluster",
      yTolerancePx: 8,
      minRowHeightPx: 12,
      maxRowMergeGapPx: 6,
    },
    categories: {
      primary: "lineDetected",
      secondary: "yClusterDerived",
      fallback: "sequentialBanding",
    },
  },
  provenance: {
    responsibility: "Explain where each runtime setting comes from.",
    scope: ["template", "ocr-structured", "runtime-estimation"],
  },
  trace: {
    responsibility: "Keep token -> column -> row -> cell -> field traceable for debugging.",
    minimumFields: ["tokenId", "columnKey", "rowIndex", "cellId", "fieldKey"],
  },
  execution: {
    debug: {
      enabled: makeAuditEntry(true, "optional", "audit observation", "Used only by debug view and diagnostics."),
      mode: makeAuditEntry("column-first", "optional", "audit observation", "Must not change runtime mapping behavior."),
    },
    progress: {
      enabled: makeAuditEntry(true, "optional", "audit observation", "Render parsing progress for long tables only."),
      reportEveryCells: makeAuditEntry(12, "optional", "audit observation", "Lower value increases UI updates."),
    },
  },
};

export function buildTemplateConfigV1(auditConfig = TemplateConfigAuditV1) {
  const runtime = {
    configSpecVersion: String(auditConfig.configSpecVersion || "1.0.0"),
    templateVersion: String(auditConfig.templateVersion || ""),
    templateKey: String(auditConfig.templateKey || ""),
    templateLabel: String(auditConfig.templateLabel || ""),
    contract: {
      preserveEmptySlot: !!(auditConfig.contract && auditConfig.contract.preserveEmptySlot && auditConfig.contract.preserveEmptySlot.value),
      forbidLeftShiftOnEmpty: !!(auditConfig.contract && auditConfig.contract.forbidLeftShiftOnEmpty && auditConfig.contract.forbidLeftShiftOnEmpty.value),
      sameColumnOnlyMerge: !!(auditConfig.contract && auditConfig.contract.sameColumnOnlyMerge && auditConfig.contract.sameColumnOnlyMerge.value),
    },
    columns: (Array.isArray(auditConfig.columns) ? auditConfig.columns : []).map((col) => ({
      key: String((col && col.key) || ""),
      label: String((col && col.label) || ""),
      index: Number((col && col.index) || 0),
      boundary: {
        xMin: Number((col && col.boundary && col.boundary.xMin) || 0),
        xMax: Number((col && col.boundary && col.boundary.xMax) || 0),
        boundarySource: String((col && col.boundary && col.boundary.boundarySource) || "templateDefined"),
        locatorType: String((col && col.boundary && col.boundary.locatorType) || "xRange"),
        runtimeDerived: !!(col && col.boundary && col.boundary.runtimeDerived),
        fallbackPolicy: String((col && col.boundary && col.boundary.fallbackPolicy) || "keepSlotEmpty"),
      },
    })),
    rowGrouping: clone((auditConfig && auditConfig.rowGrouping) || {}),
    provenance: clone((auditConfig && auditConfig.provenance) || {}),
    trace: clone((auditConfig && auditConfig.trace) || {}),
    execution: {
      debug: {
        enabled: !!(auditConfig.execution && auditConfig.execution.debug && auditConfig.execution.debug.enabled && auditConfig.execution.debug.enabled.value),
        mode: String((auditConfig.execution && auditConfig.execution.debug && auditConfig.execution.debug.mode && auditConfig.execution.debug.mode.value) || "off"),
      },
      progress: {
        enabled: !!(auditConfig.execution && auditConfig.execution.progress && auditConfig.execution.progress.enabled && auditConfig.execution.progress.enabled.value),
        reportEveryCells: Number((auditConfig.execution && auditConfig.execution.progress && auditConfig.execution.progress.reportEveryCells && auditConfig.execution.progress.reportEveryCells.value) || 12),
      },
    },
  };

  return runtime;
}

export const TemplateConfigV1 = buildTemplateConfigV1(TemplateConfigAuditV1);
