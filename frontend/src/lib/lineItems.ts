import type { ApprovalFormField } from "@/lib/constants";

export interface LineItem {
  id: string;
  __group?: string;
  [key: string]: string | number | unknown;
}

function getGroups(repeatableFields: ApprovalFormField[]) {
  return Array.from(
    new Set(repeatableFields.map((field) => field.group || "General")),
  );
}

export function buildSingleEntryItems(
  repeatableFields: ApprovalFormField[],
  items: LineItem[] = [],
): LineItem[] {
  const groups = getGroups(repeatableFields);

  return groups.map((group, index) => {
    const existing = items.find(
      (item) => String(item.__group || "General") === group,
    );

    const nextItem: LineItem = {
      id: existing?.id || `${group}-${index}`,
      __group: group,
    };

    repeatableFields
      .filter((field) => (field.group || "General") === group)
      .forEach((field) => {
        nextItem[field.name] = existing?.[field.name] ?? "";
      });

    return nextItem;
  });
}
