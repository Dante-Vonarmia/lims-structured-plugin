# 模板资料包（Template Bundle）v1

## 根目录

- 通过环境变量 `TEMPLATE_BUNDLE_ROOT` 配置
- 默认值：`backend/template-bundles`

目录约定：

```text
<TEMPLATE_BUNDLE_ROOT>/
  input/
    <bundle-dir>/
      manifest.json
      ...
  output/
    <bundle-dir>/
      manifest.json
      ...
```

## manifest 结构

```json
{
  "bundleId": "string",
  "displayName": "string",
  "version": "string",
  "kind": "input|output",
  "enabled": true,
  "description": "string",
  "entries": {
    "schema": "schema.csv",
    "rules": "rules.json",
    "companion": ["..."]
  },
  "documentType": "string",
  "businessType": "string",
  "tags": ["..."],
  "compatibility": {}
}
```

- `input` 包要求：`entries.schema`、`entries.rules`
- `output` 包要求：`entries.template`
- 所有 `entries` 路径必须是**资料包目录内相对路径**

## 运行时行为

- 扫描器遍历 `input/*`、`output/*`
- 读取并校验 manifest
- 校验文件存在、kind 匹配、bundleId 冲突、路径越界
- 注册中心返回简化列表给前端
- 任务创建保存 `input_bundle_id` / `output_bundle_id`
- 工作台根据 `input_bundle_id` 解析 schema/rules
- 输出模板支持 `bundle:<bundleId>` 引用
