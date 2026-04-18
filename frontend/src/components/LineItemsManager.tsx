import { Button } from "@/components/ui/button";
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
import { Plus, Trash2 } from "lucide-react";
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

export function LineItemsManager({
  items,
  onItemsChange,
  repeatableFields,
  title = "Line Items",
}: LineItemsManagerProps) {
  if (repeatableFields.length === 0) {
    return null;
  }

  const groups = Array.from(
    new Set(repeatableFields.map((field) => field.group || "General")),
  );

  const addItemToGroup = (group: string) => {
    const newItem: LineItem = {
      id: Date.now().toString(),
      __group: group,
    };

    // Initialize only group fields
    repeatableFields
      .filter((field) => (field.group || "General") === group)
      .forEach((field) => {
        newItem[field.name] = "";
      });

    onItemsChange([...items, newItem]);
  };

  const removeItem = (id: string) => {
    onItemsChange(items.filter((item) => item.id !== id));
  };

  const updateItem = (id: string, fieldName: string, value: unknown) => {
    onItemsChange(
      items.map((item) =>
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
            className="w-full bg-background border-0 px-2 focus-visible:ring-0"
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={stringValue}
            onChange={(e) => updateItem(itemId, field.name, e.target.value)}
            className="w-full bg-background border-0 px-2 focus-visible:ring-0"
          />
        );

      case "select":
        return (
          <Select
            value={String(value)}
            onValueChange={(v) => updateItem(itemId, field.name, v)}
          >
            <SelectTrigger className="h-8 bg-background border-0 px-2 focus:ring-0">
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
            className="bg-background border-0 px-2 focus-visible:ring-0"
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
            className="w-full bg-background border-0 px-2 focus-visible:ring-0"
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
              const groupItems = items.filter(
                (item) => String(item.__group || "General") === group,
              );

              return (
                <div key={group} className="rounded-lg border bg-muted/10">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h4 className="text-sm font-semibold">{group}</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addItemToGroup(group)}
                    >
                      <Plus className="h-4 w-4" /> Add Entry
                    </Button>
                  </div>

                  {groupItems.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No entries yet for this group.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            {groupFields.map((field) => (
                              <th
                                key={`${group}-${field.name}`}
                                className={`text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap ${
                                  field.type === "number" ? "text-right" : ""
                                }`}
                              >
                                {field.label}
                                {field.required && (
                                  <span className="text-destructive ml-1">
                                    *
                                  </span>
                                )}
                              </th>
                            ))}
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide w-12 whitespace-nowrap">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {groupItems.map((item) => (
                            <tr
                              key={item.id}
                              className="hover:bg-muted/30 transition-colors"
                            >
                              {groupFields.map((field) => (
                                <td
                                  key={`${item.id}-${field.name}`}
                                  className={`px-4 py-3 ${field.type === "number" ? "text-right" : ""}`}
                                >
                                  {renderFieldInput(field, item, item.id)}
                                </td>
                              ))}
                              <td className="text-center px-4 py-3">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeItem(item.id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
