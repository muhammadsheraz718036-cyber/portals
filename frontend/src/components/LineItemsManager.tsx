import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import type { ApprovalFormField } from "@/lib/constants";

export interface LineItem {
  id: string;
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

  const addItem = () => {
    const newItem: LineItem = {
      id: Date.now().toString(),
    };
    // Initialize all repeatable fields
    repeatableFields.forEach((field) => {
      newItem[field.name] = field.type === "number" ? 0 : "";
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

  const renderFieldInput = (field: ApprovalFormField, item: LineItem, itemId: string) => {
    const value = item[field.name] ?? (field.type === "number" ? 0 : "");
    const stringValue = String(value || "");
    const numberValue = Number(value || 0);

    switch (field.type) {
      case "number":
        return (
          <Input
            type="number"
            min="0"
            step="0.01"
            value={numberValue}
            onChange={(e) => updateItem(itemId, field.name, e.target.value ? Number(e.target.value) : 0)}
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
          <Select value={String(value)} onValueChange={(v) => updateItem(itemId, field.name, v)}>
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
        <Button type="button" size="sm" onClick={addItem} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Entry
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No entries added yet. Click "Add Entry" to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {repeatableFields.map((field) => (
                    <th
                      key={field.name}
                      className={`text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide ${
                        field.type === "number" ? "text-right" : ""
                      }`}
                    >
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide w-12">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    {repeatableFields.map((field) => (
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
      </CardContent>
    </Card>
  );
}
