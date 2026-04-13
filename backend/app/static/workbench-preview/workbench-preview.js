const app = document.getElementById("app");

const TEMPLATE_OPTIONS = [
  {
    id: "export-docx-2026030604-date",
    name: "2026030604-大特.docx",
    filePath: "/Users/dantevonalcatraz/Development/lims-structured-plugin/backend/templates/2026030604-大特.docx",
  },
];
const IMPORT_TEMPLATE_OPTIONS = [
  {
    id: "import-csv-steel-cylinder-periodic-inspection",
    name: "导入模板-钢质无缝气瓶定期检验与评定记录.csv",
    filePath: "/Users/dantevonalcatraz/Development/lims-structured-plugin/backend/templates/导入模板-钢质无缝气瓶定期检验与评定记录.csv",
  },
];
const TASK_TEMPLATE_INFO_FIELDS = [
  { key: "info_title", label: "信息标题" },
  { key: "file_no", label: "文件编号" },
  { key: "inspect_standard", label: "检验执行标准" },
  { key: "record_no", label: "记录编号" },
  { key: "submit_org", label: "送检单位" },
];

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.detail) || "请求失败");
  return data;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTaskDateKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildAutoTaskName(tasks = []) {
  const dateKey = buildTaskDateKey();
  const prefix = `气瓶报告-${dateKey}-`;
  const maxSeq = tasks.reduce((acc, item) => {
    const name = String((item && item.task_name) || "");
    if (!name.startsWith(prefix)) return acc;
    const suffix = name.slice(prefix.length);
    const num = Number.parseInt(suffix, 10);
    if (!Number.isFinite(num)) return acc;
    return Math.max(acc, num);
  }, 0);
  const seq = String(maxSeq + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}

async function getTasks() {
  const data = await requestJson("/api/tasks", { cache: "no-store" });
  return Array.isArray(data.tasks) ? data.tasks : [];
}

function navigate(path) {
  if (String(path).startsWith("/workspace/")) {
    window.location.assign(path);
    return;
  }
  history.pushState({}, "", path);
  render();
}

function toTaskStatusLabel(status) {
  return status;
}

function getPathInfo() {
  const path = window.location.pathname;
  if (path === "/") return { page: "tasks" };
  if (path === "/login") return { page: "tasks" };
  if (path === "/tasks") return { page: "tasks" };
  if (path === "/tasks/new") return { page: "task-create" };
  return { page: "not-found" };
}

function withAppLayout(content, activePath) {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="logo">
          <i class="fa-solid fa-cubes" aria-hidden="true"></i>
          <span>报告工具</span>
        </div>
        <a class="nav-item ${activePath === "/tasks" ? "active" : ""}" href="/tasks" data-nav title="所有任务" aria-label="所有任务">
          <i class="fa-solid fa-table-list" aria-hidden="true"></i>
          <span>所有任务</span>
        </a>
        <a class="nav-item ${activePath === "/tasks/new" ? "active" : ""}" href="/tasks/new" data-nav title="新建任务" aria-label="新建任务">
          <i class="fa-solid fa-square-plus" aria-hidden="true"></i>
          <span>新建任务</span>
        </a>
      </aside>
      <main class="content">${content}</main>
    </div>
  `;
}

async function renderTasks() {
  const tasks = await getTasks();
  const rows = tasks
    .map(
      (t) => {
        const templateInfo = (t && typeof t.template_info === "object" && t.template_info) || {};
        const infoCells = TASK_TEMPLATE_INFO_FIELDS.map((field) => {
          const value = String(templateInfo[field.key] || "");
          return `
            <td>
              <input
                class="inline-input"
                type="text"
                value="${escapeHtml(value)}"
                data-action="edit-template-info"
                data-task-id="${escapeHtml(t.id)}"
                data-field="${field.key}"
              />
            </td>
          `;
        }).join("");
        return `
      <tr>
        <td><a href="/workspace/${t.id}" class="row-link" data-nav>${t.task_name}</a></td>
        ${infoCells}
        <td class="status-cell">
          <span>${toTaskStatusLabel(t.status)}</span>
          ${t.status === "已完成" ? "" : `<button class="btn icon-btn mark-done-btn" type="button" data-action="mark-complete" data-task-id="${t.id}" title="标记完成" aria-label="标记完成"><i class="fa-solid fa-check" aria-hidden="true"></i></button>`}
        </td>
      </tr>
    `;
      },
    )
    .join("");

  const content = `
    <section class="panel">
      <table class="table">
        <thead>
          <tr>
            <th>任务名称</th>
            <th>信息标题</th>
            <th>文件编号</th>
            <th>检验执行标准</th>
            <th>记录编号</th>
            <th>送检单位</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;

  app.innerHTML = withAppLayout(content, "/tasks");
}

async function renderTaskCreate() {
  const exportTemplateOptions = TEMPLATE_OPTIONS.map(
    (t) => `<option value="${t.id}">${t.name}</option>`,
  ).join("");
  const importTemplateOptions = IMPORT_TEMPLATE_OPTIONS.map(
    (t) => `<option value="${t.id}">${t.name}</option>`,
  ).join("");
  const autoTaskName = buildAutoTaskName(await getTasks());

  const content = `
    <h1 class="page-title">新建任务</h1>
    <section class="panel create-task-panel">
      <div class="form-row">
        <label class="label" for="taskNameText">任务名称</label>
        <div id="taskNameText" class="input readonly-value">${autoTaskName}</div>
      </div>
      <div class="form-row">
        <label class="label" for="importTemplateType">导入模板类型</label>
        <select class="select" id="importTemplateType">
          ${importTemplateOptions}
        </select>
      </div>
      <div class="form-row">
        <label class="label" for="exportTemplate">导出模板类型</label>
        <select class="select" id="exportTemplate">
          ${exportTemplateOptions}
        </select>
      </div>
      <button id="createTaskBtn" class="btn primary" type="button" title="创建任务" aria-label="创建任务">创建任务</button>
      <div id="createErr" class="err" style="display:none"></div>
    </section>
  `;

  app.innerHTML = withAppLayout(content, "/tasks/new");

  document.getElementById("createTaskBtn").addEventListener("click", async () => {
    const taskName = autoTaskName;
    const exportTemplateId = document.getElementById("exportTemplate").value;
    const importTemplateType = document.getElementById("importTemplateType").value;
    const err = document.getElementById("createErr");
    if (!taskName || !exportTemplateId || !importTemplateType) {
      err.style.display = "block";
      err.textContent = "请确认模板类型";
      return;
    }
    err.style.display = "none";
    err.textContent = "";

    const templates = TEMPLATE_OPTIONS.reduce((acc, item) => {
      acc[item.id] = item.filePath || item.name;
      return acc;
    }, {});
    const importTemplates = IMPORT_TEMPLATE_OPTIONS.reduce((acc, item) => {
      acc[item.id] = item.filePath || item.name;
      return acc;
    }, {});

    const taskId = `task-${Date.now()}`;
    const task = await requestJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_name: taskName,
        import_template_type: importTemplates[importTemplateType] || "常用导入模板",
        export_template_id: exportTemplateId,
        export_template_name: templates[exportTemplateId] || exportTemplateId,
      }),
    });
    navigate(`/workspace/${(task && task.id) || taskId}`);
  });
}

