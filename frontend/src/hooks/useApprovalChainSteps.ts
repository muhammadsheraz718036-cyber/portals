import { useState } from "react";

export type ChainStep = {
  step_order: number;
  name: string;
  role: string;
  scope_type: "initiator_department" | "fixed_department" | "static" | "expression";
  scope_value?: string;
  action_label: string;
};

export function useApprovalChainSteps(initialSteps: ChainStep[] = []) {
  const [steps, setSteps] = useState<ChainStep[]>(initialSteps);
  const [draggedStepIdx, setDraggedStepIdx] = useState<number | null>(null);

  const resetSteps = (next: ChainStep[] = []) => {
    setSteps(next);
    setDraggedStepIdx(null);
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        name: "",
        role: "",
        scope_type: "initiator_department",
        scope_value: "",
        action_label: "",
      },
    ]);
  };

  const updateStep = (idx: number, updates: Partial<ChainStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
  };

  const removeStep = (idx: number) => {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_order: i + 1 })),
    );
  };

  const handleDragStartStep = (idx: number) => {
    setDraggedStepIdx(idx);
  };

  const handleDragOverStep = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropStep = (targetIdx: number) => {
    if (draggedStepIdx === null || draggedStepIdx === targetIdx) {
      setDraggedStepIdx(null);
      return;
    }

    setSteps((prev) => {
      const next = [...prev];
      const [draggedItem] = next.splice(draggedStepIdx, 1);
      next.splice(targetIdx, 0, draggedItem);
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });

    setDraggedStepIdx(null);
  };

  return {
    steps,
    draggedStepIdx,
    resetSteps,
    addStep,
    updateStep,
    removeStep,
    handleDragStartStep,
    handleDragOverStep,
    handleDropStep,
  };
}
