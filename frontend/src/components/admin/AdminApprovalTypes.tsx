import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, GripVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Field = { name: string; label: string; type: string; required: boolean; repeatable?: boolean; options?: string[] };

interface ApprovalType {
  id: string;
  name: string;
  description: string;
  fields: Field[];
}

export function AdminApprovalTypes() {
  const [types, setTypes] = useState<ApprovalType[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editType, setEditType] = useState<ApprovalType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTypes = async () => {
    try {
      const data = (await api.approvalTypes.list()) as any[];
      setTypes((data || []).map((d) => ({ ...d, fields: d.fields || [] })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => { fetchTypes(); }, []);

  const openCreate = () => { setEditType(null); setName(""); setDescription(""); setFields([]); setDialogOpen(true); };
  const openEdit = (t: ApprovalType) => { setEditType(t); setName(t.name); setDescription(t.description); setFields(t.fields); setDialogOpen(true); };

  const addField = () => setFields([...fields, { name: `field_${Date.now()}`, label: "", type: "text", required: false }]);
  const updateField = (idx: number, updates: Partial<Field>) => setFields(fields.map((f, i) => i === idx ? { ...f, ...updates } : f));
  const removeField = (idx: number) => setFields(fields.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!name.trim()) return;
    const cleanFields = fields.map((f) => ({ ...f, name: f.label.toLowerCase().replace(/\s+/g, "_") }));
    try {
      if (editType) {
        await api.approvalTypes.update(editType.id, { name, description, fields: cleanFields });
        toast.success("Updated");
      } else {
        await api.approvalTypes.create({ name, description, fields: cleanFields });
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
        <p className="text-sm text-muted-foreground">{types.length} approval types</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Add Type</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editType ? "Edit" : "Create"} Approval Type</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Form Fields</Label>
                  <Button variant="outline" size="sm" onClick={addField} className="gap-1"><Plus className="h-3 w-3" /> Add Field</Button>
                </div>
                {fields.map((field, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-3 border rounded bg-muted/30">
                    <GripVertical className="h-4 w-4 text-muted-foreground mt-2 flex-shrink-0" />
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <Input placeholder="Field label" value={field.label} onChange={e => updateField(idx, { label: e.target.value })} className="text-sm" />
                      <Select value={field.type} onValueChange={v => updateField(idx, { type: v })}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="textarea">Textarea</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="select">Select</SelectItem>
                        </SelectContent>
                      </Select>
                      {field.type === "select" && (
                        <Input className="col-span-2 text-sm" placeholder="Options (comma separated)" value={field.options?.join(", ") || ""} onChange={e => updateField(idx, { options: e.target.value.split(",").map(s => s.trim()) })} />
                      )}
                      <div className="col-span-2 flex gap-4">
                        <label className="flex items-center gap-1.5">
                          <Checkbox checked={field.required} onCheckedChange={c => updateField(idx, { required: !!c })} />
                          <span className="text-xs text-muted-foreground">Required</span>
                        </label>
                        <label className="flex items-center gap-1.5">
                          <Checkbox checked={field.repeatable ?? false} onCheckedChange={c => updateField(idx, { repeatable: !!c })} />
                          <span className="text-xs text-muted-foreground">Repeatable (Line Items)</span>
                        </label>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeField(idx)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                {fields.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No fields added yet.</p>}
              </div>
              <Button onClick={handleSave} className="w-full">{editType ? "Update" : "Create"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
      ) : (
        <div className="grid gap-3">
          {types.map(type => (
            <Card key={type.id} className="border">
              <CardContent className="p-4 flex items-start justify-between">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold">{type.name}</h3>
                  <p className="text-xs text-muted-foreground">{type.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {type.fields.map(f => (
                      <Badge key={f.name} variant="outline" className="text-[10px]">
                        {f.label} ({f.type})
                        {f.required ? " *" : ""}
                        {f.repeatable ? " [Line Items]" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(type)}><Edit className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(type.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {types.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No approval types yet.</p>}
        </div>
      )}
    </div>
  );
}
