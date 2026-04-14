export function createReplaceSourceWithRowsProgressively(deps = {}) {
  const {
    state,
    applyAutoTemplateMatch,
    renderQueue,
    renderTemplateSelect,
    waitMs,
  } = deps;

  return async function replaceSourceWithRowsProgressively(sourceItem, recordRows, stageLabel) {
    const rows = Array.isArray(recordRows) ? recordRows : [];
    const index = state.queue.findIndex((x) => x.id === sourceItem.id);
    if (index < 0) return;
    state.queue.splice(index, 1);
    renderQueue();
    renderTemplateSelect();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.templateName) await applyAutoTemplateMatch(row, { force: true });
      row.message = `${stageLabel} ${i + 1}/${rows.length}`;
      state.queue.splice(index + i, 0, row);
      if (i === 0) state.activeId = row.id;
      renderQueue();
      renderTemplateSelect();
      await waitMs(26);
    }
  };
}
