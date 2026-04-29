import { useState, useEffect } from "react";
import {
  Plus,
  Edit,
  Trash2,
  GripVertical,
  Copy,
  Download,
  Paperclip,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useApprovalTypes,
  useCreateApprovalType,
  useUpdateApprovalType,
  useDeleteApprovalType,
  useDepartments,
} from "@/hooks/services";
import { services } from "@/services";
import { toast } from "sonner";
import { CONDITION_OPERATORS, FIELD_WIDTHS, FORM_FIELD_TYPES, optionNeedsOptions } from "@/lib/formSchema";
import type { FieldConditionRule } from "@/lib/constants";

type Field = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  group?: string; // Field group for organizing into separate sections
  description?: string;
  order?: number;
  action?: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  width?: "third" | "half" | "full";
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  print_hidden?: boolean;
  print_label?: string;
  visible_when?: FieldConditionRule | null;
  required_when?: FieldConditionRule | null;
};

type AttachmentField = {
  id?: string;
  field_name: string;
  label: string;
  required: boolean;
  max_file_size_mb: number;
  allowed_extensions: string[];
  max_files: number;
  template_original_filename?: string | null;
  template_file_size_bytes?: number | null;
  templateFile?: File | null;
  removeTemplate?: boolean;
};

type PageLayout = "portrait" | "landscape";

interface ApprovalType {
  id: string;
  name: string;
  description: string;
  fields: Field[];
  page_layout?: string;
  allow_attachments?: boolean;
  pre_salutation?: string;
  post_salutation?: string;
  department_id?: string | null;
}

