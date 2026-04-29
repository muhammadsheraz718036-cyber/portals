import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import {
  ArrowLeft,
  Printer,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  SkipForward,
  RefreshCw,
  Loader2,
  Edit2,
  Download,
  Trash2,
  Paperclip,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { useCompany } from "@/contexts/company-hooks";
import { useAuth } from "@/contexts/auth-hooks";
import {
  useApprovalRequest,
  useProfile,
  useApproveRequest,
  useRejectRequest,
  useAssignWorkRequest,
  useUpdateWorkStatusRequest,
  useUpdateApprovalRequest,
  useDeleteApprovalRequest,
  useResolveRequestNumber,
  useRequestAttachments,
  useDownloadAttachment,
  usePreviewAttachment,
  useDeleteRequestAttachment,
  useWorkAssignees,
} from "@/hooks/services";
import { toast } from "sonner";
import type { ApprovalFormField } from "@/lib/constants";
import { buildSingleEntryItems, type LineItem } from "@/lib/lineItems";
import type { RequestAttachment, WorkAssigneeOption } from "@/services/types";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { formatExistingActionLabel } from "@/lib/workflowLabels";
import { cn } from "@/lib/utils";
import {
  fieldGridClass,
  formatFormValue,
  inputTypeForField,
  isFieldRequired,
  isFieldVisible,
} from "@/lib/formSchema";

const actionIcons: Record<string, React.ReactNode> = {
  Approved: <CheckCircle className="h-5 w-5 text-success" />,
  Rejected: <XCircle className="h-5 w-5 text-destructive" />,
  Pending: <Clock className="h-5 w-5 text-warning" />,
  Waiting: <AlertCircle className="h-5 w-5 text-muted-foreground" />,
  Skipped: <SkipForward className="h-5 w-5 text-muted-foreground" />,
  Edited: <Edit2 className="h-5 w-5 text-primary" />,
  ChangesRequested: <AlertCircle className="h-5 w-5 text-warning" />,
  Resubmitted: <RefreshCw className="h-5 w-5 text-primary" />,
};

type PreviewFile = {
  fileName: string;
  blob: Blob;
};

function iconKeyForAction(status: string): keyof typeof actionIcons {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
      return "Pending";
    case "skipped":
      return "Skipped";
    case "edited":
      return "Edited";
    case "changes_requested":
      return "ChangesRequested";
    case "resubmitted":
      return "Resubmitted";
    default:
      return "Waiting";
  }
}

const getActionLabel = (action: ActionRow) => {
  switch (action.status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "edited":
      return "Edited";
    case "changes_requested":
      return "Changes Requested";
    case "resubmitted":
      return "Resubmitted";
    case "skipped":
      return "Skipped";
    case "pending":
      return "Pending Approval";
    case "waiting":
      return "Waiting";
    default:
      return "Waiting";
  }
};

const timelineStatusStyles: Record<string, string> = {
  approved:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  rejected:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
  edited:
    "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/30 dark:text-cyan-300",
  changes_requested:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300",
  pending:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300",
  waiting:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  skipped:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
  resubmitted:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300",
};

function formatTimelineComment(comment: string): string[] {
  return comment
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getActionTime(action: ActionRow): number {
  return new Date(action.acted_at ?? action.created_at).getTime();
}

function getTimelineRoleTitle(action: ActionRow): string {
  const formattedActionLabel = formatExistingActionLabel(
    action.role_name,
    action.action_label,
  );
  const trimmedRole = action.role_name.trim();

  if (trimmedRole.toLowerCase() === "department manager") {
    const managerMatch = formattedActionLabel.match(/^(.+?)\s+Manager approval$/i);
    if (managerMatch?.[1]) {
      return `${managerMatch[1].trim()} Manager`;
    }
  }

  if (trimmedRole.toLowerCase() === "initiator") {
    return "Initiator";
  }

  return trimmedRole || "Approval Step";
}

function getTimelineActionSummary(action: ActionRow): string {
  const actor = action.acted_by ? "by" : "";
  switch (action.status) {
    case "approved":
      return actor ? "Approved by" : "Approved";
    case "rejected":
      return actor ? "Rejected by" : "Rejected";
    case "edited":
      return actor ? "Edited by" : "Edited";
    case "changes_requested":
      return actor ? "Changes requested by" : "Changes requested";
    case "resubmitted":
      return actor ? "Resubmitted by" : "Resubmitted";
    case "pending":
      return "Awaiting approval from";
    case "waiting":
      return "Queued after previous step";
    case "skipped":
      return "Skipped";
    default:
      return getActionLabel(action);
  }
}

type RequestRow = {
  id: string;
  request_number: string;
  status: string;
  work_status: "pending" | "assigned" | "in_progress" | "done" | "not_done";
  current_step: number;
  total_steps: number;
  created_at: string;
  form_data: Record<string, unknown>;
  initiator_id: string;
  department_id: string | null;
  work_assignee_id: string | null;
  work_assigned_at: string | null;
  work_completed_by: string | null;
  work_completed_at: string | null;
  final_authority_user_id: string | null;
  initiator?: { full_name: string; signature_url?: string | null };
  work_assignee?: {
    id: string | null;
    full_name: string | null;
    email?: string | null;
  } | null;
  work_completed_by_profile?: {
    id: string | null;
    full_name: string | null;
  } | null;
  approval_types: {
    name: string;
    description: string | null;
    fields: unknown;
    page_layout?: string;
    allow_attachments: boolean;
  } | null;
  departments: { name: string } | null;
};

type ActionRow = {
  id: string;
  step_order: number;
  role_name: string;
  action_label: string;
  status: string;
  acted_by: string | null;
  acted_at: string | null;
  comment: string | null;
  approver_user_id: string | null;
  created_at: string;
};

type ActorProfile = {
  full_name: string;
  signature_url: string | null;
  department_name: string | null;
};

/** Ensure line items have stable `id` for LineItemsManager (API JSON may omit or use numbers). */
function normalizeItemsForEdit(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it, idx) => {
    const row = it as Record<string, unknown>;
    const id =
      row.id != null && String(row.id).trim() !== ""
        ? String(row.id)
        : `item-${idx}`;
    return { ...row, id } as LineItem;
  });
}

