# Constants Breakdown

按业务板块拆分，避免单文件堆积：

- `runtime/assets.js`
  - 前端运行时依赖资源 URL（jszip/docx-preview）
- `upload/filters.js`
  - 上传/筛选相关常量（扩展名、筛选 token）
- `record/source-fields.js`
  - 来源识别字段配置（`SOURCE_*`）
- `record/target-fields.js`
  - 右侧编辑区字段与分组（`TARGET_*`）
- `template/rules.js`
  - 模板生成与必填规则（`TEMPLATE_*`）
- `../constants.js`
  - 汇总导出入口（业务侧统一从该入口 import）

约束：新增常量先判断所属业务板块，再放入对应目录；不要再回到平铺单文件。
