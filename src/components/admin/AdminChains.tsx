import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, ArrowDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Step = { order: number; roleName: string; action: string };

interface ApprovalType { id: string; name: string; }
interface Role { id: string; name: string; }
interface Chain { id: string; name: string; approval_type_id: string; steps: Step[]; }

export function AdminChains() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [approvalTypes, setApprovalTypes] = useState<ApprovalType[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editChain, setEditChain] = useState<Chain | null>(null);
  const [name, setName] = useState("");
  const [approvalTypeId, setApprovalTypeId] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [chainsRaw, typesRaw, rolesRaw] = await Promise.all([
        api.approvalChains.list() as Promise<any[]>,
        api.approvalTypes.list() as Promise<any[]>,
        api.roles.list() as Promise<any[]>,
      ]);
      setChains((chainsRaw || []).map((c) => ({ ...c, steps: c.steps || [] })));
      setApprovalTypes((typesRaw || []).map((t) => ({ id: t.id, name: t.name })));
      setRoles((rolesRaw || []).map((r) => ({ id: r.id, name: r.name })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => { setEditChain(null); setName(""); setApprovalTypeId(""); setSteps([]); setDialogOpen(true); };
  const openEdit = (c: Chain) => { setEditChain(c); setName(c.name); setApprovalTypeId(c.approval_type_id); setSteps(c.steps); setDialogOpen(true); };

  const addStep = () => setSteps([...steps, { order: steps.length + 1, roleName: "", action: "" }]);
  const updateStep = (idx: number, updates: Partial<Step>) => setSteps(steps.map((s, i) => i === idx ? { ...s, ...updates } : s));
  const removeStep = (idx: number) => setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));

  const handleSave = async () => {
    if (!name.trim() || !approvalTypeId) return;
    try {
      if (editChain) {
        await api.approvalChains.update(editChain.id, {
          name,
          approval_type_id: approvalTypeId,
          steps,
        });
        toast.success("Chain updated");
      } else {
        await api.approvalChains.create({ name, approval_type_id: approvalTypeId, steps });
        toast.success("Chain created");
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.approvalChains.delete(id);
      toast.success("Deleted");
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{chains.length} approval chains</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Add Chain</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editChain ? "Edit" : "Create"} Approval Chain</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5"><Label>Chain Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Approval Type</Label>
                <Select value={approvalTypeId} onValueChange={setApprovalTypeId}>
                  <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                  <SelectContent>
                    {approvalTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Steps</Label>
                  <Button variant="outline" size="sm" onClick={addStep} className="gap-1"><Plus className="h-3 w-3" /> Add Step</Button>
                </div>
                {steps.map((step, idx) => (
                  <div key={idx}>
                    <div className="flex items-center gap-2 p-3 border rounded bg-muted/30">
                      <div className="h-6 w-6 rounded bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">{step.order}</div>
                      <Select value={step.roleName} onValueChange={v => updateStep(idx, { roleName: v })}>
                        <SelectTrigger className="flex-1 text-sm"><SelectValue placeholder="Role..." /></SelectTrigger>
                        <SelectContent>
                          {roles.map(r => <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Action" value={step.action} onChange={e => updateStep(idx, { action: e.target.value })} className="flex-1 text-sm" />
                      <Button variant="ghost" size="sm" onClick={() => removeStep(idx)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {idx < steps.length - 1 && <div className="flex justify-center py-1"><ArrowDown className="h-4 w-4 text-muted-foreground" /></div>}
                  </div>
                ))}
              </div>
              <Button onClick={handleSave} className="w-full">{editChain ? "Update" : "Create"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
      ) : (
        <div className="grid gap-3">
          {chains.map(chain => {
            const typeName = approvalTypes.find(t => t.id === chain.approval_type_id)?.name || "Unknown";
            return (
              <Card key={chain.id} className="border">
                <CardContent className="p-4 flex items-start justify-between">
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold">{chain.name}</h3>
                      <p className="text-xs text-muted-foreground">For: {typeName}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {chain.steps.map((step, idx) => (
                        <span key={step.order} className="flex items-center gap-1">
                          <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">{step.roleName}</span>
                          {idx < chain.steps.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(chain)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(chain.id)} className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {chains.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No chains yet.</p>}
        </div>
      )}
    </div>
  );
}
