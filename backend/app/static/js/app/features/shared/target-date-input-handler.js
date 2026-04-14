export function createTargetDateInputHandler(deps = {}) {
  const {
    $,
    shiftDateText,
    applyDateLinkageRules,
  } = deps;

  function normalizeDigits(raw, maxLen) {
    return String(raw || "").replace(/\D+/g, "").slice(0, maxLen);
  }

  function readDateField(formRoot, fieldName) {
    const yearInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="year"]`);
    const monthInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="month"]`);
    const dayInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="day"]`);
    const hiddenInputEl = formRoot.querySelector(`input[type="hidden"][data-field="${fieldName}"]`);
    if (
      !(yearInputEl instanceof HTMLInputElement)
      || !(monthInputEl instanceof HTMLInputElement)
      || !(dayInputEl instanceof HTMLInputElement)
      || !(hiddenInputEl instanceof HTMLInputElement)
    ) return null;
    return {
      year: String(yearInputEl.value || ""),
      month: String(monthInputEl.value || ""),
      day: String(dayInputEl.value || ""),
      value: String(hiddenInputEl.value || ""),
      exact: hiddenInputEl.getAttribute("data-date-exact") === "1",
    };
  }

  function writeDateField(formRoot, fieldName, nextField, eventType) {
    if (!nextField || typeof nextField !== "object") return;
    const yearInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="year"]`);
    const monthInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="month"]`);
    const dayInputEl = formRoot.querySelector(`input[data-date-field="${fieldName}"][data-date-part="day"]`);
    const hiddenInputEl = formRoot.querySelector(`input[type="hidden"][data-field="${fieldName}"]`);
    if (
      !(yearInputEl instanceof HTMLInputElement)
      || !(monthInputEl instanceof HTMLInputElement)
      || !(dayInputEl instanceof HTMLInputElement)
      || !(hiddenInputEl instanceof HTMLInputElement)
    ) return;
    const nextYear = String(nextField.year || "");
    const nextMonth = String(nextField.month || "");
    const nextDay = String(nextField.day || "");
    const nextValue = String(nextField.value || "");
    if (yearInputEl.value !== nextYear) yearInputEl.value = nextYear;
    if (monthInputEl.value !== nextMonth) monthInputEl.value = nextMonth;
    if (dayInputEl.value !== nextDay) dayInputEl.value = nextDay;
    if (hiddenInputEl.value !== nextValue) {
      hiddenInputEl.value = nextValue;
      if (nextField.exact) hiddenInputEl.setAttribute("data-date-exact", "1");
      else hiddenInputEl.removeAttribute("data-date-exact");
      hiddenInputEl.dispatchEvent(new Event(eventType === "change" ? "change" : "input", { bubbles: true }));
    }
  }

  function handleTargetDateInput(target, eventType = "input") {
    if (!(target instanceof HTMLInputElement)) return false;
    const datePart = String(target.getAttribute("data-date-part") || "").trim();
    const dateField = String(target.getAttribute("data-date-field") || "").trim();
    if (!datePart || !dateField) return false;
    const grid = target.closest(".target-date-grid");
    if (!(grid instanceof HTMLElement)) return false;
    const formRoot = $("targetFieldForm");
    const yearInput = grid.querySelector('input[data-date-field][data-date-part="year"]');
    const monthInput = grid.querySelector('input[data-date-field][data-date-part="month"]');
    const dayInput = grid.querySelector('input[data-date-field][data-date-part="day"]');
    const hiddenInput = grid.parentElement ? grid.parentElement.querySelector(`input[type="hidden"][data-field="${dateField}"]`) : null;
    if (!(yearInput instanceof HTMLInputElement) || !(monthInput instanceof HTMLInputElement) || !(dayInput instanceof HTMLInputElement)) return false;
    if (!(hiddenInput instanceof HTMLInputElement)) return false;
    const year = normalizeDigits(yearInput.value, 4);
    const month = normalizeDigits(monthInput.value, 2);
    const day = normalizeDigits(dayInput.value, 2);
    if (yearInput.value !== year) yearInput.value = year;
    if (monthInput.value !== month) monthInput.value = month;
    if (dayInput.value !== day) dayInput.value = day;
    const isDateComplete = !!(year && month && day);
    let composed = "";
    if (year || month || day) {
      composed = `${year}${year ? "年" : ""}${month ? `${month}月` : ""}${day ? `${day}日` : ""}`;
    }
    if (hiddenInput.value !== composed) hiddenInput.value = composed;
    if (isDateComplete) hiddenInput.setAttribute("data-date-exact", "1");
    else hiddenInput.removeAttribute("data-date-exact");
    hiddenInput.dispatchEvent(new Event(eventType === "change" ? "change" : "input", { bubbles: true }));

    if (formRoot instanceof HTMLElement) {
      const fields = {
        receive_date: readDateField(formRoot, "receive_date"),
        calibration_date: readDateField(formRoot, "calibration_date"),
        release_date: readDateField(formRoot, "release_date"),
      };
      const nextFields = applyDateLinkageRules({
        changedField: dateField,
        changedPart: datePart,
        fields,
        shiftDateText,
      });
      writeDateField(formRoot, "receive_date", nextFields.receive_date, eventType);
      writeDateField(formRoot, "calibration_date", nextFields.calibration_date, eventType);
      writeDateField(formRoot, "release_date", nextFields.release_date, eventType);
    }
    return true;
  }

  return {
    handleTargetDateInput,
  };
}

