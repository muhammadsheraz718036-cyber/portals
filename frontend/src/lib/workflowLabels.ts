type StepScopeType =
  | "initiator_department"
  | "fixed_department"
  | "static"
  | "expression";

function toManagerLabel(scopeLabel: string): string {
  return `${scopeLabel} Manager`;
}

export function getScopeLabel(
  scopeType: StepScopeType,
  scopeValue: string | null | undefined,
  departments?: Array<{ id: string; name: string }>,
): string {
  switch (scopeType) {
    case "initiator_department":
      return "Initiator Department";
    case "fixed_department":
      return (
        departments?.find((department) => department.id === scopeValue)?.name ||
        scopeValue ||
        "Fixed Department"
      );
    case "expression":
      return scopeValue?.trim() || "Expression";
    case "static":
    default:
      return "Global";
  }
}

export function getSuggestedWorkflowStepName(
  role: string,
  scopeType: StepScopeType,
  scopeValue: string | null | undefined,
  departments?: Array<{ id: string; name: string }>,
): string {
  const roleLabel = role.trim() || "Approval Step";
  const scopeLabel = getScopeLabel(scopeType, scopeValue, departments);

  if (roleLabel.toLowerCase() === "department manager") {
    if (scopeType === "fixed_department") {
      return toManagerLabel(scopeLabel);
    }
    if (scopeType === "initiator_department") {
      return "Department Manager";
    }
  }

  return `${roleLabel} - ${scopeLabel}`;
}

export function getSuggestedWorkflowActionLabel(
  role: string,
  scopeType: StepScopeType,
  scopeValue: string | null | undefined,
  departments?: Array<{ id: string; name: string }>,
): string {
  const roleLabel = role.trim() || "Approver";
  const scopeLabel = getScopeLabel(scopeType, scopeValue, departments);

  if (roleLabel.toLowerCase() === "department manager") {
    if (scopeType === "fixed_department") {
      return `${toManagerLabel(scopeLabel)} approval`;
    }
    if (scopeType === "initiator_department") {
      return "Department Manager approval";
    }
  }

  return `${roleLabel} approval for ${scopeLabel}`;
}

export function formatExistingActionLabel(
  roleName: string,
  actionLabel: string | null | undefined,
): string {
  const trimmedLabel = actionLabel?.trim();
  const trimmedRole = roleName.trim();

  if (!trimmedLabel) return trimmedRole;

  if (trimmedRole.toLowerCase() === "department manager") {
    const match = trimmedLabel.match(
      /^department manager approval for (.+)$/i,
    );
    if (match?.[1]) {
      return `${match[1].trim()} Manager approval`;
    }
  }

  return trimmedLabel;
}
