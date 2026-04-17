export const TARGET_BASIC_FORM_FIELDS = [
  { key: "certificate_no", label: "缆专检号" },
  { key: "client_name", label: "委托单位" },
  { key: "address", label: "地址" },
  { key: "device_name", label: "气瓶名称" },
  { key: "device_model", label: "型号" },
  { key: "device_code", label: "气瓶编号" },
  { key: "manufacturer", label: "生产厂商" },
];

export const TARGET_EDIT_GROUPS = [
  {
    title: "主要信息",
    fields: [
      { key: "certificate_no", label: "缆专检号" },
      { key: "client_name", label: "委托单位" },
      { key: "address", label: "地址" },
      { key: "device_name", label: "气瓶名称" },
      { key: "device_model", label: "型号" },
      { key: "device_code", label: "气瓶编号" },
      { key: "manufacturer", label: "生产厂商" },
    ],
  },
  {
    title: "本次校准所依据的技术规范（代号、名称）",
    fields: [
      { key: "release_date", label: "发布日期" },
      { key: "basis_standard", label: "技术规范代号" },
    ],
  },
  {
    title: "本次校准所使用的主要计量标准气瓶",
    fields: [
      { key: "measurement_items", label: "气瓶表信息", multiline: true, rows: 6 },
    ],
  },
  {
    title: "其它校准信息",
    fields: [
      { key: "location", label: "地点" },
      { key: "temperature", label: "温度" },
      { key: "humidity", label: "湿度" },
      { key: "calibration_other", label: "其它" },
      { key: "receive_date", label: "收样日期" },
      { key: "calibration_date", label: "校准日期" },
    ],
  },
  {
    title: "校准结果/说明（续页）",
    fields: [
      { key: "general_check_full", label: "校准结果/说明（续页）", multiline: true, rows: 10 },
    ],
  },
];
