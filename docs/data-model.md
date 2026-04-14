# 数据模型草案

## 1. 设计原则

1. 仅覆盖 当前阶段 主流程所需最小字段。
2. 字段命名优先清晰稳定，不做过度抽象。
3. 与“导入表格 -> 固定模板 -> 任务工作台 -> 生成报告”一致。

## 2. 实体：company

用途：简化企业登录归属。

字段：

1. `id`（string）
2. `company_code`（string, unique）
3. `company_name`（string）
4. `status`（enum: active | disabled）
5. `created_at`（datetime）
6. `updated_at`（datetime）

## 3. 实体：account

用途：登录账号。

字段：

1. `id`（string）
2. `company_id`（string, fk -> company.id）
3. `username`（string）
4. `password_hash`（string）
5. `display_name`（string）
6. `status`（enum: active | disabled）
7. `last_login_at`（datetime, nullable）
8. `created_at`（datetime）
9. `updated_at`（datetime）

## 4. 实体：template

用途：固定模板库（导出模板）。

字段：

1. `id`（string）
2. `template_code`（string, unique）
3. `template_name`（string）
4. `template_type`（enum: report_body | attachment | combined）
5. `version`（string）
6. `is_active`（boolean）
7. `created_at`（datetime）
8. `updated_at`（datetime）

## 5. 实体：uploaded_file

用途：任务导入文件记录。

字段：

1. `id`（string）
2. `company_id`（string, fk -> company.id）
3. `original_name`（string）
4. `storage_path`（string）
5. `mime_type`（string）
6. `file_size`（number）
7. `uploaded_by`（string, fk -> account.id）
8. `uploaded_at`（datetime）

## 6. 实体：task

用途：任务主实体。

字段：

1. `id`（string）
2. `company_id`（string, fk -> company.id）
3. `task_name`（string）
4. `import_file_id`（string, fk -> uploaded_file.id）
5. `import_template_type`（string, nullable）
6. `export_template_id`（string, fk -> template.id）
7. `remark`（string, nullable）
8. `status`（enum: draft | pending | processing | completed | failed）
9. `created_by`（string, fk -> account.id）
10. `created_at`（datetime）
11. `updated_at`（datetime）

## 7. 实体：generated_report

用途：任务下生成结果（支持一任务多报告）。

字段：

1. `id`（string）
2. `task_id`（string, fk -> task.id）
3. `report_name`（string）
4. `report_type`（enum: body | attachment）
5. `status`（enum: pending | generated | failed）
6. `output_path`（string, nullable）
7. `error_message`（string, nullable）
8. `generated_at`（datetime, nullable）
9. `updated_at`（datetime）

## 8. 关系草图

1. `company` 1 - n `account`
2. `company` 1 - n `uploaded_file`
3. `company` 1 - n `task`
4. `template` 1 - n `task`
5. `uploaded_file` 1 - n `task`（当前阶段 约束下通常 1 - 1）
6. `task` 1 - n `generated_report`

## 9. DTO 建议

1. 登录请求：`company_code`、`username`、`password`
2. 任务列表项：`id`、`task_name`、`import_file_name`、`export_template_name`、`status`、`created_at`、`updated_at`
3. 创建任务请求：`task_name`、`import_file_id`、`import_template_type`、`export_template_id`、`remark`
4. 工作台摘要：`task` + `reports[]` + `latest_logs[]`（可先 mock）
