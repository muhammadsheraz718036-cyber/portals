import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, GripVertical, Copy, Paperclip } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  useApprovalTypes, 
  useCreateApprovalType, 
  useUpdateApprovalType, 
  useDeleteApprovalType,
  useApprovalTypeAttachments,
  useCreateApprovalTypeAttachment,
  useDeleteApprovalTypeAttachment
} from "@/hooks/services";
import { ApprovalTypeRow } from "@/lib/constants";
import { toast } from "sonner";

type Field = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  group?: string; // Group/section name for organizing fields
};

type AttachmentField = {
  id?: string;
  field_name: string;
  label: string;
  required: boolean;
  max_file_size_mb: number;
  allowed_extensions: string[];
  max_files: number;
};

type PageLayout = "portrait" | "landscape";

interface ApprovalType {
  id: string;
  name: string;
  description: string;
  fields: Field[];
  page_layout?: string;
  pre_salutation?: string;
  post_salutation?: string;
  allow_attachments?: boolean;
}

export function AdminApprovalTypes() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editType, setEditType] = useState<ApprovalType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [pageLayout, setPageLayout] = useState<PageLayout>("portrait");
  const [allowAttachments, setAllowAttachments] = useState(false);
  const [attachmentFields, setAttachmentFields] = useState<AttachmentField[]>([]);
  const [activeTab, setActiveTab] = useState("fields");
  const [draggedFieldIdx, setDraggedFieldIdx] = useState<number | null>(null);
  const [groups, setGroups] = useState<string[]>(["General"]); // Default group
  const [newGroupName, setNewGroupName] = useState("");
  const [preSalutation, setPreSalutation] = useState("");
  const [postSalutation, setPostSalutation] = useState("");

  // React Query hooks
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
    setPreSalutation("");
    setPostSalutation("");
    setActiveTab("fields");
    setDialogOpen(true);
  };
  const openEdit = (t: ApprovalType) => {
    setEditType(t);
    setName(t.name);
    setDescription(t.description);
    setFields(t.fields);
    setPageLayout((t.page_layout as PageLayout) || "portrait");
    setAllowAttachments(t.allow_attachments || false);
    setPreSalutation(t.pre_salutation || "");
    setPostSalutation(t.post_salutation || "");
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

  // Attachment field management
  const addAttachmentField = () => {
    const newField: AttachmentField = {
      field_name: `attachment_${Date.now()}`,
      label: "",
      required: false,
      max_file_size_mb: 10,
      allowed_extensions: ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"],
      max_files: 1,
    };
    setAttachmentFields([...attachmentFields, newField]);
  };

  const updateAttachmentField = (idx: number, updates: Partial<AttachmentField>) => {
    setAttachmentFields(attachmentFields.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  };

  const removeAttachmentField = (idx: number) => {
    setAttachmentFields(attachmentFields.filter((_, i) => i !== idx));
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
        await updateMutation.mutateAsync({
          id: editType.id,
          data: {
            name,
            description,
            fields: cleanFields,
            page_layout: pageLayout,
            pre_salutation: preSalutation || null,
            post_salutation: postSalutation || null,
            allow_attachments: allowAttachments,
          },
        });
        toast.success("Updated");
      } else {
        await createMutation.mutateAsync({
          name,
          description,
          fields: cleanFields,
          page_layout: pageLayout,
          pre_salutation: preSalutation || null,
          post_salutation: postSalutation || null,
          allow_attachments: allowAttachments,
        });
        toast.success("Created");
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
      await createMutation.mutateAsync({
        name: `${type.name} (Copy)`,
        description: type.description,
        fields: type.fields.map((f) => ({ ...f })),
        page_layout: type.page_layout,
        pre_salutation: type.pre_salutation,
        post_salutation: type.post_salutation,
        allow_attachments: type.allow_attachments,
      });
      toast.success("Approval type duplicated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate failed");
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
                      <h3 className="text-lg font-medium">File Attachment Fields</h3>
                      <p className="text-sm text-muted-foreground">
                        Configure which file upload fields users will see when submitting requests
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
                      <p className="text-muted-foreground">Enable file attachments in the Form Fields tab to configure attachment fields</p>
                    </div>
                  ) : attachmentFields.length === 0 ? (
                    <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg">
                      <Paperclip className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-2">No attachment fields configured</p>
                      <p className="text-sm text-muted-foreground">Click "Add Attachment Field" to create your first file upload field</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {attachmentFields.map((field, idx) => (
                        <Card key={idx} className="p-4">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">Attachment Field {idx + 1}</h4>
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
                                  onChange={(e) => updateAttachmentField(idx, { field_name: e.target.value })}
                                  placeholder="e.g., supporting_documents"
                                />
                                <p className="text-xs text-muted-foreground">
                                  Internal field identifier (no spaces, use underscores)
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <Label>Display Label</Label>
                                <Input
                                  value={field.label}
                                  onChange={(e) => updateAttachmentField(idx, { label: e.target.value })}
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
                                  onChange={(e) => updateAttachmentField(idx, { max_file_size_mb: parseInt(e.target.value) || 10 })}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label>Max Files</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={field.max_files}
                                  onChange={(e) => updateAttachmentField(idx, { max_files: parseInt(e.target.value) || 1 })}
                                />
                              </div>

                              <div className="space-y-1.5">
                                <Label>Required</Label>
                                <div className="mt-2">
                                  <CheckboxInput
                                    checked={field.required}
                                    onCheckedChange={(checked) => updateAttachmentField(idx, { required: !!checked })}
                                  />
                                </div>
                              </div>
                            </div>

                              <div className="space-y-1.5">
                                <Label>Allowed Extensions</Label>
                                <div className="grid grid-cols-4 gap-2 mt-2">
                                  {["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"].map((ext) => (
                                    <div key={ext} className="flex items-center space-x-2">
                                      <CheckboxInput
                                        id={`ext-${ext}-${idx}`}
                                        checked={field.allowed_extensions.includes(ext)}
                                        onCheckedChange={(checked) => {
                                          const extensions = checked
                                            ? [...field.allowed_extensions, ext]
                                            : field.allowed_extensions.filter(e => e !== ext);
                                          updateAttachmentField(idx, { allowed_extensions: extensions });
                                        }}
                                      />
                                      <Label htmlFor={`ext-${ext}-${idx}`} className="text-sm">.{ext}</Label>
                                    </div>
                                  ))}
                                </div>
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
                  <Textarea
                    value={preSalutation}
                    onChange={(e) => setPreSalutation(e.target.value)}
                    placeholder="e.g., Dear [Recipient],&#10;&#10;I hope this message finds you well..."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default greeting text that will appear before the form data
                    in approval requests.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Post-Salutation (Optional)</Label>
                  <Textarea
                    value={postSalutation}
                    onChange={(e) => setPostSalutation(e.target.value)}
                    placeholder="e.g., Thank you for your attention to this matter.&#10;&#10;Best regards,&#10;[Your Name]"
                    rows={4}
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
