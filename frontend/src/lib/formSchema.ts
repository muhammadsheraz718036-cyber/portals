import type { ApprovalFormField, FieldConditionRule } from "@/lib/constants";

export const FORM_FIELD_TYPES = [
  "text",
  "number",
  "email",
  "textarea",
  "date",
  "time",
  "datetime",
  "phone",
  "url",
  "currency",
  "select",
  "multiselect",
  "radio",
  "checkbox",
  "yes_no",
] as const;

export const FIELD_WIDTHS = ["half", "full", "third"] as const;
export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "empty",
  "not_empty",
] as const;

export type FieldWidth = (typeof FIELD_WIDTHS)[number];

export function inputTypeForField(field: ApprovalFormField) {
  switch (field.type) {
    case "email":
      return "email";
    case "number":
    case "currency":
      return "number";
    case "date":
      return "date";
    case "time":
      return "time";
    case "datetime":
      return "datetime-local";
    case "url":
      return "url";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

export function fieldGridClass(field: ApprovalFormField) {
  if (field.width === "full" || field.type === "textarea") return "sm:col-span-2";
  if (field.width === "third") return "lg:col-span-1";
  return "";
}

export function normalizeOptions(options?: string[]) {
  return (options ?? []).map((option) => option.trim()).filter(Boolean);
}

export function optionNeedsOptions(type: string) {
  return type === "select" || type === "multiselect" || type === "radio";
}

export function emptyValueForField(field: ApprovalFormField) {
  if (field.type === "multiselect") return [];
  if (field.type === "checkbox") return "";
  return field.default_value ?? "";
}

export function formatFormValue(field: ApprovalFormField | null, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (field?.type === "checkbox") return value === true || value === "true" ? "Yes" : "No";
  if (field?.type === "yes_no") return value === "yes" ? "Yes" : value === "no" ? "No" : "—";
  if (field?.type === "currency") {
    const n = Number(value);
    return Number.isFinite(n)
      ? new Intl.NumberFormat(undefined, { style: "currency", currency: "SAR" }).format(n)
      : String(value);
  }
  if (field?.type === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}

function valueMatchesCondition(value: unknown, rule: FieldConditionRule) {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (rule.operator === "empty") return isEmpty;
  if (rule.operator === "not_empty") return !isEmpty;

  const expected = rule.value;
  if (rule.operator === "contains") {
    if (Array.isArray(value)) return value.map(String).includes(String(expected ?? ""));
    return String(value ?? "").includes(String(expected ?? ""));
  }

  if (rule.operator === "greater_than" || rule.operator === "less_than") {
    const actualNumber = Number(value);
    const expectedNumber = Number(expected);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    return rule.operator === "greater_than"
      ? actualNumber > expectedNumber
      : actualNumber < expectedNumber;
  }

  const equals = Array.isArray(value)
    ? value.map(String).includes(String(expected ?? ""))
    : String(value ?? "") === String(expected ?? "");

  return rule.operator === "equals" ? equals : !equals;
}

export function getFieldValue(
  formData: Record<string, unknown>,
  fieldName: string,
  group?: string,
) {
  const items = Array.isArray(formData.items)
    ? (formData.items as Record<string, unknown>[])
    : [];
  const item = items.find((entry) => String(entry.__group || "General") === (group || "General"));
  return item?.[fieldName] ?? formData[fieldName];
}

export function evaluateCondition(
  rule: FieldConditionRule | null | undefined,
  formData: Record<string, unknown>,
  group?: string,
) {
  if (!rule?.field || !rule.operator) return true;
  return valueMatchesCondition(getFieldValue(formData, rule.field, group), rule);
}

export function isFieldVisible(
  field: ApprovalFormField,
  formData: Record<string, unknown>,
  group?: string,
) {
  return evaluateCondition(field.visible_when, formData, group);
}

export function isFieldRequired(
  field: ApprovalFormField,
  formData: Record<string, unknown>,
  group?: string,
) {
  if (!isFieldVisible(field, formData, group)) return false;
  return Boolean(
    field.required ||
      (field.required_when?.field &&
        evaluateCondition(field.required_when, formData, group)),
  );
}