function normalizeItemsForGroups(
  raw: unknown,
  fields: ApprovalFormField[],
): LineItem[] {
  return buildSingleEntryItems(fields, normalizeItemsForEdit(raw));
}

function getGroupRenderOrder(fields: ApprovalFormField[]) {
  return Array.from(new Set(fields.map((field) => field.group || "General")));
}

function formatFieldDisplayValue(field: ApprovalFormField | null, rawValue: unknown): string {
  return formatFormValue(field, rawValue).replace("—", "-");
}

function formatWorkStatus(status: string | null | undefined): string {
  const normalized = status === "not_done" ? "pending" : status || "pending";
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isRichTextEmpty(value: string): boolean {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim()
    .length === 0;
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [actioning, setActioning] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updateComment, setUpdateComment] = useState("");
  const [rejectionComment, setRejectionComment] = useState("");
  const [workCompletionComment, setWorkCompletionComment] = useState("");
  const [showWorkAssignmentDialog, setShowWorkAssignmentDialog] = useState(false);
  const [showWorkStatusDialog, setShowWorkStatusDialog] = useState(false);
  const [selectedWorkStatus, setSelectedWorkStatus] = useState<
    "pending" | "assigned" | "in_progress" | "done"
  >("assigned");
  const [selectedWorkAssigneeId, setSelectedWorkAssigneeId] = useState("");
  const [workAssigneeOpen, setWorkAssigneeOpen] = useState(false);
  const [showLetterPreview, setShowLetterPreview] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] =
    useState<RequestAttachment | null>(null);
  const [showDeleteRequestConfirm, setShowDeleteRequestConfirm] =
    useState(false);
  const [updatingFormData, setUpdatingFormData] = useState<
    Record<string, unknown>
  >({});
  const printLetterRef = useRef<HTMLDivElement>(null);

  const resolveMutation = useResolveRequestNumber();
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const assignWorkMutation = useAssignWorkRequest();
  const updateWorkStatusMutation = useUpdateWorkStatusRequest();
  const updateRequestMutation = useUpdateApprovalRequest();
  const deleteRequestMutation = useDeleteApprovalRequest();

  const {
    data: requestData,
    isLoading: loading,
    error: notFound,
  } = useApprovalRequest(id || "");
  
  const downloadMutation = useDownloadAttachment();
  const previewMutation = usePreviewAttachment();
  const deleteMutation = useDeleteRequestAttachment();

  const request = requestData?.request as RequestRow | undefined;
  const { data: workAssignees = [] } = useWorkAssignees(null);
  const actions = useMemo(
    () => (requestData?.actions ?? []) as ActionRow[],
    [requestData?.actions],
  );
  const actorNames = requestData?.actorNames ?? {};
  const actorProfiles = (requestData?.actorProfiles ?? {}) as Record<
    string,
    ActorProfile
  >;
  const approvedSignatureActions = useMemo(
    () =>
      actions.filter(
        (action) => action.status === "approved" && Boolean(action.acted_by),
      ),
    [actions],
  );

  // Only fetch attachments if the request type supports them
  const supportsAttachments =
    request?.approval_types?.allow_attachments === true;

  const { data: attachments = [] } = useRequestAttachments(
    supportsAttachments && id ? id : "",
  );
  const selectedWorkAssignee = useMemo(
    () =>
      workAssignees.find(
        (assignee: WorkAssigneeOption) => assignee.id === selectedWorkAssigneeId,
      ) ?? null,
    [selectedWorkAssigneeId, workAssignees],
  );

  const { data: initiatorProfile } = useProfile(request?.initiator_id || "");
  const requestId = request?.id;
  const workAssigneeId = request?.work_assignee_id;
  const workStatus = request?.work_status;
  const approvalTypeFields = request?.approval_types?.fields;

  const [initiatorName, setInitiatorName] = useState("");
  const [initiatorRole, setInitiatorRole] = useState("");
  const [initiatorDepartment, setInitiatorDepartment] = useState("");

  useEffect(() => {
    if (request?.initiator?.full_name) {
      setInitiatorName(request.initiator.full_name);
    }
    if (initiatorProfile?.role_name) {
      setInitiatorRole(initiatorProfile.role_name);
    }
    if (initiatorProfile?.department_name) {
      setInitiatorDepartment(initiatorProfile.department_name);
    }
  }, [request, initiatorProfile]);

  useEffect(() => {
    if (workStatus) {
      setSelectedWorkStatus(
        workStatus === "not_done" ? "pending" : workStatus,
      );
    } else {
      setSelectedWorkStatus("assigned");
    }
  }, [requestId, workStatus]);

  useEffect(() => {
    if (!requestId) {
      setSelectedWorkAssigneeId("");
      return;
    }

    setSelectedWorkAssigneeId(workAssigneeId ?? workAssignees[0]?.id ?? "");
  }, [requestId, workAssigneeId, workAssignees]);

  const { settings } = useCompany();
  const companyName = settings?.company_name || "ApprovalHub";
  const pageLayout = request?.approval_types?.page_layout || "portrait";
  const isLandscape = pageLayout !== "portrait";
  // Standard US Letter size
  const pageWidth = isLandscape ? "11in" : "8.5in";
  const pageHeight = isLandscape ? "8.5in" : "11in";
  const pageSize = isLandscape ? "11in 8.5in" : "8.5in 11in";

  const timelineSteps = useMemo(() => {
    const displayGroups = new Map<number, ActionRow[]>();

    for (const action of actions) {
      if (action.status === "skipped") continue;

      let displayStepOrder = action.step_order;
      if (action.status === "resubmitted") {
        const relatedChangeRequest = actions
          .filter(
            (candidate) =>
              candidate.status === "changes_requested" &&
              getActionTime(candidate) <= getActionTime(action),
          )
          .sort((a, b) => getActionTime(b) - getActionTime(a))[0];

        if (relatedChangeRequest) {
          displayStepOrder = relatedChangeRequest.step_order;
        }
      }

      const existing = displayGroups.get(displayStepOrder) ?? [];
      existing.push(action);
      displayGroups.set(displayStepOrder, existing);
    }

    return Array.from(displayGroups.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepOrder, grouped]) => {
        const events = [...grouped].sort((a, b) => getActionTime(a) - getActionTime(b));
        const active = events.find(
          (event) => event.status === "pending" || event.status === "waiting",
        );
        const primary =
          active ??
          [...events]
            .reverse()
            .find((event) => event.status !== "resubmitted") ??
          events[events.length - 1];
        const history = events.filter((event) => event.id !== primary.id);

        return {
          stepOrder,
          primary,
          history,
        };
      });
  }, [actions]);

  const handlePrint = useReactToPrint({
    contentRef: printLetterRef,
    documentTitle: request?.request_number
      ? `Request_${request.request_number}`
      : "Request_Letter",
    pageStyle: `
      @page {
        size: ${pageSize};
        margin: 0;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        min-height: 100% !important;
      }
      #print-letter {
        display: block !important;
        width: ${pageWidth} !important;
        min-height: ${pageHeight} !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        overflow: visible !important;
      }
      #print-letter > div {
        width: 100% !important;
        min-height: ${pageHeight} !important;
        height: auto !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        overflow: visible !important;
        display: flex !important;
        flex-direction: column !important;
      }
      #print-letter .relative {
        height: auto !important;
        min-height: 0 !important;
        flex: 1 !important;
      }
      #print-letter table,
      #print-letter tr,
      #print-letter img,
      #print-letter .grid > div {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      #print-letter table { width: 100% !important; table-layout: auto !important; }
      #print-letter table td { word-break: break-word !important; }
      #print-letter table th {
        white-space: normal !important;
        word-break: normal !important;
        overflow-wrap: normal !important;
        hyphens: manual !important;
      }
      .no-print { display: none !important; }
      * {
        -webkit-print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    `,
  });

  const handleApprove = async () => {
    if (!request) return;
    setActioning(true);
    try {
      await approveMutation.mutateAsync({
        id: request.id,
        data: { comment: "" },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve request");
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!request) return;
    const trimmedComment = rejectionComment.trim();
    if (!trimmedComment) {
      toast.error("Enter a rejection reason before rejecting the request.");
      return;
    }

    setActioning(true);
    try {
      await rejectMutation.mutateAsync({
        id: request.id,
        data: { comment: trimmedComment },
      });
      setRejectionComment("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject request");
    } finally {
      setActioning(false);
    }
  };

  const hasAdminLikeWorkAccess =
    profile?.is_admin ||
    profile?.permissions?.includes("all") ||
    profile?.permissions?.includes("manage_approvals");
  const isWorkDone =
    request?.work_status === "done" || Boolean(request?.work_completed_at);

  const canCompleteApprovedWork =
    !!request &&
    request.status === "approved" &&
    !!user &&
    (hasAdminLikeWorkAccess ||
      (!isWorkDone && request.work_assignee_id === user.id));

  const canAssignApprovedWork =
    !!request &&
    request.status === "approved" &&
    !!user &&
    (hasAdminLikeWorkAccess ||
      (!isWorkDone && request.final_authority_user_id === user.id));

  const handleAssignWork = async () => {
    if (!request || !selectedWorkAssigneeId) return;
    setActioning(true);
    try {
      await assignWorkMutation.mutateAsync({
        id: request.id,
        assigneeId: selectedWorkAssigneeId,
      });
      setShowWorkAssignmentDialog(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign work");
    } finally {
      setActioning(false);
    }
  };

  const handleUpdateWorkStatus = async () => {
    if (!request) return;
    setActioning(true);
    try {
      await updateWorkStatusMutation.mutateAsync({
        id: request.id,
        data: {
          status: selectedWorkStatus,
          comment: isRichTextEmpty(workCompletionComment)
            ? undefined
            : workCompletionComment.trim(),
        },
      });
      setWorkCompletionComment("");
      setShowWorkStatusDialog(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update work status",
      );
    } finally {
      setActioning(false);
    }
  };

  const handleUpdateRequest = async () => {
    if (!request) return;
    setActioning(true);
    try {
      const isAdmin = profile?.is_admin || false;
      const canEditAsApprover = canApprove();

      if (!isAdmin && !canEditAsApprover) {
        throw new Error(
          "Only an admin or the assigned approver can update this request",
        );
      }

      await updateRequestMutation.mutateAsync({
        id: request.id,
        data: {
          form_data: updatingFormData,
          comment: updateComment.trim() || undefined,
        },
      });
      setShowUpdateForm(false);
      setUpdatingFormData({});
      setUpdateComment("");
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === "Only an admin or the assigned approver can update this request"
      ) {
        toast.error(e.message);
      }
    } finally {
      setActioning(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDownloadFile = async (attachment: RequestAttachment) => {
    try {
      const blob = await downloadMutation.mutateAsync(attachment.id);
      downloadBlob(blob, attachment.original_filename);
      toast.success(`Downloaded ${attachment.original_filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to download file");
    }
  };

  const handlePreviewFile = async (attachment: RequestAttachment) => {
    try {
      const blob = await previewMutation.mutateAsync(attachment.id);
      setPreviewFile({
        fileName: attachment.original_filename,
        blob,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load preview");
    }
  };

  const confirmDeleteFile = async () => {
    if (!attachmentToDelete) return;
    try {
      await deleteMutation.mutateAsync(attachmentToDelete.id);
      setAttachmentToDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete attachment");
    }
  };

  const canDeleteFiles = () => {
    // Only initiator can delete files, and only if request is pending/in_progress
    if (!request || !user) return false;
    return (
      request.initiator_id === user.id &&
      (request.status === "pending" || request.status === "in_progress")
    );
  };

  const canDeleteRequest = () => {
    if (!request || !user || !profile) return false;
    if (request.status === "approved" || request.status === "rejected") {
      return false;
    }

    if (profile.is_admin) return true;

    return (
      profile.permissions?.includes("delete_initiated_requests") ||
      profile.permissions?.includes("all")
    );
  };

  const handleDeleteRequest = async () => {
    if (!request) return;
    setActioning(true);
    try {
      await deleteRequestMutation.mutateAsync(request.id);
      navigate("/approvals");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete request");
    } finally {
      setActioning(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Mirror backend `findActionableStep`: only the concrete assignee for the
  // lowest pending step may act. Shared-role peers must not see action buttons.
  const canApprove = () => {
    if (
      !request ||
      !user ||
      !profile ||
      !["in_progress", "pending"].includes(request.status)
    ) {
      return false;
    }

    // Initiator can never approve their own request.
    if (request.initiator_id === user.id) {
      return false;
    }

    const pendingActions = actions
      .filter((a) => a.status === "pending")
      .sort((a, b) => a.step_order - b.step_order);

    if (pendingActions.length === 0) {
      return false;
    }
    const lowestPendingOrder = pendingActions[0].step_order;
    const activeActions = pendingActions.filter(
      (a) => a.step_order === lowestPendingOrder,
    );

    return activeActions.some((a) => {
      if (a.acted_by === user.id) return false;
      if (profile.is_admin) return true;
      return a.approver_user_id === user.id;
    });
  };

  const shouldShowButtons =
    request &&
    ["in_progress", "pending"].includes(request.status) &&
    canApprove() &&
    !showUpdateForm;
  const canEditRequest =
    !!request &&
    !!user &&
    request.status !== "approved" &&
    request.status !== "rejected" &&
    (
      profile?.is_admin ||
      canApprove()
    );

  // All fields are now repeatable (line items).
  // Keep this memoized to avoid retriggering effects from new array references.
  const repeatableFields: ApprovalFormField[] = useMemo(
    () =>
      Array.isArray(approvalTypeFields)
        ? (approvalTypeFields as ApprovalFormField[])
        : [],
    [approvalTypeFields],
  );
  const repeatableGroupOrder = useMemo(
    () => getGroupRenderOrder(repeatableFields),
    [repeatableFields],
  );
  const editableItems = useMemo(
    () => normalizeItemsForGroups(updatingFormData.items, repeatableFields),
    [updatingFormData.items, repeatableFields],
  );

  // Initialize form data when entering update mode (line items live under form_data.items)
  useEffect(() => {
    if (!showUpdateForm || !request?.form_data) {
      return;
    }
    const fd = { ...(request.form_data as Record<string, unknown>) };
    fd.items = normalizeItemsForGroups(fd.items, repeatableFields);
    setUpdatingFormData((prev) =>
      JSON.stringify(prev) === JSON.stringify(fd) ? prev : fd,
    );
  }, [showUpdateForm, request?.form_data, repeatableFields]);

  useEffect(() => {
    if (showUpdateForm) {
      return;
    }
    setUpdatingFormData((prev) => (Object.keys(prev).length > 0 ? {} : prev));
    setUpdateComment((prev) => (prev ? "" : prev));
  }, [showUpdateForm]);

  const formData = useMemo(
    () => (request?.form_data as Record<string, unknown>) ?? {},
    [request?.form_data],
  );
  const items = useMemo(
    () => (Array.isArray(formData.items) ? formData.items : []),
    [formData.items],
  );
  const richContent =
    typeof formData.content === "string" ? formData.content : null;
  const preComments =
    typeof formData.pre_comments === "string" ? formData.pre_comments : "";
  const postComments =
    typeof formData.post_comments === "string" ? formData.post_comments : "";
  const safeRichContent = richContent ? sanitizeHtml(richContent) : "";
  const safePreComments = preComments ? sanitizeHtml(preComments) : "";
  const safePostComments = postComments ? sanitizeHtml(postComments) : "";
  const formEntries = Object.entries(formData).filter(
    ([key]) =>
      key !== "items" &&
      key !== "content" &&
      key !== "pre_comments" &&
      key !== "post_comments",
  );
  const displayId = request?.request_number ?? "";
  const normalizedItems = useMemo(
    () => normalizeItemsForGroups(items, repeatableFields),
    [items, repeatableFields],
  );

  const setFormValue = (fieldName: string, value: unknown) => {
    setUpdatingFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const renderEditableField = (
    field: ApprovalFormField,
    value: unknown,
    onChange: (value: unknown) => void,
    keyPrefix: string,
  ) => {
    const stringValue = value == null ? "" : String(value);

    if (field.type === "textarea") {
      return (
        <Textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || field.label}
          minLength={field.min_length}
          maxLength={field.max_length}
          rows={3}
        />
      );
    }

    if (field.type === "select" && field.options) {
      return (
        <select
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Select {field.label}</option>
          {field.options.map((option) => (
            <option key={`${keyPrefix}-${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "multiselect" && field.options) {
      return (
        <select
          multiple
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={(e) =>
            onChange(Array.from(e.target.selectedOptions).map((option) => option.value))
          }
          className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {field.options.map((option) => (
            <option key={`${keyPrefix}-${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={stringValue === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
          />
          <span>{field.label}</span>
        </label>
      );
    }

    if ((field.type === "radio" && field.options) || field.type === "yes_no") {
      const options = field.type === "yes_no" ? ["yes", "no"] : field.options ?? [];
      return (
        <div className="flex flex-wrap gap-3 rounded-md border border-border px-3 py-2">
          {options.map((option) => (
            <label key={`${keyPrefix}-${option}`} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${keyPrefix}-${field.name}`}
                value={option}
                checked={stringValue === option}
                onChange={(e) => onChange(e.target.value)}
              />
              <span>{field.type === "yes_no" ? option.toUpperCase() : option}</span>
            </label>
          ))}
        </div>
      );
    }

    return (
      <input
        type={inputTypeForField(field)}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        min={field.min}
        max={field.max}
        minLength={field.min_length}
        maxLength={field.max_length}
        pattern={field.pattern}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder={field.placeholder || field.label}
      />
    );
  };
  const letterContent = (
    <div
      className="relative w-full"
      style={{
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        height: "auto",
        width: "100%",
        padding: "0.5in",
        boxSizing: "border-box",
        overflow: "visible",
      }}
    >
      <div className="relative z-10 flex-1 flex flex-col">
        <div className="text-center border-b-2 border-foreground pb-2">
          {settings?.logo_url && (
            <img
              src={settings.logo_url}
              alt="Logo"
              className="h-20 mx-auto mb-1 object-contain"
            />
          )}
          <h2
            className="font-bold tracking-wide"
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: "20px",
            }}
          >
            {companyName.toUpperCase()}
          </h2>
          <p>{request?.approval_types?.name ?? "—"}</p>
        </div>
        <div className="flex justify-between mt-2" style={{ fontSize: "14px" }}>
          <div>
            <p>
              <strong>Request ID:</strong> {displayId}
            </p>
            <p>
              <strong>Status:</strong>{" "}
              {request?.status.replace("_", " ").toUpperCase()}
            </p>
          </div>
          <div className="text-right">
            <p>
              <strong>Date:</strong>{" "}
              {request ? new Date(request.created_at).toLocaleDateString() : "—"}
            </p>
          </div>
        </div>
        {richContent ? (
          <div
            className="my-3 prose max-w-none [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:bg-muted [&_th]:font-semibold"
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: "14px",
            }}
            dangerouslySetInnerHTML={{
              __html: safeRichContent,
            }}
          />
        ) : (
          <div className="my-4">
            <>
              {preComments && (
                <div
                  style={{
                    fontSize: "14px",
                    fontFamily: "Arial, sans-serif",
                    marginBottom: "0.625rem",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: safePreComments,
                  }}
                />
              )}
              {repeatableFields.length > 0 && (
                <div className="space-y-4">
                  {repeatableGroupOrder.map((group) => {
                      const groupFields = repeatableFields.filter(
                        (f) =>
                          (f.group || "General") === group &&
                          !f.print_hidden &&
                          isFieldVisible(f, formData, group),
                      );
                      const groupItems = normalizedItems.filter(
                        (item: LineItem) =>
                          String(item.__group || "General") === group,
                      );

                      if (groupFields.length === 0) return null;

                      return (
                        <div key={group}>
                          <h3 className="text-xs font-semibold">
                            {group}
                          </h3>
                          {groupItems.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              No entries for this group.
                            </p>
                          ) : (
                            <table
                              className="w-full border-collapse"
                              style={{ fontSize: "12px" }}
                            >
                              <thead>
                                <tr>
                                  {groupFields.map((field) => (
                                    <th
                                      key={`${group}-${field.name}-header`}
                                      className="border text-xs border-foreground bg-muted font-semibold text-center"
                                    >
                                      {field.print_label || field.label || field.name}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {groupItems.map((item: LineItem, idx: number) => (
                                  <tr key={idx}>
                                    {groupFields.map((field) => (
                                      <td
                                        key={`${idx}-${field.name}`}
                                        className="border border-foreground p-2 text-center"
                                      >
                                        {formatFormValue(field, item[field.name])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
              {postComments && (
                <div
                  style={{
                    fontSize: "14px",
                    fontFamily: "Arial, sans-serif",
                    marginTop: "1rem",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: safePostComments,
                  }}
                />
              )}
            </>
          </div>
        )}
        <div className="flex justify-start">
          <div className="text-left w-full max-w-[210px]">
            {request?.initiator?.signature_url && (
              <img
                src={request.initiator.signature_url}
                alt={`${initiatorName || "Initiator"} signature`}
                className="mb-0 block h-14 max-w-[180px] object-contain"
              />
            )}
            <p className="font-bold" style={{ fontSize: "14px" }}>
              {initiatorName}
            </p>
            <p className="text-muted-foreground" style={{ fontSize: "13px" }}>
              {initiatorRole || "No Role Assigned"}
            </p>
            <p className="text-muted-foreground" style={{ fontSize: "13px" }}>
              {initiatorDepartment || ""}
            </p>
            <p className="text-muted-foreground" style={{ fontSize: "13px" }}>
              {companyName ?? ""}
            </p>
          </div>
        </div>
        {approvedSignatureActions.length > 0 && (
          <div className="mt-2">
            <p
              className="font-bold"
              style={{
                fontSize: "13px",
                fontFamily: "Arial, sans-serif",
                marginBottom: "0.25rem",
              }}
            >
              Approved By
            </p>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              {approvedSignatureActions.map((action) => {
                const actorId = action.acted_by as string;
                const actorProfile = actorProfiles[actorId];
                const actorName =
                  actorProfile?.full_name ??
                  actorNames[actorId] ??
                  "Unknown approver";

                return (
                  <div
                    key={`print-signature-${action.id}`}
                    className="min-h-[76px]"
                  >
                    {actorProfile?.signature_url ? (
                      <img
                        src={actorProfile.signature_url}
                        alt={`${actorName} signature`}
                        className="mb-0 block h-12 max-w-[160px] object-contain"
                      />
                    ) : (
                      <div className="mb-0 h-12" />
                    )}
                    <div className="border-t border-foreground/70 pt-0.5">
                      <p className="font-bold" style={{ fontSize: "13px" }}>
                        {actorName}
                      </p>
                      <p
                        className="text-muted-foreground"
                        style={{ fontSize: "11px" }}
                      >
                        {getTimelineRoleTitle(action)}
                      </p>
                      {actorProfile?.department_name && (
                        <p
                          className="text-muted-foreground"
                          style={{ fontSize: "11px" }}
                        >
                          {actorProfile.department_name}
                        </p>
                      )}
                      <p
                        className="text-muted-foreground"
                        style={{ fontSize: "11px" }}
                      >
                        Approved{" "}
                        {new Date(
                          action.acted_at ?? action.created_at,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !request) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Request not found.</p>
        <Button
          variant="ghost"
          onClick={() => navigate("/approvals")}
          className="mt-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Approvals
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 no-print">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/approvals")}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">{displayId}</h1>
                <StatusBadge status={request.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                Review request details, timeline, and work completion.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {request.status === "approved" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWorkAssignmentDialog(true)}
                  disabled={actioning || !canAssignApprovedWork}
                  className="gap-2"
                  title={
                    canAssignApprovedWork
                      ? undefined
                      : isWorkDone
                        ? "Completed work assignments can only be changed by an admin"
                        : "Only the final approving authority or an admin can update the work assignment"
                  }
                >
                  <Edit2 className="h-4 w-4" />
                  Update Work Assignment
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowWorkStatusDialog(true)}
                  disabled={actioning || !canCompleteApprovedWork}
                  className="gap-2"
                  title={
                    canCompleteApprovedWork
                      ? undefined
                      : isWorkDone
                        ? "Completed work status can only be changed by an admin"
                        : "Only the assigned worker or an admin can update the work status"
                  }
                >
                  <Edit2 className="h-4 w-4" />
                  Update Work Status
                </Button>
              </>
            )}
            {canDeleteRequest() && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteRequestConfirm(true)}
                className="gap-2"
                disabled={actioning}
              >
                {actioning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete Request
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer className="h-4 w-4" /> Print Letter
            </Button>
          </div>
        </div>

      <div
        className="print-only"
        id="print-letter"
        ref={printLetterRef}
        style={{
          display: "none",
          width: pageWidth,
          minHeight: pageHeight,
          boxSizing: "border-box",
        }}
      >
        {letterContent}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-6">
          <Card className="no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Type</p>
                  <p className="font-medium">{request.approval_types?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Initiator</p>
                  <p className="font-medium">{initiatorName || "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Department</p>
                  <p className="font-medium">{initiatorDepartment ?? "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Work Assignee</p>
                  <p className="font-medium">
                    {request.work_assignee?.full_name || "Not assigned"}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Work Status</p>
                  <p className="font-medium">
                    {request.work_completed_at
                      ? `Completed ${new Date(request.work_completed_at).toLocaleDateString()}`
                      : request.status === "approved"
                        ? formatWorkStatus(request.work_status || "assigned")
                        : "Pending approval"}
                  </p>
                </div>
              </div>

              {formEntries.length > 0 && (
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                      General
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {formEntries.map(([key, value]) => {
                      const pseudoField: ApprovalFormField = {
                        name: key,
                        label: key.replace(/_/g, " "),
                        type: "text",
                        required: false,
                      };

                      return (
                        <div
                          key={key}
                          className="space-y-2 rounded-lg border bg-muted/10 p-3"
                        >
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            {pseudoField.label}
                          </p>
                          {showUpdateForm ? (
                            renderEditableField(
                              pseudoField,
                              updatingFormData[key],
                              (nextValue) => setFormValue(key, nextValue),
                              `top-${key}`,
                            )
                          ) : (
                            <p className="text-sm font-medium text-foreground">
                              {formatFieldDisplayValue(null, value)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {repeatableFields.length > 0 && (
                <div className="space-y-5">
                  <div className="space-y-5">
                    {repeatableGroupOrder.map((group) => {
                      const groupFields = repeatableFields.filter(
                        (field) =>
                          (field.group || "General") === group &&
                          isFieldVisible(
                            field,
                            showUpdateForm ? updatingFormData : formData,
                            group,
                          ),
                      );
                      const groupItems = (showUpdateForm ? editableItems : normalizedItems).filter(
                        (item) => String(item.__group || "General") === group,
                      );
                      const groupItem = groupItems[0];

                      if (groupFields.length === 0) {
                        return null;
                      }

                      return (
                        <div
                          key={group}
                          className="rounded-xl border bg-card p-4 shadow-sm"
                        >
                          <div className="mb-4 flex items-center gap-3">
                            <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                              {group}
                            </span>
                            <div className="h-px flex-1 bg-border" />
                          </div>

                          {!groupItem ? (
                            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                              No values available for this section.
                            </div>
                          ) : (
                            <div className="grid gap-4 sm:grid-cols-2">
                              {groupFields.map((field) => (
                                <div
                                  key={`${group}-${field.name}-mapped`}
                                  className={`space-y-2 rounded-lg border bg-muted/10 p-3 ${fieldGridClass(field)}`}
                                >
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    {field.label || field.name}
                                    {showUpdateForm &&
                                      isFieldRequired(field, updatingFormData, group) && (
                                        <span className="ml-1 text-destructive">*</span>
                                      )}
                                  </p>
                                  {showUpdateForm ? (
                                    renderEditableField(
                                      field,
                                      groupItem[field.name],
                                      (nextValue) => {
                                        setUpdatingFormData((prev) => ({
                                          ...prev,
                                          items: editableItems.map((item) =>
                                            item.id === groupItem.id
                                              ? { ...item, [field.name]: nextValue }
                                              : item,
                                          ),
                                        }));
                                      },
                                      `${group}-${field.name}`,
                                    )
                                  ) : (
                                    <p className="text-sm font-medium text-foreground">
                                      {formatFieldDisplayValue(field, groupItem[field.name])}
                                    </p>
                                  )}
                                  {field.help_text && showUpdateForm && (
                                    <p className="text-xs text-muted-foreground">
                                      {field.help_text}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {showUpdateForm && (
                <div className="space-y-6 rounded-xl border bg-card p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
                      Edit Request
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Pre-Salutation (Optional)
                    </label>
                    <RichTextEditor
                      key={`inline-pre-comments-${showUpdateForm ? "open" : "closed"}`}
                      content={
                        typeof updatingFormData.pre_comments === "string"
                          ? updatingFormData.pre_comments
                          : ""
                      }
                      onChange={(html) => setFormValue("pre_comments", html)}
                      placeholder="Add a greeting before the request details..."
                    />
                  </div>

                  {typeof updatingFormData.content === "string" && (
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Letter Body
                      </label>
                      <RichTextEditor
                        key={`inline-letter-body-${showUpdateForm ? "open" : "closed"}`}
                        content={updatingFormData.content}
                        onChange={(html) => setFormValue("content", html)}
                        placeholder="Letter content…"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Post-Comments (Optional)
                    </label>
                    <RichTextEditor
                      key={`inline-post-comments-${showUpdateForm ? "open" : "closed"}`}
                      content={
                        typeof updatingFormData.post_comments === "string"
                          ? updatingFormData.post_comments
                          : ""
                      }
                      onChange={(html) => setFormValue("post_comments", html)}
                      placeholder="Add any closing comments..."
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Edit note (optional)
                    </label>
                    <Textarea
                      placeholder="Explain what you changed. This will appear in the timeline."
                      value={updateComment}
                      onChange={(e) => setUpdateComment(e.target.value)}
                      rows={4}
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setShowUpdateForm(false)}
                      disabled={actioning}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleUpdateRequest} disabled={actioning}>
                      {actioning ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Save Changes
                    </Button>
                  </div>
                </div>
              )}
              
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      Letter Preview
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Open the formatted request letter in a dialog so the page
                      stays compact and easier to scan.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setShowLetterPreview(true)}
                  >
                    <Eye className="h-4 w-4" />
                    Open Preview
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {attachments.length > 0 && (
            <Card className="no-print">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  File Attachments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                            <Paperclip className="h-4 w-4 text-blue-600" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {attachment.original_filename}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatFileSize(attachment.file_size_bytes)}</span>
                            <span>•</span>
                            <span>{attachment.field_label || attachment.field_name}</span>
                            <span>•</span>
                            <span>
                              {new Date(attachment.created_at!).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreviewFile(attachment)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadFile(attachment)}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {canDeleteFiles() && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAttachmentToDelete(attachment)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="no-print xl:sticky xl:top-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Approval Flow</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {timelineSteps.map(({ stepOrder, primary, history }, idx) => {
                  const iconKey = iconKeyForAction(primary.status);
                  const roleTitle = getTimelineRoleTitle(primary);
                  const actionSummary = getTimelineActionSummary(primary);

                  return (
                    <div
                      key={`${stepOrder}-${primary.id}`}
                      className="flex gap-3"
                    >
                      <div className="flex flex-col items-center">
                        <div className="flex-shrink-0">
                          {actionIcons[iconKey] || actionIcons.Waiting}
                        </div>
                        {idx < timelineSteps.length - 1 && (
                          <div className="w-px h-full min-h-[40px] bg-border my-1" />
                        )}
                      </div>
                      <div className="pb-6 flex-1">
                        <div className="rounded-xl border bg-card/80 p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-foreground">
                                  Step {stepOrder}
                                </p>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                    timelineStatusStyles[primary.status] ??
                                    timelineStatusStyles.waiting
                                  }`}
                                >
                                  {getActionLabel(primary)}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-foreground">
                                {roleTitle}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {primary.acted_by && (
                              <span>
                                <span className="font-medium text-foreground">
                                  {actorNames[primary.acted_by] ?? "Unknown approver"}
                                </span>{" "}
                                <span>{actionSummary.toLowerCase().replace(/\s+by$/, "")}</span>
                              </span>
                            )}
                            {!primary.acted_by && (
                              <span>{actionSummary}</span>
                            )}
                            {primary.acted_at && (
                              <span>{new Date(primary.acted_at).toLocaleString()}</span>
                            )}
                            {request &&
                              stepOrder === request.current_step &&
                              ["pending", "waiting"].includes(primary.status) &&
                              canApprove() && (
                                <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-medium text-primary">
                                  Your turn
                                </span>
                              )}
                            {request &&
                              stepOrder === request.current_step &&
                              ["pending", "waiting"].includes(primary.status) &&
                              !canApprove() && (
                                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                                  Current step
                                </span>
                              )}
                          </div>
                          {primary.comment && (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Notes
                              </p>
                              <div className="mt-2 space-y-2 text-sm leading-6 text-foreground">
                                {formatTimelineComment(primary.comment).map((line, lineIdx) => (
                                  <p key={`${primary.id}-comment-${lineIdx}`}>{line}</p>
                                ))}
                              </div>
                            </div>
                          )}

                          {history.length > 0 && (
                            <div className="mt-4 border-t pt-4">
                              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Step Activity
                              </p>
                              <div className="space-y-2">
                                {history.map((historyAction) => (
                                  <div
                                    key={historyAction.id}
                                    className="rounded-lg border border-border/60 bg-background/70 p-3"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                          timelineStatusStyles[historyAction.status] ??
                                          timelineStatusStyles.waiting
                                        }`}
                                      >
                                        {getActionLabel(historyAction)}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground">
                                        {new Date(
                                          historyAction.acted_at ?? historyAction.created_at,
                                        ).toLocaleString()}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      {historyAction.acted_by
                                        ? `${getTimelineActionSummary(historyAction)} ${actorNames[historyAction.acted_by] ?? "Unknown approver"}`
                                        : getTimelineActionSummary(historyAction)}
                                    </p>
                                    {historyAction.comment && (
                                      <div className="mt-2 rounded-md bg-slate-50/80 px-3 py-2 dark:bg-slate-900/40">
                                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                          Note
                                        </p>
                                        <div className="space-y-1.5 text-xs leading-5 text-foreground">
                                          {formatTimelineComment(historyAction.comment).map(
                                            (line, lineIdx) => (
                                              <p
                                                key={`${historyAction.id}-history-comment-${lineIdx}`}
                                              >
                                                {line}
                                              </p>
                                            ),
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {actions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No timeline steps yet.
                  </p>
                )}
              </div>

              {shouldShowButtons && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <Button
                    onClick={handleApprove}
                    disabled={actioning}
                    className="w-full gap-2"
                    size="sm"
                  >
                    {actioning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}{" "}
                    Approve
                  </Button>
                  <div className="space-y-1.5">
                    <Textarea
                      value={rejectionComment}
                      onChange={(event) => setRejectionComment(event.target.value)}
                      placeholder="Required: explain why this request is being rejected"
                      rows={4}
                      disabled={actioning}
                    />
                    <p className="text-xs text-muted-foreground">
                      This reason will be saved in the timeline and sent to the initiator.
                    </p>
                  </div>
                  <Button
                    onClick={handleReject}
                    disabled={actioning || rejectionComment.trim().length === 0}
                    variant="destructive"
                    className="w-full gap-2"
                    size="sm"
                  >
                    {actioning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}{" "}
                    Reject
                  </Button>
                  <Button
                    onClick={() => setShowUpdateForm(true)}
                    disabled={actioning}
                    variant="outline"
                    className="w-full gap-2"
                    size="sm"
                  >
                    {actioning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Edit2 className="h-4 w-4" />
                    )}{" "}
                    Edit Request
                  </Button>
                </div>
              )}

              {canEditRequest && !shouldShowButtons && !showUpdateForm && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <Button
                    onClick={() => setShowUpdateForm(true)}
                    disabled={actioning}
                    variant="outline"
                    className="w-full gap-2"
                    size="sm"
                  >
                    {actioning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Edit2 className="h-4 w-4" />
                    )}{" "}
                    Edit Request
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={showWorkAssignmentDialog}
        onOpenChange={setShowWorkAssignmentDialog}
      >
        <DialogContent className="w-[95vw] max-w-xl">
          <DialogHeader>
            <DialogTitle>Update Work Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Assigned To
              </p>
              <Popover open={workAssigneeOpen} onOpenChange={setWorkAssigneeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={workAssigneeOpen}
                    disabled={actioning || workAssignees.length === 0}
                    className="w-full justify-between font-normal"
                  >
                    {selectedWorkAssignee
                      ? selectedWorkAssignee.full_name
                      : "Select work assignee"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(32rem,calc(100vw-3rem))] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by name, role, or department..." />
                    <CommandList>
                      <CommandEmpty>No matching assignee found.</CommandEmpty>
                      <CommandGroup>
                        {workAssignees.map((assignee: WorkAssigneeOption) => {
                          const departmentSummary =
                            assignee.department_names?.length
                              ? assignee.department_names.join(", ")
                              : assignee.department_name || "No department";
                          const roleSummary = assignee.role_names?.length
                            ? assignee.role_names.join(", ")
                            : "No role";

                          return (
                            <CommandItem
                              key={assignee.id}
                              value={`${assignee.full_name} ${assignee.email} ${departmentSummary} ${roleSummary}`}
                              onSelect={() => {
                                setSelectedWorkAssigneeId(assignee.id);
                                setWorkAssigneeOpen(false);
                              }}
                              className="items-start"
                            >
                              <Check
                                className={cn(
                                  "mr-2 mt-0.5 h-4 w-4 shrink-0",
                                  selectedWorkAssigneeId === assignee.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate">{assignee.full_name}</span>
                                <span className="truncate text-xs text-muted-foreground">
                                  {roleSummary} | {departmentSummary}
                                </span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowWorkAssignmentDialog(false)}
                disabled={actioning}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleAssignWork}
                disabled={actioning || !selectedWorkAssigneeId}
                className="gap-2"
              >
                {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update Assignment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showWorkStatusDialog} onOpenChange={setShowWorkStatusDialog}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Update Work Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Work Status
              </p>
              <Select
                value={selectedWorkStatus}
                onValueChange={(value) =>
                  setSelectedWorkStatus(
                    value as "pending" | "assigned" | "in_progress" | "done",
                  )
                }
                disabled={actioning}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select work status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Comment
              </p>
              <RichTextEditor
                content={workCompletionComment}
                onChange={setWorkCompletionComment}
                placeholder="Optional note for the initiator"
              />
              <p className="text-xs text-muted-foreground">
                The initiator will receive this note by email when you update the work status.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowWorkStatusDialog(false)}
                disabled={actioning}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUpdateWorkStatus}
                disabled={actioning || !canCompleteApprovedWork}
                className="gap-2"
              >
                {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Update Work Status
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLetterPreview} onOpenChange={setShowLetterPreview}>
        <DialogContent className="w-[96vw] max-w-6xl max-h-[92vh] overflow-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Letter Preview</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded-lg border bg-muted/20 p-3 sm:p-6">
            <div
              className="bg-card border rounded shadow-sm mx-auto"
              style={{
                width: pageWidth,
                minHeight: pageHeight,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {letterContent}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!attachmentToDelete}
        title="Delete attachment?"
        description={
          attachmentToDelete
            ? `This will permanently delete ${attachmentToDelete.original_filename}.`
            : ""
        }
        confirmLabel="Delete Attachment"
        destructive
        onOpenChange={(open) => {
          if (!open) setAttachmentToDelete(null);
        }}
        onConfirm={confirmDeleteFile}
      />
      <ConfirmDialog
        open={showDeleteRequestConfirm}
        title="Delete request?"
        description={
          request
            ? `This will permanently delete request ${request.request_number}. This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete Request"
        destructive
        onOpenChange={setShowDeleteRequestConfirm}
        onConfirm={handleDeleteRequest}
      />
      <FilePreviewDialog
        open={!!previewFile}
        fileName={previewFile?.fileName ?? ""}
        blob={previewFile?.blob ?? null}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
        onDownload={
          previewFile
            ? () => downloadBlob(previewFile.blob, previewFile.fileName)
            : undefined
        }
      />
      </div>
    </div>
  );
}
