# 页面信息架构与路由

## 1. 页面层级

1. 登录层
   - 登录页
2. 应用主框架层（登录后）
   - 左侧导航（所有任务、新建任务）
   - 内容区（Dashboard / 新建任务 / 工作台）

## 2. 路由结构

建议最小路由：

1. `/login`：登录页
2. `/tasks`：所有任务（Dashboard）
3. `/tasks/new`：新建任务
4. `/workspace/:task_id`：工作台
5. `/`：根据登录态重定向到 `/login` 或 `/tasks`

## 3. 左侧导航结构

仅保留：

1. 所有任务（路由：`/tasks`）
2. 新建任务（路由：`/tasks/new`）

说明：

1. 工作台不出现在左侧导航中，按任务上下文进入。
2. 不增加设置、消息、用户中心等菜单。

## 4. 页面进入与返回关系

1. 登录成功：`/login` -> `/tasks`
2. 新建任务入口：`/tasks` -> `/tasks/new`
3. 创建任务成功：`/tasks/new` -> `/workspace/:task_id`
4. 查看任务详情：`/tasks` -> `/workspace/:task_id`
5. 工作台返回：`/workspace/:task_id` -> `/tasks`

## 5. 页面状态与访问控制（最小）

1. 未登录访问 `/tasks`、`/tasks/new`、`/workspace/:task_id` 时，重定向 `/login`
2. 已登录访问 `/login` 时，重定向 `/tasks`

## 6. 信息架构约束

1. Dashboard 只承载任务视图，不叠加无关信息块。
2. 新建任务页只承载创建入口，不扩展复杂配置面板。
3. 工作台先保证“可承接”，不做复杂 IDE 化设计。
