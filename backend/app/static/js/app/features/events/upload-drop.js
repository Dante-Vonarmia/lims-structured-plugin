export function createUploadDropBindings(deps = {}) {
  const {
    $,
    state,
    isSupportedFile,
    extFromName,
    createQueueItem,
    renderQueue,
    renderTemplateSelect,
    setStatus,
    appendLog,
    updateTaskStatusApi,
    processAllPending,
  } = deps;

  async function readDirectoryEntries(reader) {
    const all = [];
    while (true) {
      const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!chunk || !chunk.length) break;
      all.push(...chunk);
    }
    return all;
  }

  async function filesFromEntry(entry) {
    if (!entry) return [];
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return file ? [file] : [];
    }
    if (entry.isDirectory) {
      const entries = await readDirectoryEntries(entry.createReader());
      const nested = await Promise.all(entries.map((x) => filesFromEntry(x)));
      return nested.flat();
    }
    return [];
  }

  async function filesFromDataTransfer(dt) {
    if (!dt) return [];
    const items = Array.from(dt.items || []);
    if (items.length && items.some((x) => typeof x.webkitGetAsEntry === "function")) {
      const entries = items
        .map((x) => (typeof x.webkitGetAsEntry === "function" ? x.webkitGetAsEntry() : null))
        .filter(Boolean);
      if (entries.length) {
        const groups = await Promise.all(entries.map((entry) => filesFromEntry(entry)));
        return groups.flat();
      }
    }
    return Array.from(dt.files || []);
  }

  function addFilesToQueue(files) {
    if (!files.length) return;
    const supported = files.filter((f) => isSupportedFile(f));
    const skipped = files.length - supported.length;
    const extSet = new Set(supported.map((f) => extFromName((f && f.name) || "")));
    if (!supported.length) {
      setStatus("未发现可识别文件");
      if (skipped > 0) appendLog(`拖拽/上传中有 ${skipped} 个不支持文件已忽略`);
      return;
    }
    supported.forEach((f) => state.queue.push(createQueueItem(f)));
    renderQueue();
    renderTemplateSelect();
    setStatus(`已加入队列：${supported.length} 个`);
    appendLog(`新增 ${supported.length} 个文件到队列`);
    if (extSet.size > 1) appendLog("提示：本次上传包含多种来源类型，建议按同类型分批上传。");
    if (skipped > 0) appendLog(`已忽略 ${skipped} 个不支持文件`);
    const taskId = String((state.taskContext && state.taskContext.id) || "").trim();
    if (taskId && typeof updateTaskStatusApi === "function") {
      void updateTaskStatusApi(taskId, "草稿").catch(() => {});
    }
  }

  function bindUploadEvents() {
    $("uploadBtn").addEventListener("click", (event) => {
      if (state.busy) return;
      event.preventDefault();
      $("sourceFiles").click();
    });

    $("sourceFiles").addEventListener("change", async () => {
      const files = Array.from($("sourceFiles").files || []);
      addFilesToQueue(files);
      $("sourceFiles").value = "";
      if (!state.busy) await processAllPending();
    });
  }

  function bindQueueLayoutAndDropEvents(queueListEl) {
    const splitterEl = $("listDetailSplitter");
    let splitterDragging = false;
    let splitterStartY = 0;
    let splitterStartHeight = 0;

    const setQueueListHeight = (height) => {
      const minHeight = 140;
      const maxHeight = Math.max(minHeight, 216);
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(height)));
      queueListEl.style.height = `${nextHeight}px`;
    };

    if (splitterEl) {
      splitterEl.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        splitterDragging = true;
        splitterStartY = event.clientY;
        splitterStartHeight = queueListEl.getBoundingClientRect().height;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        event.preventDefault();
      });
    }

    document.addEventListener("mousemove", (event) => {
      if (!splitterDragging) return;
      const delta = event.clientY - splitterStartY;
      setQueueListHeight(splitterStartHeight + delta);
    });

    document.addEventListener("mouseup", () => {
      if (!splitterDragging) return;
      splitterDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });

    let dragDepth = 0;
    const showDropState = () => queueListEl.classList.add("drop-active");
    const hideDropState = () => queueListEl.classList.remove("drop-active");

    queueListEl.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      showDropState();
    });

    queueListEl.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      showDropState();
    });

    queueListEl.addEventListener("dragleave", (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDropState();
    });

    queueListEl.addEventListener("drop", async (event) => {
      event.preventDefault();
      dragDepth = 0;
      hideDropState();
      if (state.busy) return;
      try {
        const files = await filesFromDataTransfer(event.dataTransfer);
        addFilesToQueue(files);
        if (!state.busy) await processAllPending();
      } catch (error) {
        setStatus(`拖拽失败：${error.message || "unknown"}`);
        appendLog(`拖拽失败：${error.message || "unknown"}`);
      }
    });
  }

  return {
    addFilesToQueue,
    bindUploadEvents,
    bindQueueLayoutAndDropEvents,
  };
}