function sanitizeIdentifier(value: string) {
  return (value || "field")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function updateCondition(
  current: FieldConditionRule | null | undefined,
  updates: Partial<FieldConditionRule>,
): FieldConditionRule {
  return {
    field: current?.field || "",
    operator: current?.operator || "equals",
    value: current?.value ?? "",
    ...updates,
  };
}

export function AdminApprovalTypes() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editType, setEditType] = useState<ApprovalType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [pageLayout, setPageLayout] = useState<PageLayout>("portrait");
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [attachmentFields, setAttachmentFields] = useState<AttachmentField[]>(
    [],
  );
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [activeTab, setActiveTab] = useState("fields");
  const [draggedFieldIdx, setDraggedFieldIdx] = useState<number | null>(null);
  const [groups, setGroups] = useState<string[]>(["General"]); // Default group
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState("");
  const [preSalutation, setPreSalutation] = useState("");
  const [postSalutation, setPostSalutation] = useState("");

  // React Query hooks
  const { data: departments = [] } = useDepartments();
  const { data: types = [], isLoading: isLoadingTypes } = useApprovalTypes();
  const createMutation = useCreateApprovalType();
  const updateMutation = useUpdateApprovalType();
  const deleteMutation = useDeleteApprovalType();

  const openCreate = () => {
    setEditType(null);
    setName("");
    setDescription("");
    setFields([]);
    setPageLayout("portrait");
    setAllowAttachments(false);
    setAttachmentFields([]);
    setGroups(["General"]);
    setNewGroupName("");
    setEditingGroupName(null);
    setEditingGroupValue("");
    setPreSalutation("");
    setPostSalutation("");
    setDepartmentId(null);
    setActiveTab("fields");
    setDialogOpen(true);
  };
  const openEdit = async (t: ApprovalType) => {
    setEditType(t);
    setName(t.name);
    setDescription(t.description);
    setFields(t.fields);
    setPageLayout((t.page_layout as PageLayout) || "portrait");
    setAllowAttachments(t.allow_attachments || false);
    setPreSalutation(t.pre_salutation || "");
    setPostSalutation(t.post_salutation || "");
    setDepartmentId(t.department_id ?? null);
    // Extract unique groups from fields
    const uniqueGroups = Array.from(
      new Set(t.fields.map((f) => f.group || "General")),
    );
    setGroups(uniqueGroups.length > 0 ? uniqueGroups : ["General"]);
    setNewGroupName("");
    setEditingGroupName(null);
    setEditingGroupValue("");
    setActiveTab("fields");
    setAttachmentFields([]);
    setDialogOpen(true);
    if (t.allow_attachments) {
      setIsLoadingAttachments(true);
      try {
        const attachments = await services.approvalTypes.getAttachments(t.id);
        setAttachmentFields(
          attachments.map((attachment) => ({
            id: attachment.id,
            field_name: attachment.field_name,
            label: attachment.label,
            required: attachment.required,
            max_file_size_mb: attachment.max_file_size_mb,
            allowed_extensions: attachment.allowed_extensions,
            max_files: attachment.max_files,
            template_original_filename: attachment.template_original_filename,
            template_file_size_bytes: attachment.template_file_size_bytes,
            templateFile: null,
            removeTemplate: false,
          })),
        );
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : "Failed to load attachment fields",
        );
      } finally {
        setIsLoadingAttachments(false);
      }
    }
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
        width: "half",
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

  const startEditGroup = (groupName: string) => {
    setEditingGroupName(groupName);
    setEditingGroupValue(groupName);
  };

  const cancelEditGroup = () => {
    setEditingGroupName(null);
    setEditingGroupValue("");
  };

  const saveEditedGroup = () => {
    if (!editingGroupName) return;

    const nextName = editingGroupValue.trim();
    if (!nextName) {
      toast.error("Group name cannot be empty");
      return;
    }
    if (nextName === editingGroupName) {
      cancelEditGroup();
      return;
    }
    if (groups.includes(nextName)) {
      toast.error("Group already exists");
      return;
    }

    setGroups(
      groups.map((group) => (group === editingGroupName ? nextName : group)),
    );
    setFields(
      fields.map((field) =>
        (field.group || "General") === editingGroupName
          ? { ...field, group: nextName }
          : field,
      ),
    );
    toast.success(`Group renamed to "${nextName}"`);
    cancelEditGroup();
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

  // Attachment field management
  const addAttachmentField = () => {
    const newField: AttachmentField = {
      field_name: `attachment_${Date.now()}`,
      label: "",
      required: false,
      max_file_size_mb: 10,
      allowed_extensions: [
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "jpg",
        "jpeg",
        "png",
      ],
      max_files: 1,
    };
    setAttachmentFields([...attachmentFields, newField]);
  };

  const updateAttachmentField = (
    idx: number,
    updates: Partial<AttachmentField>,
  ) => {
    setAttachmentFields(
      attachmentFields.map((f, i) => (i === idx ? { ...f, ...updates } : f)),
    );
  };

  const removeAttachmentField = (idx: number) => {
    setAttachmentFields(attachmentFields.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Approval type name is required");
      return;
    }
    if (fields.some((field) => !field.label.trim())) {
      toast.error("Every form field needs a label");
      setActiveTab("fields");
      return;
    }
    if (fields.some((field) => optionNeedsOptions(field.type) && (!field.options || field.options.filter(Boolean).length === 0))) {
      toast.error("Select, multi-select, and radio fields need at least one option");
      setActiveTab("fields");
      return;
    }

    const cleanAttachmentFields = allowAttachments
      ? attachmentFields.map((field, idx) => ({
          ...field,
          field_name: sanitizeIdentifier(field.field_name || field.label || `attachment_${idx}`),
          label: field.label.trim(),
          max_file_size_mb: clampInt(field.max_file_size_mb, 1, 100, 10),
          max_files: clampInt(field.max_files, 1, 10, 1),
          allowed_extensions: Array.from(new Set(field.allowed_extensions)),
          template_original_filename: field.template_original_filename,
          template_file_size_bytes: field.template_file_size_bytes,
          templateFile: field.templateFile ?? null,
          removeTemplate: field.removeTemplate ?? false,
        }))
      : [];

    if (cleanAttachmentFields.some((field) => !field.label)) {
      toast.error("Every attachment field needs a display label");
      setActiveTab("attachments");
      return;
    }
    if (cleanAttachmentFields.some((field) => field.allowed_extensions.length === 0)) {
      toast.error("Every attachment field needs at least one allowed file type");
      setActiveTab("attachments");
      return;
    }
    const attachmentNames = new Set<string>();
    for (const field of cleanAttachmentFields) {
      if (attachmentNames.has(field.field_name)) {
        toast.error("Attachment field names must be unique");
        setActiveTab("attachments");
        return;
      }
      attachmentNames.add(field.field_name);
    }

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
      const sanitized = sanitizeIdentifier(baseFromLabel || `field_${idx}`);

      const candidate = sanitized || f.name || `field_${idx}`;
      let unique = candidate;
      let suffix = 1;
      while (usedNames.has(unique)) {
        unique = `${candidate}_${suffix++}`;
      }
      usedNames.add(unique);

      return {
        ...f,
        label: rawLabel,
        name: unique,
        options: f.options?.map((option) => option.trim()).filter(Boolean),
        group: f.group?.trim() || "General",
        placeholder: f.placeholder?.trim() || undefined,
        help_text: f.help_text?.trim() || undefined,
        default_value: f.default_value?.trim() || undefined,
        width: f.width || "half",
        min: f.min,
        max: f.max,
        min_length: f.min_length,
        max_length: f.max_length,
        pattern: f.pattern?.trim() || undefined,
        print_hidden: f.print_hidden || undefined,
        print_label: f.print_label?.trim() || undefined,
        visible_when: f.visible_when?.field ? f.visible_when : undefined,
        required_when: f.required_when?.field ? f.required_when : undefined,
      };
    });

    try {
      let savedType: ApprovalType;
      if (editType) {
        savedType = await updateMutation.mutateAsync({
          id: editType.id,
          data: {
            name,
            description,
            fields: cleanFields,
            page_layout: pageLayout,
            pre_salutation: preSalutation || null,
            post_salutation: postSalutation || null,
            allow_attachments: allowAttachments,
            attachment_fields: cleanAttachmentFields.map(({ templateFile, removeTemplate, ...field }) => field),
            department_id: departmentId,
          },
        });
        toast.success("Updated");
      } else {
        savedType = await createMutation.mutateAsync({
          name,
          description,
          fields: cleanFields,
          page_layout: pageLayout,
          pre_salutation: preSalutation || null,
          post_salutation: postSalutation || null,
          allow_attachments: allowAttachments,
          attachment_fields: cleanAttachmentFields.map(({ templateFile, removeTemplate, ...field }) => field),
          department_id: departmentId,
        });
        toast.success("Created");
      }

      if (allowAttachments) {
        const savedAttachments = await services.approvalTypes.getAttachments(savedType.id);
        for (const field of cleanAttachmentFields) {
          const savedAttachment = savedAttachments.find(
            (attachment) => attachment.field_name === field.field_name,
          );
          if (!savedAttachment) continue;
          if (field.removeTemplate && savedAttachment.template_original_filename) {
            await services.approvalTypes.deleteTemplateFile(
              savedType.id,
              savedAttachment.id,
            );
          }
          if (field.templateFile) {
            await services.approvalTypes.uploadTemplateFile(
              savedType.id,
              savedAttachment.id,
              field.templateFile,
            );
          }
        }
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleDuplicate = async (type: ApprovalType) => {
    try {
      const attachmentFieldsToCopy = type.allow_attachments
        ? await services.approvalTypes.getAttachments(type.id)
        : [];
      await createMutation.mutateAsync({
        name: `${type.name} (Copy)`,
        description: type.description,
        fields: type.fields.map((f) => ({ ...f })),
        page_layout: type.page_layout,
        pre_salutation: type.pre_salutation,
        post_salutation: type.post_salutation,
        allow_attachments: attachmentFieldsToCopy.length > 0,
        attachment_fields: attachmentFieldsToCopy.map((field) => ({
          field_name: field.field_name,
          label: field.label,
          required: field.required,
          max_file_size_mb: field.max_file_size_mb,
          allowed_extensions: field.allowed_extensions,
          max_files: field.max_files,
        })),
        department_id: type.department_id ?? null,
      });
      toast.success("Approval type duplicated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate failed");
    }
  };

  const renderGroupChip = (group: string) => {
    if (editingGroupName === group) {
      return (
        <div
          key={group}
          className="flex items-center gap-2 rounded-md border bg-background px-2 py-1"
        >
          <Input
            value={editingGroupValue}
            onChange={(e) => setEditingGroupValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEditedGroup();
              if (e.key === "Escape") cancelEditGroup();
            }}
            className="h-7 min-w-[150px] text-xs"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={saveEditedGroup}
            className="h-7 w-7 p-0"
            title="Save group name"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelEditGroup}
            className="h-7 w-7 p-0"
            title="Cancel editing"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }

    return (
      <div
        key={group}
        className="flex items-center gap-2 rounded-md border bg-background px-2 py-1"
      >
        <Badge
          variant={group === "General" ? "default" : "outline"}
          className="px-2 py-1"
        >
          {group}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => startEditGroup(group)}
          className="h-7 w-7 p-0"
          title="Rename group"
        >
          <Edit className="h-3.5 w-3.5" />
        </Button>
        {group !== "General" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeGroup(group)}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            title="Remove group"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
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
              <DialogDescription>
                Configure form fields, attachments, and salutations for this approval type.
              </DialogDescription>
            </DialogHeader>
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full mt-4"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="fields">Form Fields</TabsTrigger>
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
                <TabsTrigger value="salutations">Salutations</TabsTrigger>
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
                  <Label>Department</Label>
                  <Select
                    value={departmentId ?? "global"}
                    onValueChange={(value) => setDepartmentId(value === "global" ? null : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department (or global)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global (all departments)</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <div className="flex items-center space-x-2">
                  <Switch
                    id="allow-attachments"
                    checked={allowAttachments}
                    onCheckedChange={setAllowAttachments}
                  />
                  <Label htmlFor="allow-attachments" className="cursor-pointer">
                    Allow file attachments
                  </Label>
                </div>
                {allowAttachments && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      <Paperclip className="inline h-4 w-4 mr-1" />
                      Configure attachment fields in the Attachments tab
                    </p>
                  </div>
                )}
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
                        {groups.map((group) => renderGroupChip(group))}
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
                          {groupFields.map((field) => {
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
                                      updateField(actualIndex, {
                                        type: v,
                                        options: optionNeedsOptions(v) ? field.options : undefined,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {FORM_FIELD_TYPES.map((type) => (
                                        <SelectItem key={type} value={type}>
                                          {type.replace("_", " ")}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {optionNeedsOptions(field.type) && (
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
                                  <Input
                                    className="text-sm"
                                    placeholder="Placeholder"
                                    value={field.placeholder || ""}
                                    onChange={(e) =>
                                      updateField(actualIndex, {
                                        placeholder: e.target.value,
                                      })
                                    }
                                  />
                                  <Input
                                    className="text-sm"
                                    placeholder="Help text"
                                    value={field.help_text || ""}
                                    onChange={(e) =>
                                      updateField(actualIndex, {
                                        help_text: e.target.value,
                                      })
                                    }
                                  />
                                  <Input
                                    className="text-sm"
                                    placeholder="Default value"
                                    value={field.default_value || ""}
                                    onChange={(e) =>
                                      updateField(actualIndex, {
                                        default_value: e.target.value,
                                      })
                                    }
                                  />
                                  <Select
                                    value={field.width || "half"}
                                    onValueChange={(v) =>
                                      updateField(actualIndex, {
                                        width: v as Field["width"],
                                      })
                                    }
                                  >
                                    <SelectTrigger className="text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {FIELD_WIDTHS.map((width) => (
                                        <SelectItem key={width} value={width}>
                                          {width}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {(field.type === "number" || field.type === "currency") && (
                                    <>
                                      <Input
                                        type="number"
                                        className="text-sm"
                                        placeholder="Min"
                                        value={field.min ?? ""}
                                        onChange={(e) =>
                                          updateField(actualIndex, {
                                            min: e.target.value === "" ? undefined : Number(e.target.value),
                                          })
                                        }
                                      />
                                      <Input
                                        type="number"
                                        className="text-sm"
                                        placeholder="Max"
                                        value={field.max ?? ""}
                                        onChange={(e) =>
                                          updateField(actualIndex, {
                                            max: e.target.value === "" ? undefined : Number(e.target.value),
                                          })
                                        }
                                      />
                                    </>
                                  )}
                                  {["text", "email", "textarea", "phone", "url"].includes(field.type) && (
                                    <>
                                      <Input
                                        type="number"
                                        min="0"
                                        className="text-sm"
                                        placeholder="Min length"
                                        value={field.min_length ?? ""}
                                        onChange={(e) =>
                                          updateField(actualIndex, {
                                            min_length: e.target.value === "" ? undefined : Number(e.target.value),
                                          })
                                        }
                                      />
                                      <Input
                                        type="number"
                                        min="0"
                                        className="text-sm"
                                        placeholder="Max length"
                                        value={field.max_length ?? ""}
                                        onChange={(e) =>
                                          updateField(actualIndex, {
                                            max_length: e.target.value === "" ? undefined : Number(e.target.value),
                                          })
                                        }
                                      />
                                      <Input
                                        className="text-sm"
                                        placeholder="Regex pattern"
                                        value={field.pattern || ""}
                                        onChange={(e) =>
                                          updateField(actualIndex, {
                                            pattern: e.target.value,
                                          })
                                        }
                                      />
                                    </>
                                  )}
                                  <Input
                                    className="text-sm"
                                    placeholder="Print label override"
                                    value={field.print_label || ""}
                                    onChange={(e) =>
                                      updateField(actualIndex, {
                                        print_label: e.target.value,
                                      })
                                    }
                                  />
                                  <div className="col-span-3 grid gap-2 rounded-md border bg-background/70 p-2 md:grid-cols-4">
                                    <div className="text-xs font-medium text-muted-foreground md:pt-2">
                                      Visible when
                                    </div>
                                    <Select
                                      value={field.visible_when?.field || "always"}
                                      onValueChange={(v) =>
                                        updateField(actualIndex, {
                                          visible_when:
                                            v === "always"
                                              ? undefined
                                              : updateCondition(field.visible_when, { field: v }),
                                        })
                                      }
                                    >
                                      <SelectTrigger className="text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="always">Always visible</SelectItem>
                                        {fields
                                          .filter((_, i) => i !== actualIndex)
                                          .map((candidate) => (
                                            <SelectItem key={candidate.name} value={candidate.name}>
                                              {candidate.label || candidate.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={field.visible_when?.operator || "equals"}
                                      disabled={!field.visible_when?.field}
                                      onValueChange={(v) =>
                                        updateField(actualIndex, {
                                          visible_when: updateCondition(field.visible_when, {
                                            operator: v as FieldConditionRule["operator"],
                                          }),
                                        })
                                      }
                                    >
                                      <SelectTrigger className="text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CONDITION_OPERATORS.map((op) => (
                                          <SelectItem key={op} value={op}>
                                            {op.replace("_", " ")}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      className="text-sm"
                                      placeholder="Value"
                                      disabled={
                                        !field.visible_when?.field ||
                                        field.visible_when.operator === "empty" ||
                                        field.visible_when.operator === "not_empty"
                                      }
                                      value={String(field.visible_when?.value ?? "")}
                                      onChange={(e) =>
                                        updateField(actualIndex, {
                                          visible_when: updateCondition(field.visible_when, {
                                            value: e.target.value,
                                          }),
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="col-span-3 grid gap-2 rounded-md border bg-background/70 p-2 md:grid-cols-4">
                                    <div className="text-xs font-medium text-muted-foreground md:pt-2">
                                      Required when
                                    </div>
                                    <Select
                                      value={field.required_when?.field || "never"}
                                      onValueChange={(v) =>
                                        updateField(actualIndex, {
                                          required_when:
                                            v === "never"
                                              ? undefined
                                              : updateCondition(field.required_when, { field: v }),
                                        })
                                      }
                                    >
                                      <SelectTrigger className="text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="never">No condition</SelectItem>
                                        {fields
                                          .filter((_, i) => i !== actualIndex)
                                          .map((candidate) => (
                                            <SelectItem key={candidate.name} value={candidate.name}>
                                              {candidate.label || candidate.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={field.required_when?.operator || "equals"}
                                      disabled={!field.required_when?.field}
                                      onValueChange={(v) =>
                                        updateField(actualIndex, {
                                          required_when: updateCondition(field.required_when, {
                                            operator: v as FieldConditionRule["operator"],
                                          }),
                                        })
                                      }
                                    >
                                      <SelectTrigger className="text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CONDITION_OPERATORS.map((op) => (
                                          <SelectItem key={op} value={op}>
                                            {op.replace("_", " ")}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      className="text-sm"
                                      placeholder="Value"
                                      disabled={
                                        !field.required_when?.field ||
                                        field.required_when.operator === "empty" ||
                                        field.required_when.operator === "not_empty"
                                      }
                                      value={String(field.required_when?.value ?? "")}
                                      onChange={(e) =>
                                        updateField(actualIndex, {
                                          required_when: updateCondition(field.required_when, {
                                            value: e.target.value,
                                          }),
                                        })
                                      }
                                    />
                                  </div>
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
                                        checked={field.print_hidden || false}
                                        onCheckedChange={(c) =>
                                          updateField(actualIndex, {
                                            print_hidden: !!c,
                                          })
                                        }
                                      />
                                      <span className="text-xs text-muted-foreground">
                                        Hide in print
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
              <TabsContent value="attachments" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium">
                        File Attachment Fields
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Configure which file upload fields users will see when
                        submitting requests
                      </p>
                    </div>
                    <Button
                      onClick={addAttachmentField}
                      size="sm"
                      className="gap-2"
                      disabled={!allowAttachments}
                    >
                      <Plus className="h-4 w-4" /> Add Attachment Field
                    </Button>
                  </div>

                  {!allowAttachments ? (
                    <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                      <Paperclip className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">
                        Enable file attachments in the Form Fields tab to
                        configure attachment fields
                      </p>
                    </div>
                  ) : isLoadingAttachments ? (
                    <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                      <p className="text-muted-foreground">
                        Loading attachment fields...
                      </p>
                    </div>
                  ) : attachmentFields.length === 0 ? (
                    <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                      <Paperclip className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-2">
                        No attachment fields configured
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Attachment fields are optional. Add one only when this
                        request type should collect files.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {attachmentFields.map((field, idx) => (
                        <Card key={idx} className="p-4">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">
                                Attachment Field {idx + 1}
                              </h4>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => removeAttachmentField(idx)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <Label>Field Name (Internal)</Label>
                                <Input
                                  value={field.field_name}
                                  onChange={(e) =>
                                    updateAttachmentField(idx, {
                                      field_name: e.target.value,
                                    })
                                  }
                                  placeholder="e.g., supporting_documents"
                                />
                                <p className="text-xs text-muted-foreground">
                                  Internal field identifier (no spaces, use
                                  underscores)
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <Label>Display Label</Label>
                                <Input
                                  value={field.label}
                                  onChange={(e) =>
                                    updateAttachmentField(idx, {
                                      label: e.target.value,
                                    })
                                  }
                                  placeholder="e.g., Supporting Documents"
                                />
                                <p className="text-xs text-muted-foreground">
                                  What users will see as the field label
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                              <div className="space-y-1.5">
                                <Label>Max File Size (MB)</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={field.max_file_size_mb}
                                  onChange={(e) =>
                                    updateAttachmentField(idx, {
                                      max_file_size_mb:
                                        parseInt(e.target.value) || 10,
                                    })
                                  }
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label>Max Files</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={field.max_files}
                                  onChange={(e) =>
                                    updateAttachmentField(idx, {
                                      max_files: parseInt(e.target.value) || 1,
                                    })
                                  }
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label>Required</Label>
                                <div className="mt-2">
                                  <CheckboxInput
                                    checked={field.required}
                                    onCheckedChange={(checked) =>
                                      updateAttachmentField(idx, {
                                        required: !!checked,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>Allowed Extensions</Label>
                              <div className="grid grid-cols-4 gap-2 mt-2">
                                {[
                                  "pdf",
                                  "doc",
                                  "docx",
                                  "xls",
                                  "xlsx",
                                  "jpg",
                                  "jpeg",
                                  "png",
                                ].map((ext) => (
                                  <div
                                    key={ext}
                                    className="flex items-center space-x-2"
                                  >
                                    <CheckboxInput
                                      id={`ext-${ext}-${idx}`}
                                      checked={field.allowed_extensions.includes(
                                        ext,
                                      )}
                                      onCheckedChange={(checked) => {
                                        const extensions = checked
                                          ? [...field.allowed_extensions, ext]
                                          : field.allowed_extensions.filter(
                                              (e) => e !== ext,
                                            );
                                        updateAttachmentField(idx, {
                                          allowed_extensions: extensions,
                                        });
                                      }}
                                    />
                                    <Label
                                      htmlFor={`ext-${ext}-${idx}`}
                                      className="text-sm"
                                    >
                                      .{ext}
                                    </Label>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                              <Label>Admin Template File (Optional)</Label>
                              <p className="text-xs text-muted-foreground">
                                Users can download this file while filling the form, complete it, and upload it back with the request.
                              </p>
                              <Input
                                type="file"
                                accept={field.allowed_extensions.map((ext) => `.${ext}`).join(",")}
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  updateAttachmentField(idx, {
                                    templateFile: file,
                                    removeTemplate: file ? false : field.removeTemplate,
                                  });
                                }}
                              />
                              {(field.templateFile ||
                                (field.template_original_filename && !field.removeTemplate)) && (
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="font-medium">
                                    {field.templateFile?.name ||
                                      field.template_original_filename}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {field.templateFile
                                      ? formatBytes(field.templateFile.size)
                                      : formatBytes(field.template_file_size_bytes)}
                                  </span>
                                  {field.id && field.template_original_filename && !field.removeTemplate && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 gap-1"
                                      onClick={() => {
                                        window.open(
                                          services.approvalTypes.getTemplateDownloadUrl(field.id!),
                                          "_blank",
                                        );
                                      }}
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      Download
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-destructive hover:text-destructive"
                                    onClick={() =>
                                      updateAttachmentField(idx, {
                                        templateFile: null,
                                        removeTemplate: true,
                                      })
                                    }
                                  >
                                    Remove template
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="salutations" className="space-y-4 mt-4">
                <div className="space-y-1.5">
                  <Label>Pre-Salutation (Optional)</Label>
                  <RichTextEditor
                    content={preSalutation}
                    onChange={setPreSalutation}
                    placeholder="e.g., Dear [Recipient],&#10;&#10;I hope this message finds you well..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Default greeting text that will appear before the form data
                    in approval requests.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Post-Salutation (Optional)</Label>
                  <RichTextEditor
                    content={postSalutation}
                    onChange={setPostSalutation}
                    placeholder="e.g., Thank you for your attention to this matter.&#10;&#10;Best regards,&#10;[Your Name]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default closing text that will appear after the form data in
                    approval requests.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
            <Button onClick={handleSave} className="w-full">
              {editType ? "Update" : "Create"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
      {isLoadingTypes ? (
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
                  {type.department_id && (
                    <p className="text-xs text-blue-600">
                      Department:{" "}
                      {departments.find((d) => d.id === type.department_id)
                        ?.name || "Unknown"}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {type.fields.map((f) => (
                      <Badge
                        key={f.name}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {f.label} ({f.type}){f.required ? " *" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(type)}
                    title="Edit"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDuplicate(type)}
                    title="Duplicate"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(type.id)}
                    className="text-destructive hover:text-destructive"
                    title="Delete"
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
