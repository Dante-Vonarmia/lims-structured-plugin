export const TEMPLATE_GENERATION_RULES = [
  {
    id: "r825b",
    pattern: /r[-_ ]?825b/i,
    require_measurement_scope: true,
    min_measurement_items: 6,
  },
  {
    id: "r803b",
    pattern: /r[-_ ]?803b/i,
    require_measurement_scope: true,
    min_measurement_items: 5,
  },
  {
    id: "default",
    pattern: /.*/i,
    require_measurement_scope: false,
    min_measurement_items: 0,
  },
];

export const TEMPLATE_REQUIRED_FIELDS = {
  r808b: ["temperature", "humidity"],
};
