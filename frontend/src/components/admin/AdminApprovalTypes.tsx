import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, GripVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox as CheckboxInput } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Field = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  repeatable?: boolean;
  options?: string[];
  group?: string; // Group/section name for organizing fields
};
type PageLayout = "portrait" | "landscape";

interface ApprovalType {
  id: string;
  name: string;
  description: string;
  fields: Field[];
  page_layout?: string;
}

export function AdminApprovalTypes() {
  const [types, setTypes] = useState<ApprovalType[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editType, setEditType] = useState<ApprovalType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [pageLayout, setPageLayout] = useState<PageLayout>("portrait");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("fields");
  const [draggedFieldIdx, setDraggedFieldIdx] = useState<number | null>(null);
  const [groups, setGroups] = useState<string[]>(["General"]); // Default group
  const [newGroupName, setNewGroupName] = useState("");

  const fetchTypes = async () => {
    try {
      const data = (await api.approvalTypes.list()) as any[];
      setTypes((data || []).map((d) => ({ ...d, fields: d.fields || [] })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  const openCreate = () => {
    setEditType(null);
    setName("");
    setDescription("");
    setFields([]);
    setPageLayout("portrait");
    setGroups(["General"]);
    setNewGroupName("");
    setActiveTab("fields");
    setDialogOpen(true);
  };
  const openEdit = (t: ApprovalType) => {
    setEditType(t);
    setName(t.name);
    setDescription(t.description);
    setFields(t.fields);
    setPageLayout((t.page_layout as PageLayout) || "portrait");
    // Extract unique groups from fields
    const uniqueGroups = Array.from(
      new Set(t.fields.map((f) => f.group || "General")),
    );
    setGroups(uniqueGroups.length > 0 ? uniqueGroups : ["General"]);
    setNewGroupName("");
    setActiveTab("fields");
    setDialogOpen(true);
  };

  const addField = () =>
    setFields([
      ...fields,
      {
        name: `field_${Date.now()}`,
        label: "",
        type: "text",
        required: false,
        group: groups[0] || "General",
      },
    ]);
  const updateField = (idx: number, updates: Partial<Field>) =>
    setFields(fields.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  const removeField = (idx: number) =>
    setFields(fields.filter((_, i) => i !== idx));

  const addGroup = () => {
    if (!newGroupName.trim()) {
      toast.error("Group name cannot be empty");
      return;
    }
    if (groups.includes(newGroupName)) {
      toast.error("Group already exists");
      return;
    }
    const groupNameToAdd = newGroupName;
    setGroups([...groups, newGroupName]);
    setNewGroupName("");
    toast.success(`Group "${groupNameToAdd}" created`);
  };

  const removeGroup = (groupName: string) => {
    // Don't allow removing if fields still use this group
    const fieldsInGroup = fields.filter(
      (f) => (f.group || "General") === groupName,
    );
    if (fieldsInGroup.length > 0) {
      toast.error(
        "Cannot remove group with fields. Move or delete fields first.",
      );
      return;
    }
    setGroups(groups.filter((g) => g !== groupName));
  };

  const handleDragStartField = (idx: number) => {
    setDraggedFieldIdx(idx);
  };

  const handleDragOverField = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropField = (targetIdx: number) => {
    if (draggedFieldIdx === null || draggedFieldIdx === targetIdx) {
      setDraggedFieldIdx(null);
      return;
    }
    const newFields = [...fields];
    const [draggedItem] = newFields.splice(draggedFieldIdx, 1);
    newFields.splice(targetIdx, 0, draggedItem);
    setFields(newFields);
    setDraggedFieldIdx(null);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    // Field values are stored by `name` in the form_data object.
    // If multiple fields end up with the same/empty name (e.g. empty labels),
    // typing in one field will appear in others. Ensure unique, non-empty names.
    const usedNames = new Set<string>();
    const cleanFields = fields.map((f, idx) => {
      const rawLabel = (f.label ?? "").trim();
      const baseFromLabel = rawLabel
        ? rawLabel.toLowerCase().replace(/\s+/g, "_")
        : f.name;

      // Keep only safe chars; normalize underscores.
      const sanitized = (baseFromLabel || `field_${idx}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

      const candidate = sanitized || f.name || `field_${idx}`;
      let unique = candidate;
      let suffix = 1;
      while (usedNames.has(unique)) {
        unique = `${candidate}_${suffix++}`;
      }
      usedNames.add(unique);

      return { ...f, name: unique };
    });
    try {
      if (editType) {
        await api.approvalTypes.update(editType.id, {
          name,
          description,
          fields: cleanFields,
          page_layout: pageLayout,
        });
        toast.success("Updated");
      } else {
        await api.approvalTypes.create({
          name,
          description,
          fields: cleanFields,
          page_layout: pageLayout,
        });
        toast.success("Created");
      }
      setDialogOpen(false);
      fetchTypes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.approvalTypes.delete(id);
      toast.success("Deleted");
      fetchTypes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {types.length} approval types
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Type
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editType ? "Edit" : "Create"} Approval Type
              </DialogTitle>
            </DialogHeader>
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full mt-4"
            >
              <TabsList className="grid w-full grid-cols-1">
                <TabsTrigger value="fields">Form Fields</TabsTrigger>
              </TabsList>
              <TabsContent value="fields" className="space-y-4 mt-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Page Layout (for printing)</Label>
                  <Select
                    value={pageLayout}
                    onValueChange={(v) => setPageLayout(v as PageLayout)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">
                        Portrait (8.5" × 11")
                      </SelectItem>
                      <SelectItem value="landscape">
                        Landscape (11" × 8.5")
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Field Groups</Label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Organize fields into separate sections. Create groups,
                      then assign fields to them.
                    </p>

                    <div className="bg-muted/30 rounded-lg p-3 mb-3 border border-muted">
                      <p className="text-xs font-medium mb-2">
                        Create a new group:
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="e.g., Personal Info, Company Details"
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          className="text-sm"
                          onKeyPress={(e) => {
                            if (e.key === "Enter") addGroup();
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={addGroup}
                          className="gap-1 whitespace-nowrap"
                        >
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Press Enter or click Add. Repeat to create more groups.
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium mb-2">
                        Available groups:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {groups.map((group) => (
                          <Badge
                            key={group}
                            variant={
                              group === "General" ? "default" : "outline"
                            }
                            className="flex items-center gap-1 px-2 py-1"
                          >
                            {group}
                            {group !== "General" && (
                              <button
                                onClick={() => removeGroup(group)}
                                className="ml-1 text-xs hover:text-destructive"
                                title="Remove group"
                              >
                                ✕
                              </button>
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Form Fields</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addField}
                      className="gap-1"
                    >
                      <Plus className="h-3 w-3" /> Add Field
                    </Button>
                  </div>
                  <div className="space-y-4 max-h-80 overflow-y-auto">
                    {groups.map((group) => {
                      const groupFields = fields.filter(
                        (f) => (f.group || "General") === group,
                      );
                      if (groupFields.length === 0) return null;

                      return (
                        <div
                          key={group}
                          className="space-y-2 pb-4 border-b last:border-b-0"
                        >
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                            {group}
                          </h4>
                          {groupFields.map((field, groupIdx) => {
                            const actualIndex = fields.indexOf(field);
                            return (
                              <div
                                key={actualIndex}
                                draggable
                                onDragStart={() =>
                                  handleDragStartField(actualIndex)
                                }
                                onDragOver={handleDragOverField}
                                onDrop={() => handleDropField(actualIndex)}
                                className={`flex items-start gap-2 p-3 border rounded bg-muted/30 cursor-move transition-opacity ${
                                  draggedFieldIdx === actualIndex
                                    ? "opacity-50"
                                    : ""
                                }`}
                              >
                                <GripVertical className="h-4 w-4 text-muted-foreground mt-2 flex-shrink-0" />
                                <div className="flex-1 grid grid-cols-3 gap-2">
                                  <Input
                                    placeholder="Field label"
                                    value={field.label}
                                    onChange={(e) =>
                                      updateField(actualIndex, {
                                        label: e.target.value,
                                      })
                                    }
                                    className="text-sm"
                                  />
                                  <Select
                                    value={field.group || "General"}
                                    onValueChange={(v) =>
                                      updateField(actualIndex, { group: v })
                                    }
                                  >
                                    <SelectTrigger className="text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {groups.map((g) => (
                                        <SelectItem key={g} value={g}>
                                          {g}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={field.type}
                                    onValueChange={(v) =>
                                      updateField(actualIndex, { type: v })
                                    }
                                  >
                                    <SelectTrigger className="text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="text">Text</SelectItem>
                                      <SelectItem value="number">
                                        Number
                                      </SelectItem>
                                      <SelectItem value="email">
                                        Email
                                      </SelectItem>
                                      <SelectItem value="textarea">
                                        Textarea
                                      </SelectItem>
                                      <SelectItem value="date">Date</SelectItem>
                                      <SelectItem value="select">
                                        Select Dropdown
                                      </SelectItem>
                                      <SelectItem value="radio">
                                        Radio Buttons
                                      </SelectItem>
                                      <SelectItem value="checkbox">
                                        Checkbox
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {(field.type === "select" ||
                                    field.type === "radio") && (
                                    <Input
                                      className="col-span-3 text-sm"
                                      placeholder="Options (comma separated)"
                                      value={field.options?.join(", ") || ""}
                                      onChange={(e) =>
                                        updateField(actualIndex, {
                                          options: e.target.value
                                            .split(",")
                                            .map((s) => s.trim()),
                                        })
                                      }
                                    />
                                  )}
                                  <div className="col-span-3 flex gap-4">
                                    <label className="flex items-center gap-1.5">
                                      <CheckboxInput
                                        checked={field.required}
                                        onCheckedChange={(c) =>
                                          updateField(actualIndex, {
                                            required: !!c,
                                          })
                                        }
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        Required
                                      </span>
                                    </label>
                                    <label className="flex items-center gap-1.5">
                                      <CheckboxInput
                                        checked={field.repeatable ?? false}
                                        onCheckedChange={(c) =>
                                          updateField(actualIndex, {
                                            repeatable: !!c,
                                          })
                                        }
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        Repeatable (Line Items)
                                      </span>
                                    </label>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeField(actualIndex)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {fields.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No fields added yet.
                      </p>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
            <Button onClick={handleSave} className="w-full">
              {editType ? "Update" : "Create"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Loading...
        </p>
      ) : (
        <div className="grid gap-3">
          {types.map((type) => (
            <Card key={type.id} className="border">
              <CardContent className="p-4 flex items-start justify-between">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold">{type.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {type.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {type.fields.map((f) => (
                      <Badge
                        key={f.name}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {f.label} ({f.type}){f.required ? " *" : ""}
                        {f.repeatable ? " [Line Items]" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(type)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(type.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {types.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No approval types yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FormPreview({
  fields,
  pageLayout,
}: {
  fields: Field[];
  pageLayout: PageLayout;
}) {
  const [formData, setFormData] = useState<Record<string, string>>({});

  const handleChange = (fieldName: string, value: string) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  };

  const pageWidth = pageLayout === "portrait" ? "8.5in" : "11in";
  const pageHeight = pageLayout === "portrait" ? "11in" : "8.5in";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Page Layout:{" "}
        {pageLayout === "portrait"
          ? 'Portrait (8.5" × 11")'
          : 'Landscape (11" × 8.5")'}
      </p>
      <div
        style={{
          width: pageWidth,
          height: pageHeight,
          border: "2px solid #999",
          padding: "0.5in",
          backgroundColor: "white",
          fontSize: "11px",
          margin: "auto",
          fontFamily: "Arial, sans-serif",
        }}
        className="overflow-auto space-y-3 shadow-lg"
      >
        {fields.length === 0 ? (
          <p className="text-center text-gray-400 py-8">
            No fields to preview. Add fields to see how the form will look.
          </p>
        ) : (
          fields.map((field) => {
            const fieldValue = formData[field.name] || "";
            const fieldId = `preview_${field.name}`;

            return (
              <div key={field.name} className="mb-2">
                <label
                  htmlFor={fieldId}
                  className="block text-xs font-semibold text-gray-800 mb-0.5"
                >
                  {field.label}{" "}
                  {field.required && <span className="text-red-600">*</span>}
                </label>
                {field.type === "text" && (
                  <input
                    id={fieldId}
                    type="text"
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder="Sample text"
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  />
                )}
                {field.type === "number" && (
                  <input
                    id={fieldId}
                    type="number"
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  />
                )}
                {field.type === "email" && (
                  <input
                    id={fieldId}
                    type="email"
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder="user@example.com"
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  />
                )}
                {field.type === "textarea" && (
                  <textarea
                    id={fieldId}
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    placeholder="Sample text"
                    rows={2}
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  />
                )}
                {field.type === "date" && (
                  <input
                    id={fieldId}
                    type="date"
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  />
                )}
                {field.type === "select" && (
                  <select
                    id={fieldId}
                    value={fieldValue}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    className="w-full border border-gray-400 rounded px-2 py-0.5 text-xs font-sans"
                    style={{ boxSizing: "border-box" }}
                  >
                    <option value="">Select {field.label.toLowerCase()}</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === "radio" && (
                  <div className="space-y-0.5 pt-0.5">
                    {field.options?.map((opt) => (
                      <label key={opt} className="flex items-center text-xs">
                        <input
                          type="radio"
                          name={fieldId}
                          value={opt}
                          checked={fieldValue === opt}
                          onChange={(e) =>
                            handleChange(field.name, e.target.value)
                          }
                          className="mr-1.5 w-3 h-3"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
                {field.type === "checkbox" && (
                  <label className="flex items-center text-xs">
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={fieldValue === "true"}
                      onChange={(e) =>
                        handleChange(field.name, e.target.checked ? "true" : "")
                      }
                      className="mr-1.5 w-3 h-3"
                    />
                    Checkbox option
                  </label>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