function bindGlobalEvents() {
  let activeEditRequestToken = 0;

  app.addEventListener("click", (event) => {
    const target = event.target.closest("[data-nav]");
    if (target) {
      event.preventDefault();
      navigate(target.getAttribute("href"));
      return;
    }
    const actionEl = event.target.closest("[data-action='mark-complete']");
    if (actionEl) {
      event.preventDefault();
      const taskId = String(actionEl.getAttribute("data-task-id") || "").trim();
      if (!taskId) return;
      void (async () => {
        await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/complete`, { method: "PATCH" });
        await render();
      })();
      return;
    }
  });

  app.addEventListener("blur", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (String(input.getAttribute("data-action") || "") !== "edit-template-info") return;
    const taskId = String(input.getAttribute("data-task-id") || "").trim();
    const field = String(input.getAttribute("data-field") || "").trim();
    if (!taskId || !field) return;
    const payload = { [field]: String(input.value || "").trim() };
    const requestToken = ++activeEditRequestToken;
    void (async () => {
      try {
        await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/template-info`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (requestToken !== activeEditRequestToken) return;
      }
    })();
  }, true);

  app.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (String(input.getAttribute("data-action") || "") !== "edit-template-info") return;
    input.blur();
  });
}

function ensureAccess() {
  const info = getPathInfo();
  if (info.page === "not-found") {
    navigate("/tasks");
    return false;
  }
  return true;
}

async function render() {
  if (!ensureAccess()) return;
  const info = getPathInfo();
  if (info.page === "tasks") {
    await renderTasks();
    return;
  }
  if (info.page === "task-create") {
    await renderTaskCreate();
    return;
  }
}

window.addEventListener("popstate", () => { void render(); });
bindGlobalEvents();
void render();
