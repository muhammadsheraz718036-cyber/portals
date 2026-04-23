import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalFormField } from "@/lib/constants";

export interface LineItem {
  id: string;
  __group?: string;
  [key: string]: string | number | unknown;
}

interface LineItemsManagerProps {
  items: LineItem[];
  onItemsChange: (items: LineItem[]) => void;
  repeatableFields: ApprovalFormField[];
  title?: string;
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

export function LineItemsManager({
  items,
  onItemsChange,
  repeatableFields,
  title = "Line Items",
}: LineItemsManagerProps) {
  if (repeatableFields.length === 0) {
    return null;
  }

  const groups = useMemo(
    () => getGroups(repeatableFields),
    [repeatableFields],
  );

  const normalizedItems = useMemo(
    () => buildSingleEntryItems(repeatableFields, items),
    [repeatableFields, items],
  );

  useEffect(() => {
    const current = JSON.stringify(items);
    const normalized = JSON.stringify(normalizedItems);
    if (current !== normalized) {
      onItemsChange(normalizedItems);
    }
  }, [items, normalizedItems, onItemsChange]);

  const updateItem = (id: string, fieldName: string, value: unknown) => {
    onItemsChange(
      normalizedItems.map((item) =>
        item.id === id
          ? {
              ...item,
              [fieldName]: value,
            }
          : item,
      ),
    );
  };

  const renderFieldInput = (
    field: ApprovalFormField,
    item: LineItem,
    itemId: string,
  ) => {
    const value = item[field.name] ?? "";
    const stringValue = String(value || "");

    switch (field.type) {
      case "number":
        return (
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={stringValue}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            onFocus={(e) => {
              // Auto-clear common default values when user focuses
              const currentValue = e.target.value;
              if (
                currentValue === "0" ||
                currentValue === "000" ||
                currentValue === "0000" ||
                currentValue === "00000"
              ) {
                updateItem(itemId, field.name, "");
              }
            }}
            className="h-10 w-full border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={stringValue}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            className="h-10 w-full border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        );

      case "select":
        return (
          <Select
            value={String(value)}
            onValueChange={(v) => updateItem(itemId, field.name, v)}
          >
            <SelectTrigger className="h-10 border border-input bg-background px-3 focus:ring-2 focus:ring-primary/30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "textarea":
        return (
          <Textarea
            value={String(value)}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            className="min-h-[88px] border border-input bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary/30"
            rows={2}
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center justify-center">
            <Checkbox
              checked={value === "true"}
              onCheckedChange={(checked) =>
                updateItem(itemId, field.name, checked ? "true" : "")
              }
            />
          </div>
        );

      case "radio":
        return (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((option) => (
              <div key={option} className="flex items-center space-x-1">
                <input
                  type="radio"
                  id={`${itemId}_${field.name}_${option}`}
                  name={`${itemId}_${field.name}`}
                  value={option}
                  checked={String(value) === option}
                  onChange={(e) =>
                    updateItem(itemId, field.name, e.target.value)
                  }
                  className="h-3 w-3"
                />
                <Label
                  htmlFor={`${itemId}_${field.name}_${option}`}
                  className="text-xs cursor-pointer"
                >
                  {option}
                </Label>
              </div>
            ))}
          </div>
        );

      default:
        return (
          <Input
            type="text"
            value={String(value)}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            className="h-10 w-full border border-input bg-background px-3 focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        );
    }
  };

  return (
    <Card className="border">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">
              No repeatable fields in this approval type.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => {
              const groupFields = repeatableFields.filter(
                (field) => (field.group || "General") === group,
              );
              const groupItems = normalizedItems.filter(
                (item) => String(item.__group || "General") === group,
              );
              const groupItem = groupItems[0];

              return (
                <div key={group} className="rounded-lg border bg-muted/10">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h4 className="text-sm font-semibold">{group}</h4>
                  </div>

                  {!groupItem ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      This section is loading.
                    </div>
                  ) : (
                    <div className="grid gap-4 p-4 sm:grid-cols-2">
                      {groupFields.map((field) => (
                        <div
                          key={`${groupItem.id}-${field.name}`}
                          className={`space-y-2 rounded-lg bg-background/70 p-3 ${
                            field.type === "textarea" ? "sm:col-span-2" : ""
                          }`}
                        >
                          <Label
                            htmlFor={`${groupItem.id}-${field.name}`}
                            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {field.label}
                            {field.required && (
                              <span className="ml-1 text-destructive">*</span>
                            )}
                          </Label>
                          <div id={`${groupItem.id}-${field.name}`}>
                            {renderFieldInput(field, groupItem, groupItem.id)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
