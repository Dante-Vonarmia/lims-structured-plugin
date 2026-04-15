# 钢质无缝气瓶项目执行与追踪文档

更新时间：2026-04-15  
负责人：Codex + Dante

## 1. 当前目标（冻结版）
- OCR 持续优化并保留真实识别链路；当前阶段先优先把字段类型、模板占位与导出链路打通。
- 基于基准数据，完成字段类型、右侧模板占位、表格填充规律的调通。
- 形成可追踪、可量化、可复盘的执行记录，避免重复沟通。

## 2. 字段类型基线（唯一准则）
本项目字段类型统一为以下 5 类：

1. `date`
2. `string`
3. `number`
4. `check`
5. `signature`（jpg）

补充约定：
- 所有日期相关字段 -> `date`
- 出厂编号/制造单位代码/充装介质/产权代码编号等文本标识 -> `string`
- 带单位数值（水压、保压、容积、壁厚、重量等） -> `number`
- 检查项（勾选）与“校阀/换阀”二选一 -> `check`
- 签名库图片字段（检验员/审核员/批准）-> `signature`

输入侧展示约定（2026-04-15）：
- `date`：使用日期组件样式展示，不按普通 string 显示。
- `check`：仅识别 `true` 为勾选；非 `true` 一律按空值显示。
- `checkbox_choice`（如“瓶阀检验”）：使用单选标签样式显示，不按普通 string 显示。
- `signature`：按“签名名称 -> jpg 图片”映射展示，优先显示签名缩略图。

## 3. 模板来源与规则来源（实施锚点）
输入模板（识别对象）：
- `backend/template-bundles/input/steel-cylinder-v1/schema.csv`
- `backend/template-bundles/input/steel-cylinder-v1/rules.json`
- `backend/template-bundles/input/steel-cylinder-v1/manifest.json`

兼容路径（历史）：
- `backend/templates/import-template-steel-cylinder-periodic-inspection.csv`
- `backend/templates/import-template-steel-cylinder-periodic-inspection.rules.json`

右侧字段编辑（导出模板 editor schema）：
- `backend/app/rules/template_profiles/r-899b.yaml`
- `backend/app/rules/template_mapping_library.yaml`

## 4. 工作分解（可执行）
### Epic A：基准数据集可用化
- A1. 固定源图：`/Users/dantevonalcatraz/Downloads/大特/test.jpeg`
- A2. 产出 baseline seed（9~10 条），并可重复生成任务
- A3. 标注“高置信字段/低置信字段”，便于后续校正

### Epic B：类型系统落地（5 类）
- B1. 把输入模板字段逐列映射到 `date/string/number/check/signature`
- B2. 校验 `typedFields` 输出是否与类型一致
- B3. 修正 `rules.json` 与 UI 展示一致性（左侧识别清单）

### Epic C：模板占位与表数据规律
- C1. 右侧字段与占位符一一对应（含附表文本）
- C2. `check` 类型映射到模板中的勾选逻辑
- C3. `signature(jpg)` 从签名库注入并可导出

### Epic D：验收与回归
- D1. 固定 1 张图 + 固定 seed 的回归任务
- D2. 每次修改后按统一清单验收
- D3. 记录偏差、更新 issue 和复盘

## 5. 量化指标（KPI）
### 数据完整性
- 目标：基准任务每条记录“非空字段覆盖率” >= 80%
- 公式：`非空字段数 / 总字段数`

### 类型正确率
- 目标：`typedFields` 与约定类型一致率 >= 95%
- 统计口径：按字段计数，不按页面显示计数

### 导出可用率
- 目标：模板导出成功率 100%（基准任务）
- 目标：签名图片注入成功率 100%（有签名输入时）

### 回归稳定性
- 目标：同一 seed 连续 3 次生成，关键字段一致率 >= 98%

## 6. 验收清单（每次迭代必跑）
1. 基准任务可创建且可打开工作台
2. 左侧识别清单按模板分组展示
3. 日期字段显示为日期控件/日期语义
4. 数值字段可作为 number 处理
5. `check` 字段（含校阀/换阀）可被识别和导出
6. 签名字段可从签名库选择并写入导出文档
7. 生成文档无关键占位残留

## 7. Issue 追踪区（持续更新）
| ID | 标题 | 分类 | 严重级别 | 状态 | 负责人 | 发现日期 | 目标完成 |
|---|---|---|---|---|---|---|---|
| SC-001 | 基准任务字段缺失过多 | 数据完整性 | High | Open | Codex | 2026-04-15 | 2026-04-16 |
| SC-002 | 日期字段类型偶发退化为 string | 类型系统 | High | Open | Codex | 2026-04-15 | 2026-04-16 |
| SC-003 | check 字段在部分行识别不稳定 | check 映射 | Medium | Open | Codex | 2026-04-15 | 2026-04-17 |
| SC-004 | 签名字段导出链路需专项回归 | signature | Medium | Open | Codex | 2026-04-15 | 2026-04-17 |

状态定义：
- `Open`：已确认问题，待处理
- `In Progress`：处理中
- `Blocked`：外部阻塞
- `Done`：已完成并验收

## 8. 复盘模板（每次闭环填写）
### 8.1 本次改动
- 改了哪些文件：
- 解决了哪些 Issue：

### 8.2 指标变化
- 覆盖率：
- 类型正确率：
- 导出可用率：

### 8.3 剩余风险
- 

### 8.4 下一步
- 

## 9. 变更记录
- 2026-04-15：建立首版执行与追踪文档，冻结 5 类字段类型基线。
- 2026-04-15：确认“`OCR继续做` + `四字段字典库仅做辅助归一`”决策；新增字典库案底 `backend/app/rules/steel_cylinder_value_library.json`。
