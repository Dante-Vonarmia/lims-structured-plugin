# Frontend JS Architecture

## 目录分层

- `app/`
  - 页面编排层（初始化、状态流转、事件绑定）
  - 当前入口：`app/main.js`
- `core/`
  - 纯配置与纯状态工厂
  - `core/config/constants.js`：常量、字段定义、模板规则配置
  - `core/state/factory.js`：`state` 与空字段工厂
- `infra/`
  - 基础设施适配层（网络、存储、第三方）
  - `infra/api/client.js`：所有 HTTP API 调用
- `docs/`
  - 架构文档与约束

## 约束

1. `core/*` 不允许依赖 DOM。
2. `infra/*` 不允许读写页面状态对象 `state`。
3. `app/*` 允许组合 `core` + `infra`，但不应承载纯算法实现。
4. 新功能优先落到 feature 模块，不再向 `app/main.js` 堆积。

## 下一步拆分建议

1. 从 `app/main.js` 拆 `features/general-check/*`（解析、清洗、渲染）
2. 拆 `features/template-match/*`（模板提示、候选匹配）
3. 拆 `features/catalog/*`（目录装填、比对、UI 交互）

## 命名规范

- 文件名：`kebab-case`
- 工厂函数：`createXxx`
- API 函数：`xxxApi`
- 纯函数优先 `export function`，避免默认导出
