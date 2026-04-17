export const GENERATE_MODE_META = Object.freeze({
  source_file: Object.freeze({
    label: "气瓶定期检验报告",
    generatedStatusLabel: "已生成·气瓶定期检验报告",
  }),
  certificate_template: Object.freeze({
    label: "原始记录",
    generatedStatusLabel: "已生成·原始记录",
  }),
});

export function resolveGeneratedModeKey(item) {
  const modeKey = String((item && item.reportGenerateMode) || "").trim();
  if (modeKey && GENERATE_MODE_META[modeKey]) return modeKey;
  const modeReports = item && item.modeReports && typeof item.modeReports === "object" ? item.modeReports : {};
  const keys = Object.keys(modeReports).filter((key) => {
    if (!GENERATE_MODE_META[key]) return false;
    const report = modeReports[key];
    if (!report || typeof report !== "object") return false;
    return !!String(report.reportDownloadUrl || "").trim();
  });
  if (keys.length === 1) return keys[0];
  return "";
}
