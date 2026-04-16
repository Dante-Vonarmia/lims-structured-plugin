import {
  INSPECT_STANDARD_OPTIONS,
  TASK_TEMPLATE_INFO_FIELDS,
} from "./constants/template-metadata.js";

const app = document.getElementById("app");

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.detail) || "请求失败");
  return data;
}

async function requestForm(url, options = {}) {
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

function readTaskTemplateInfoValue(task, key) {
  const row = task && typeof task === "object" ? task : {};
  const templateInfo = (row.template_info && typeof row.template_info === "object") ? row.template_info : {};
  const nestedValue = String(templateInfo[key] || "").trim();
  if (nestedValue) return nestedValue;
  return String(row[key] || "").trim();
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

async function getTemplateBundles() {
  const data = await requestJson("/api/template-bundles", { cache: "no-store" });
  return {
    inputBundles: Array.isArray(data.input_bundles) ? data.input_bundles : [],
    outputBundles: Array.isArray(data.output_bundles) ? data.output_bundles : [],
  };
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
  const normalized = String(status || "").trim();
  if (normalized === "pending") return "待处理";
  if (normalized === "draft") return "草稿";
  if (normalized === "generated") return "已生成";
  if (normalized === "已完成") return "已生成";
  if (normalized === "待处理" || normalized === "草稿" || normalized === "已生成") return normalized;
  return "待处理";
}

function getPathInfo() {
  const path = window.location.pathname;
  if (path === "/") return { page: "tasks" };
  if (path === "/login") return { page: "tasks" };
  if (path === "/tasks") return { page: "tasks" };
  if (path === "/tasks/new") return { page: "task-create" };
  if (path === "/signatures") return { page: "signatures" };
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
        <a class="nav-item ${activePath === "/signatures" ? "active" : ""}" href="/signatures" data-nav title="签字管理" aria-label="签字管理">
          <i class="fa-solid fa-signature" aria-hidden="true"></i>
          <span>签字管理</span>
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
        const infoCells = TASK_TEMPLATE_INFO_FIELDS.map((field) => {
          const value = readTaskTemplateInfoValue(t, field.key);
          if (field.key === "inspect_standard") {
            const options = Array.isArray(INSPECT_STANDARD_OPTIONS) ? INSPECT_STANDARD_OPTIONS : [];
            const hasMatchedOption = options.includes(value);
            const optionHtml = [
              '<option value=""></option>',
              ...options.map((option) => `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`),
              (!hasMatchedOption && value
                ? [`<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`]
                : []),
            ].flat().join("");
            return `
              <td>
                <select
                  class="inline-input"
                  data-action="edit-template-info"
                  data-task-id="${escapeHtml(t.id)}"
                  data-field="${field.key}"
                >${optionHtml}</select>
              </td>
            `;
          }
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
          <div class="status-cell-inner">
            <span>${toTaskStatusLabel(t.status)}</span>
            <button class="btn archive-btn" type="button" data-action="archive-task" data-task-id="${t.id}" title="归档" aria-label="归档">归档</button>
          </div>
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

async function getSignatures() {
  const data = await requestJson("/api/signatures", { cache: "no-store" });
  return Array.isArray(data.signatures) ? data.signatures : [];
}

async function renderSignatures() {
  const signatures = await getSignatures();
  const rows = signatures.map((item) => `
    <tr>
      <td><img class="signature-thumb" src="${escapeHtml(item.image_url)}?v=${encodeURIComponent(item.updated_at || "")}" alt="${escapeHtml(item.name || "")}" /></td>
      <td><input class="inline-input" type="text" value="${escapeHtml(item.name || "")}" data-signature-id="${escapeHtml(item.id)}" data-signature-field="name" /></td>
      <td>
        <select class="inline-input" data-signature-id="${escapeHtml(item.id)}" data-signature-field="role">
          <option value="" ${!item.role ? "selected" : ""}>未分类</option>
          <option value="inspector" ${item.role === "inspector" ? "selected" : ""}>检验员</option>
          <option value="reviewer" ${item.role === "reviewer" ? "selected" : ""}>审核</option>
          <option value="approver" ${item.role === "approver" ? "selected" : ""}>批准</option>
        </select>
      </td>
      <td><input type="file" accept="image/*" data-signature-id="${escapeHtml(item.id)}" data-signature-field="file" /></td>
      <td class="status-cell">
        <button class="btn icon-btn" type="button" data-action="update-signature" data-signature-id="${escapeHtml(item.id)}" title="保存"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i></button>
        <button class="btn icon-btn" type="button" data-action="delete-signature" data-signature-id="${escapeHtml(item.id)}" title="删除"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </td>
    </tr>
  `).join("");

  const content = `
    <h1 class="page-title">签字管理</h1>
    <section class="panel">
      <div class="form-row signature-upload-row">
        <input id="newSignatureName" class="input" type="text" placeholder="签字名称（例如：张三）" />
        <select id="newSignatureRole" class="select">
          <option value="">未分类</option>
          <option value="inspector">检验员</option>
          <option value="reviewer">审核</option>
          <option value="approver">批准</option>
        </select>
        <input id="newSignatureFile" type="file" accept="image/*" />
        <button class="btn primary" type="button" data-action="upload-signature">上传签字</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>预览</th>
            <th>名称</th>
            <th>角色</th>
            <th>替换图片</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
  app.innerHTML = withAppLayout(content, "/signatures");
}

async function renderTaskCreate() {
  const bundles = await getTemplateBundles();
  const enabledInputBundles = bundles.inputBundles.filter((x) => x && x.enabled && x.availability === "available");
  const enabledOutputBundles = bundles.outputBundles.filter((x) => x && x.enabled && x.availability === "available");
  const exportTemplateOptions = enabledOutputBundles.map((bundle) => {
    const name = String(bundle.displayName || bundle.id || "").trim();
    const version = String(bundle.version || "").trim();
    return `<option value="${escapeHtml(String(bundle.id || ""))}">${escapeHtml(version ? `${name} v${version}` : name)}</option>`;
  }).join("");
  const importTemplateOptions = enabledInputBundles.map((bundle) => {
    const name = String(bundle.displayName || bundle.id || "").trim();
    const version = String(bundle.version || "").trim();
    return `<option value="${escapeHtml(String(bundle.id || ""))}">${escapeHtml(version ? `${name} v${version}` : name)}</option>`;
  }).join("");
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
    const outputBundleId = document.getElementById("exportTemplate").value;
    const inputBundleId = document.getElementById("importTemplateType").value;
    const err = document.getElementById("createErr");
    if (!taskName || !outputBundleId || !inputBundleId) {
      err.style.display = "block";
      err.textContent = "请确认模板类型";
      return;
    }
    err.style.display = "none";
    err.textContent = "";

    const taskId = `task-${Date.now()}`;
    const task = await requestJson("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_name: taskName,
        input_bundle_id: inputBundleId,
        output_bundle_id: outputBundleId,
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
    const archiveEl = event.target.closest("[data-action='archive-task']");
    if (archiveEl) {
      event.preventDefault();
      const taskId = String(archiveEl.getAttribute("data-task-id") || "").trim();
      if (!taskId) return;
      void (async () => {
        await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/archive`, { method: "PATCH" });
        await render();
      })();
      return;
    }
    const uploadSignatureEl = event.target.closest("[data-action='upload-signature']");
    if (uploadSignatureEl) {
      event.preventDefault();
      const nameEl = document.getElementById("newSignatureName");
      const roleEl = document.getElementById("newSignatureRole");
      const fileEl = document.getElementById("newSignatureFile");
      const name = String((nameEl && nameEl.value) || "").trim();
      const role = String((roleEl && roleEl.value) || "").trim();
      const file = fileEl && fileEl.files && fileEl.files[0];
      if (!name || !file) return;
      void (async () => {
        const form = new FormData();
        form.append("name", name);
        form.append("role", role);
        form.append("file", file);
        await requestForm("/api/signatures", { method: "POST", body: form });
        await render();
      })();
      return;
    }
    const updateSignatureEl = event.target.closest("[data-action='update-signature']");
    if (updateSignatureEl) {
      event.preventDefault();
      const signatureId = String(updateSignatureEl.getAttribute("data-signature-id") || "").trim();
      if (!signatureId) return;
      void (async () => {
        const nameEl = app.querySelector(`input[data-signature-id="${signatureId}"][data-signature-field="name"]`);
        const roleEl = app.querySelector(`select[data-signature-id="${signatureId}"][data-signature-field="role"]`);
        const fileEl = app.querySelector(`input[data-signature-id="${signatureId}"][data-signature-field="file"]`);
        const form = new FormData();
        if (nameEl) form.append("name", String(nameEl.value || "").trim());
        if (roleEl) form.append("role", String(roleEl.value || "").trim());
        const file = fileEl && fileEl.files && fileEl.files[0];
        if (file) form.append("file", file);
        await requestForm(`/api/signatures/${encodeURIComponent(signatureId)}`, { method: "PATCH", body: form });
        await render();
      })();
      return;
    }
    const deleteSignatureEl = event.target.closest("[data-action='delete-signature']");
    if (deleteSignatureEl) {
      event.preventDefault();
      const signatureId = String(deleteSignatureEl.getAttribute("data-signature-id") || "").trim();
      if (!signatureId) return;
      void (async () => {
        await requestJson(`/api/signatures/${encodeURIComponent(signatureId)}`, { method: "DELETE" });
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

  app.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) return;
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
  });

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
  if (info.page === "signatures") {
    await renderSignatures();
  }
}

window.addEventListener("popstate", () => { void render(); });
bindGlobalEvents();
void render();
