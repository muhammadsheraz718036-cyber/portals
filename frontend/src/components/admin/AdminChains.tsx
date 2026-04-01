import { useState, useEffect } from "react";
import {
  Plus,
  Edit,
  Trash2,
  ArrowDown,
  GripVertical,
  Copy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChainRow, ApprovalTypeRow } from "@/lib/constants";
import {
  useApprovalChains,
  useApprovalTypes,
  useCreateApprovalChain,
  useDeleteApprovalChain,
  useRoles,
  useUpdateApprovalChain,
} from "@/hooks/services";
import { useApprovalChainSteps } from "@/hooks/useApprovalChainSteps";

type Step = { order: number; roleName: string; action: string };

interface ApprovalType {
  id: string;
  name: string;
}
interface RoleOption {
  id: string;
  name: string;
}
interface Chain {
  id: string;
  name: string;
  approval_type_id: string;
  steps: Step[];
}

export function AdminChains() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editChain, setEditChain] = useState<Chain | null>(null);
  const [name, setName] = useState("");
  const [approvalTypeId, setApprovalTypeId] = useState("");
  const {
    steps,
    draggedStepIdx,
    resetSteps,
    addStep,
    updateStep,
    removeStep,
    handleDragStartStep,
    handleDragOverStep,
    handleDropStep,
  } = useApprovalChainSteps();
  const { data: chainsRaw = [], isLoading: loadingChains } = useApprovalChains();
  const { data: approvalTypesRaw = [], isLoading: loadingTypes } = useApprovalTypes();
  const { data: rolesRaw = [], isLoading: loadingRoles } = useRoles();
  const createChainMutation = useCreateApprovalChain();
  const updateChainMutation = useUpdateApprovalChain();
  const deleteChainMutation = useDeleteApprovalChain();

  const loading = loadingChains || loadingTypes || loadingRoles;
  const chains: Chain[] = (chainsRaw as ChainRow[]).map((c) => ({
    ...c,
    steps: c.steps || [],
  }));
  const approvalTypes: ApprovalType[] = (approvalTypesRaw as ApprovalTypeRow[]).map((t) => ({
    id: t.id,
    name: t.name,
  }));
  const roles: RoleOption[] = (rolesRaw as RoleOption[]).map((r) => ({
    id: r.id,
    name: r.name,
  }));

  const openCreate = () => {
    setEditChain(null);
    setName("");
    setApprovalTypeId("");
    resetSteps([]);
    setDialogOpen(true);
  };
  const openEdit = (c: Chain) => {
    setEditChain(c);
    setName(c.name);
    setApprovalTypeId(c.approval_type_id);
    resetSteps(c.steps);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !approvalTypeId) return;
    try {
      if (editChain) {
        await updateChainMutation.mutateAsync({
          id: editChain.id,
          data: {
            name,
            approval_type_id: approvalTypeId,
            steps,
          },
        });
      } else {
        await createChainMutation.mutateAsync({
          name,
          approval_type_id: approvalTypeId,
          steps,
        });
      }
      setDialogOpen(false);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteChainMutation.mutateAsync(id);
    } catch {}
  };

  const handleDuplicate = async (chain: Chain) => {
    try {
      await createChainMutation.mutateAsync({
        name: `${chain.name} (Copy)`,
        approval_type_id: chain.approval_type_id,
        steps: chain.steps.map((s) => ({ ...s })),
      });
    } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {chains.length} approval chains
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Chain
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editChain ? "Edit" : "Create"} Approval Chain
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label>Chain Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Approval Type</Label>
                <Select
                  value={approvalTypeId}
                  onValueChange={setApprovalTypeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {approvalTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Steps</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addStep}
                    className="gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Step
                  </Button>
                </div>
                {steps.map((step, idx) => (
                  <div key={idx}>
                    <div
                      draggable
                      onDragStart={() => handleDragStartStep(idx)}
                      onDragOver={handleDragOverStep}
                      onDrop={() => handleDropStep(idx)}
                      className={`flex items-center gap-2 p-3 border rounded bg-muted/30 cursor-move transition-opacity ${
                        draggedStepIdx === idx ? "opacity-50" : ""
                      }`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="h-6 w-6 rounded bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {step.order}
                      </div>
                      <Select
                        value={step.roleName}
                        onValueChange={(v) => updateStep(idx, { roleName: v })}
                      >
                        <SelectTrigger className="flex-1 text-sm">
                          <SelectValue placeholder="Role..." />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.name}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Action"
                        value={step.action}
                        onChange={(e) =>
                          updateStep(idx, { action: e.target.value })
                        }
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStep(idx)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {idx < steps.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Button onClick={handleSave} className="w-full">
                {editChain ? "Update" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Loading...
        </p>
      ) : (
        <div className="grid gap-3">
          {chains.map((chain) => {
            const typeName =
              approvalTypes.find((t) => t.id === chain.approval_type_id)
                ?.name || "Unknown";
            return (
              <Card key={chain.id} className="border">
                <CardContent className="p-4 flex items-start justify-between">
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold">{chain.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        For: {typeName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {chain.steps.map((step, idx) => (
                        <span
                          key={step.order}
                          className="flex items-center gap-1"
                        >
                          <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">
                            {step.roleName}
                          </span>
                          {idx < chain.steps.length - 1 && (
                            <span className="text-muted-foreground text-xs">
                              →
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(chain)}
                      title="Edit"
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDuplicate(chain)}
                      title="Duplicate"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(chain.id)}
                      className="text-destructive hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {chains.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No chains yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
