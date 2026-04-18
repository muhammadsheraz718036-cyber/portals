import { useState } from "react";
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
  useDepartments,
  useDeleteApprovalChain,
  useRoles,
  useUpdateApprovalChain,
} from "@/hooks/services";
import { useApprovalChainSteps } from "@/hooks/useApprovalChainSteps";
import {
  getScopeLabel,
  getSuggestedWorkflowActionLabel,
  getSuggestedWorkflowStepName,
} from "@/lib/workflowLabels";

type Step = {
  step_order: number;
  name: string;
  role: string;
  scope_type: "initiator_department" | "fixed_department" | "static" | "expression";
  scope_value?: string | null;
  action_label: string;
};

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

function getSuggestedStepName(
  step: Step,
  departments: Array<{ id: string; name: string }>,
): string {
  return getSuggestedWorkflowStepName(
    step.role,
    step.scope_type,
    step.scope_value,
    departments,
  );
}

function getSuggestedActionLabel(
  step: Step,
  departments: Array<{ id: string; name: string }>,
): string {
  return getSuggestedWorkflowActionLabel(
    step.role,
    step.scope_type,
    step.scope_value,
    departments,
  );
}

function getScopeSummary(
  step: Step,
  departments: Array<{ id: string; name: string }>,
): string {
  return getScopeLabel(step.scope_type, step.scope_value, departments);
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
  const { data: departmentsRaw = [], isLoading: loadingDepartments } = useDepartments();
  const createChainMutation = useCreateApprovalChain();
  const updateChainMutation = useUpdateApprovalChain();
  const deleteChainMutation = useDeleteApprovalChain();

  const loading = loadingChains || loadingTypes || loadingRoles || loadingDepartments;
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
  const departments = (departmentsRaw as Array<{ id: string; name: string }>).map((d) => ({
    id: d.id,
    name: d.name,
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
    resetSteps(
      c.steps.map((step) => ({
        step_order: step.step_order,
        name: step.name || "",
        role: step.role || "",
        scope_type: step.scope_type || "initiator_department",
        scope_value: step.scope_value || "",
        action_label: step.action_label || "",
      })),
    );
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !approvalTypeId) return;
    const normalizedSteps = steps.map((step) => ({
      ...step,
      name: step.name.trim() || getSuggestedStepName(step, departments),
      action_label:
        step.action_label.trim() ||
        getSuggestedActionLabel(step, departments),
      scope_value:
        step.scope_type === "fixed_department" || step.scope_type === "expression"
          ? step.scope_value?.trim() || ""
          : "",
    }));
    try {
      if (editChain) {
        await updateChainMutation.mutateAsync({
          id: editChain.id,
          data: {
            name,
            approval_type_id: approvalTypeId,
            steps: normalizedSteps,
          },
        });
      } else {
        await createChainMutation.mutateAsync({
          name,
          approval_type_id: approvalTypeId,
          steps: normalizedSteps,
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
          <DialogContent className="w-[96vw] max-w-6xl max-h-[88vh] overflow-y-auto p-4 sm:p-6">
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
                <p className="text-xs text-muted-foreground">
                  The text fields before and after the selectors are optional.
                  Leave them blank and the app will generate them from the
                  selected role and scope, or type your own wording.
                </p>
                {steps.map((step, idx) => (
                  <div key={idx}>
                    <div
                      draggable
                      onDragStart={() => handleDragStartStep(idx)}
                      onDragOver={handleDragOverStep}
                      onDrop={() => handleDropStep(idx)}
                      className={`rounded border bg-muted/30 p-3 transition-opacity ${
                        draggedStepIdx === idx ? "opacity-50" : ""
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 cursor-move text-muted-foreground" />
                          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
                            {step.step_order}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              Step {step.step_order}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getScopeSummary(step, departments)}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeStep(idx)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
                        <div className="space-y-1 xl:col-span-3">
                          <Label className="text-xs text-muted-foreground">
                            Step title
                          </Label>
                          <Input
                            placeholder={getSuggestedStepName(step, departments)}
                            value={step.name}
                            onChange={(e) =>
                              updateStep(idx, { name: e.target.value })
                            }
                            className="text-sm"
                          />
                        </div>

                        <div className="space-y-1 xl:col-span-3">
                          <Label className="text-xs text-muted-foreground">
                            Role
                          </Label>
                          <Select
                            value={step.role}
                            onValueChange={(v) => updateStep(idx, { role: v })}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Select role..." />
                            </SelectTrigger>
                            <SelectContent>
                              {roles.map((r) => (
                                <SelectItem key={r.id} value={r.name}>
                                  {r.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1 xl:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Scope
                          </Label>
                          <Select
                            value={step.scope_type}
                            onValueChange={(v) =>
                              updateStep(idx, {
                                scope_type: v as Step["scope_type"],
                                scope_value:
                                  v === "fixed_department" || v === "expression"
                                    ? step.scope_value || ""
                                    : "",
                              })
                            }
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Select scope..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="initiator_department">
                                Initiator Department
                              </SelectItem>
                              <SelectItem value="fixed_department">
                                Fixed Department
                              </SelectItem>
                              <SelectItem value="static">Global Static</SelectItem>
                              <SelectItem value="expression">Expression</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {step.scope_type === "fixed_department" ? (
                          <div className="space-y-1 xl:col-span-2">
                            <Label className="text-xs text-muted-foreground">
                              Department
                            </Label>
                            <Select
                              value={step.scope_value || ""}
                              onValueChange={(v) =>
                                updateStep(idx, { scope_value: v })
                              }
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Select department..." />
                              </SelectTrigger>
                              <SelectContent>
                                {departments.map((department) => (
                                  <SelectItem key={department.id} value={department.id}>
                                    {department.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {step.scope_type === "expression" ? (
                          <div className="space-y-1 xl:col-span-2">
                            <Label className="text-xs text-muted-foreground">
                              Expression
                            </Label>
                            <Input
                              placeholder="e.g. request.department_code"
                              value={step.scope_value || ""}
                              onChange={(e) =>
                                updateStep(idx, { scope_value: e.target.value })
                              }
                              className="text-sm"
                            />
                          </div>
                        ) : null}

                        <div className="space-y-1 xl:col-span-4">
                          <Label className="text-xs text-muted-foreground">
                            Action label
                          </Label>
                          <Input
                            placeholder={getSuggestedActionLabel(step, departments)}
                            value={step.action_label}
                            onChange={(e) =>
                              updateStep(idx, { action_label: e.target.value })
                            }
                            className="text-sm"
                          />
                        </div>
                      </div>
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
                          key={step.step_order}
                          className="flex items-center gap-1"
                        >
                          <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">
                            {step.role}
                            <span className="ml-1 font-normal text-muted-foreground">
                              ({getScopeSummary(step, departments)})
                            </span>
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
