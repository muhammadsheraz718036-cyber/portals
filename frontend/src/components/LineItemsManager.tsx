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
import {
  buildSingleEntryItems,
  getGroups,
  type LineItem,
} from "@/lib/lineItems";
import {
  fieldGridClass,
  inputTypeForField,
  isFieldRequired,
  isFieldVisible,
} from "@/lib/formSchema";

interface LineItemsManagerProps {
  items: LineItem[];
  onItemsChange: (items: LineItem[]) => void;
  repeatableFields: ApprovalFormField[];
  title?: string;
}

export function LineItemsManager({
  items,
  onItemsChange,
  repeatableFields,
  title = "Line Items",
}: LineItemsManagerProps) {
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

  if (repeatableFields.length === 0) {
    return null;
  }

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
    const commonInputProps = {
      placeholder: field.placeholder || field.label,
      min: field.min,
      max: field.max,
      minLength: field.min_length,
      maxLength: field.max_length,
      pattern: field.pattern,
    };

    switch (field.type) {
      case "currency":
      case "number":
        return (
          <Input
            type="number"
            min={field.min ?? 0}
            max={field.max}
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
      case "time":
      case "datetime":
      case "email":
      case "url":
      case "phone":
        return (
          <Input
            type={inputTypeForField(field)}
            value={stringValue}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            {...commonInputProps}
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

      case "multiselect":
        return (
          <select
            multiple
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={(e) =>
              updateItem(
                itemId,
                field.name,
                Array.from(e.target.selectedOptions).map((option) => option.value),
              )
            }
            className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case "textarea":
        return (
          <Textarea
            value={String(value)}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            placeholder={field.placeholder || field.label}
            minLength={field.min_length}
            maxLength={field.max_length}
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
      case "yes_no":
        const options = field.type === "yes_no" ? ["yes", "no"] : field.options ?? [];
        return (
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
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
                  {field.type === "yes_no" ? option.toUpperCase() : option}
                </Label>
              </div>
            ))}
          </div>
        );

      default:
        return (
          <Input
            type={inputTypeForField(field)}
            value={String(value)}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            {...commonInputProps}
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
                (field) =>
                  (field.group || "General") === group &&
                  isFieldVisible(field, { items: normalizedItems }, group),
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
                          className={`space-y-2 rounded-lg bg-background/70 p-3 ${fieldGridClass(field)}`}
                        >
                          <Label
                            htmlFor={`${groupItem.id}-${field.name}`}
                            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {field.label}
                            {isFieldRequired(field, { items: normalizedItems }, group) && (
                              <span className="ml-1 text-destructive">*</span>
                            )}
                          </Label>
                          <div id={`${groupItem.id}-${field.name}`}>
                            {renderFieldInput(field, groupItem, groupItem.id)}
                          </div>
                          {field.help_text && (
                            <p className="text-xs text-muted-foreground">
                              {field.help_text}
                            </p>
                          )}
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
