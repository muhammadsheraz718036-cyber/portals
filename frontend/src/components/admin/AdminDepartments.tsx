import { useState } from "react";
import { Plus, Edit, Trash2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment } from "@/hooks/services";
import { toast } from "sonner";

interface Department {
  id: string;
  name: string;
}

export function AdminDepartments() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [name, setName] = useState("");

  const { data: departments = [], isLoading: loading } = useDepartments();
  
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const deleteMutation = useDeleteDepartment();

  const openCreate = () => { setEditDept(null); setName(""); setDialogOpen(true); };
  const openEdit = (d: Department) => { setEditDept(d); setName(d.name); setDialogOpen(true); };

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editDept) {
        await updateMutation.mutateAsync({
          id: editDept.id,
          data: { name },
        });
        toast.success("Department updated");
      } else {
        await createMutation.mutateAsync({
          name,
        });
        toast.success("Department created");
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this department?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{departments.length} departments</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Add Department</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editDept ? "Edit" : "Create"} Department</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5"><Label>Department Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
              <Button onClick={handleSave} className="w-full">{editDept ? "Update" : "Create"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map(dept => (
            <Card key={dept.id} className="border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{dept.name}</h3>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(dept)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(dept.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {departments.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No departments yet.</p>}
        </div>
      )}
    </div>
  );
}
