const fieldKey = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const types = new Set(["number", "text", "boolean", "select", "weights"]);
const weightSources = new Set(["options", "departments", "hospitals"]);

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptions(options) {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).slice(0, 100).flatMap((option) => {
    if (typeof option?.value !== "string" || !option.value || option.value.length > 100
        || typeof option.label !== "string" || !option.label.trim() || seen.has(option.value)) return [];
    seen.add(option.value);
    return [{ value: option.value, label: option.label.trim().slice(0, 100) }];
  });
}

export function normalizeModEditorSchema(schema) {
  const normalized = {};
  for (const scope of ["scenario", "map"]) {
    if (!Array.isArray(schema?.[scope])) continue;
    const fields = [];
    const seen = new Set();
    for (const field of schema[scope].slice(0, 40)) {
      if (!isRecord(field) || typeof field.key !== "string" || !fieldKey.test(field.key)
          || seen.has(field.key) || !types.has(field.type) || typeof field.label !== "string" || !field.label.trim()) continue;
      const spec = { key: field.key, type: field.type, label: field.label.trim().slice(0, 100) };
      if (field.required === true) spec.required = true;
      if (field.type === "number" || field.type === "weights") {
        for (const name of ["min", "max", "step"]) {
          if (Number.isFinite(field[name]) && (name !== "step" || field.step > 0)) spec[name] = field[name];
        }
        if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) continue;
      }
      if (field.type === "select" || field.type === "weights") {
        spec.options = normalizeOptions(field.options);
      }
      if (field.type === "weights") {
        spec.source = weightSources.has(field.source) ? field.source : "options";
        if (scope === "scenario" && spec.source === "hospitals") continue;
        if (Number.isFinite(field.total) && field.total >= 0) spec.total = field.total;
        if (isRecord(field.default)) {
          spec.default = Object.fromEntries(Object.entries(field.default).slice(0, 250)
            .filter(([key, value]) => key.length <= 100 && Number.isFinite(value)));
        }
      } else if (typeof field.default === ({ number: "number", text: "string", boolean: "boolean", select: "string" })[field.type]) {
        spec.default = typeof field.default === "string" ? field.default.slice(0, 500) : field.default;
      }
      seen.add(field.key);
      fields.push(spec);
    }
    if (fields.length) normalized[scope] = fields;
  }
  return normalized;
}

function bounds(input, field, defaults = {}) {
  const min = field.min ?? defaults.min;
  const max = field.max ?? defaults.max;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.step = field.step ?? defaults.step ?? "any";
}

function fieldLabel(text, control) {
  const label = document.createElement("label");
  label.append(document.createTextNode(text), control);
  return label;
}

function makeField(field, value, sources) {
  if (field.type === "weights") {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = field.label;
    const grid = document.createElement("div");
    grid.className = "form-grid two";
    const hint = document.createElement("small");
    hint.className = "inline-hint";
    const options = field.source === "options" ? field.options : sources[field.source] || [];
    const previous = isRecord(value) ? value : {};
    const entries = options.map((option) => {
      const input = document.createElement("input");
      input.type = "number";
      bounds(input, field, { min: 0, step: 0.01 });
      input.value = previous[option.value] ?? field.default?.[option.value] ?? 0;
      grid.append(fieldLabel(option.label, input));
      return [option.value, input];
    });
    fieldset.append(legend, grid, hint);
    const read = () => Object.fromEntries(entries.map(([key, input]) => [key, Number(input.value) || 0]));
    const validate = () => {
      const sum = Object.values(read()).reduce((total, weight) => total + weight, 0);
      if (!entries.length || field.total === undefined) return;
      const valid = Math.abs(sum - field.total) < 1e-6;
      hint.textContent = `Summe ${Math.round(sum * 100) / 100} von ${field.total}`;
      entries[0][1].setCustomValidity(valid ? "" : `Die Summe muss ${field.total} ergeben.`);
    };
    validate();
    return { node: fieldset, read, validate };
  }
  const input = document.createElement(field.type === "select" ? "select" : "input");
  input.required = Boolean(field.required);
  if (field.type === "select") {
    input.append(new Option("—", ""));
    for (const option of field.options) input.append(new Option(option.label, option.value));
    if (typeof value === "string" && value && !field.options.some((option) => option.value === value)) {
      input.append(new Option(value, value));
    }
    input.value = value ?? field.default ?? "";
  } else if (field.type === "boolean") {
    input.type = "checkbox";
    input.required = false;
    input.checked = (value ?? field.default) === true;
    const label = fieldLabel(field.label, input);
    label.className = "check-row";
    return { node: label, read: () => input.checked };
  } else {
    input.type = field.type;
    input.value = value ?? field.default ?? "";
    if (field.type === "number") bounds(input, field);
    else input.maxLength = 500;
  }
  return { node: fieldLabel(field.label, input), read: () => {
    if (field.type === "number") return input.value === "" ? undefined : input.valueAsNumber;
    return input.value;
  } };
}

export function createModEditorFields(fields, values, sources, onChange) {
  const data = { ...(isRecord(values) ? values : {}) };
  const container = document.createElement("div");
  container.className = "form-grid two";
  const editors = fields.map((field) => [field, makeField(field, Object.hasOwn(data, field.key) ? data[field.key] : undefined, sources)]);
  for (const [, editor] of editors) container.append(editor.node);
  const read = () => {
    for (const [field, editor] of editors) {
      const value = editor.read();
      if (value === undefined) delete data[field.key];
      else Object.defineProperty(data, field.key, { value, enumerable: true, configurable: true, writable: true });
    }
    return { ...data };
  };
  const validate = () => {
    editors.forEach(([, editor]) => editor.validate?.());
    const invalid = [...container.querySelectorAll("input, select")].find((input) => !input.validity.valid);
    if (!invalid) return true;
    const details = container.closest("details");
    if (details) details.open = true;
    invalid.reportValidity();
    return false;
  };
  container.addEventListener("input", () => {
    editors.forEach(([, editor]) => editor.validate?.());
    onChange?.(read());
  });
  return { container, read, validate };
}
