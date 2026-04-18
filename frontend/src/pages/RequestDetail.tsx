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
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useCompany } from "@/contexts/company-hooks";
import { useAuth } from "@/contexts/auth-hooks";
import {
  useApprovalRequest,
  useProfile,
  useApproveRequest,
  useRejectRequest,
  useRequestChanges,
  useUpdateApprovalRequest,
  useDeleteApprovalRequest,
  useResolveRequestNumber,
  useRequestAttachments,
  useDownloadAttachment,
  useDeleteRequestAttachment,
} from "@/hooks/services";
import { toast } from "sonner";
import type { ApprovalFormField } from "@/lib/constants";
import { LineItemsManager, type LineItem } from "@/components/LineItemsManager";
import type { RequestAttachment } from "@/services/types";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { formatExistingActionLabel } from "@/lib/workflowLabels";

const actionIcons: Record<string, React.ReactNode> = {
  Approved: <CheckCircle className="h-5 w-5 text-success" />,
  Rejected: <XCircle className="h-5 w-5 text-destructive" />,
  Pending: <Clock className="h-5 w-5 text-warning" />,
  Waiting: <AlertCircle className="h-5 w-5 text-muted-foreground" />,
  Skipped: <SkipForward className="h-5 w-5 text-muted-foreground" />,
  ChangesRequested: <AlertCircle className="h-5 w-5 text-warning" />,
  Resubmitted: <RefreshCw className="h-5 w-5 text-primary" />,
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
  current_step: number;
  total_steps: number;
  created_at: string;
  form_data: Record<string, unknown>;
  initiator_id: string;
  department_id: string | null;
  initiator?: { full_name: string };
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

function getGroupRenderOrder(fields: ApprovalFormField[]) {
  return Array.from(new Set(fields.map((field) => field.group || "General")));
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [actioning, setActioning] = useState(false);
  const [showRequestChangesDialog, setShowRequestChangesDialog] =
    useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [showLetterPreview, setShowLetterPreview] = useState(false);
  const [updatingFormData, setUpdatingFormData] = useState<
    Record<string, unknown>
  >({});
  const printLetterRef = useRef<HTMLDivElement>(null);

  const resolveMutation = useResolveRequestNumber();
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const requestChangesMutation = useRequestChanges();
  const updateRequestMutation = useUpdateApprovalRequest();
  const deleteRequestMutation = useDeleteApprovalRequest();

  const {
    data: requestData,
    isLoading: loading,
    error: notFound,
  } = useApprovalRequest(id || "");
  
  const downloadMutation = useDownloadAttachment();
  const deleteMutation = useDeleteRequestAttachment();

  const request = requestData?.request as RequestRow | undefined;
  const actions = useMemo(
    () => (requestData?.actions ?? []) as ActionRow[],
    [requestData?.actions],
  );
  const actorNames = requestData?.actorNames ?? {};

  // Only fetch attachments if the request type supports them
  const supportsAttachments =
    request?.approval_types?.allow_attachments === true;

  const { data: attachments = [] } = useRequestAttachments(
    supportsAttachments && id ? id : "",
  );

  const { data: initiatorProfile } = useProfile(request?.initiator_id || "");

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
        size: ${isLandscape ? "landscape" : "portrait"};
        margin: 0;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }
      #print-letter {
        display: block !important;
        width: ${pageWidth} !important;
        height: ${pageHeight} !important;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        page-break-inside: avoid !important;
        page-break-before: avoid !important;
        page-break-after: avoid !important;
      }
      #print-letter > div {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 1in !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }
      #print-letter .relative {
        height: auto !important;
        min-height: auto !important;
        flex: 1 !important;
        page-break-inside: avoid !important;
      }
      #print-letter * {
        page-break-inside: avoid !important;
        page-break-before: avoid !important;
        page-break-after: avoid !important;
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
      toast.success("Request approved successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve request");
    } finally {
      setActioning(false);
    }
  };

  const handleReject = async () => {
    if (!request) return;
    setActioning(true);
    try {
      await rejectMutation.mutateAsync({
        id: request.id,
        data: { comment: "" },
      });
      toast.success("Request rejected successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reject request");
    } finally {
      setActioning(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!request) return;
    setActioning(true);
    try {
      await requestChangesMutation.mutateAsync({
        id: request.id,
        data: { comment: changesComment },
      });
      setShowRequestChangesDialog(false);
      setChangesComment("");
      toast.success("Changes requested. The request has been sent back to the initiator for updates.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to request changes");
    } finally {
      setActioning(false);
    }
  };

  const handleUpdateRequest = async () => {
    if (!request) return;
    setActioning(true);
    try {
      // Check if user is the request initiator or an admin
      const isInitiator = user?.id === request.initiator_id;
      const isAdmin = profile?.is_admin || false;

      if (!isInitiator && !isAdmin) {
        throw new Error(
          "Only the request initiator or an admin can update this request",
        );
      }

      await updateRequestMutation.mutateAsync({
        id: request.id,
        data: { form_data: updatingFormData },
      });
      setShowUpdateForm(false);
      setUpdatingFormData({});
      toast.success("Request updated and resubmitted successfully. It is now active for approval again.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update request");
    } finally {
      setActioning(false);
    }
  };

  const handleDownloadFile = async (attachment: RequestAttachment) => {
    try {
      const blob = await downloadMutation.mutateAsync(attachment.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.original_filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(`Downloaded ${attachment.original_filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to download file");
    }
  };

  const handleDeleteFile = async (attachment: RequestAttachment) => {
    if (
      !confirm(
        `Are you sure you want to delete ${attachment.original_filename}?`,
      )
    ) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(attachment.id);
      toast.success(`Deleted ${attachment.original_filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete file");
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
      request.initiator_id === user.id &&
      (profile.permissions?.includes("delete_initiated_requests") ||
        profile.permissions?.includes("all"))
    );
  };

  const handleDeleteRequest = async () => {
    if (!request) return;
    if (
      !confirm(
        `Are you sure you want to delete request ${request.request_number}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setActioning(true);
    try {
      await deleteRequestMutation.mutateAsync(request.id);
      navigate("/approvals");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete request");
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
    canApprove();
  const shouldShowUpdateButton =
    request &&
    request.status === "changes_requested" &&
    user &&
    request.initiator_id === user.id;

  // Initialize form data when entering update mode (line items live under form_data.items)
  useEffect(() => {
    if (showUpdateForm && request?.form_data) {
      const fd = { ...(request.form_data as Record<string, unknown>) };
      fd.items = normalizeItemsForEdit(fd.items);
      setUpdatingFormData(fd);
    } else if (!showUpdateForm) {
      setUpdatingFormData({});
    }
  }, [showUpdateForm, request?.form_data]);

  const fields: ApprovalFormField[] = Array.isArray(
    request?.approval_types?.fields,
  )
    ? (request!.approval_types!.fields as unknown as ApprovalFormField[])
    : [];

  // All fields are now repeatable (line items)
  const repeatableFields = fields;
  const repeatableGroupOrder = useMemo(
    () => getGroupRenderOrder(repeatableFields),
    [repeatableFields],
  );

  const formData = (request?.form_data as Record<string, unknown>) ?? {};
  const items = Array.isArray(formData.items) ? formData.items : [];
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
    () => normalizeItemsForEdit(items),
    [items],
  );
  const letterContent = (
    <div
      className="relative w-full"
      style={{
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        height: "100%",
        width: "100%",
        padding: "0.5in",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.06] rotate-[-35deg]">
        <span
          className="font-bold tracking-widest whitespace-nowrap select-none"
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: "6rem",
          }}
        >
          {user?.email}
        </span>
      </div>
      <div className="relative z-10 flex-1 flex flex-col">
        <div className="text-center border-b-2 border-foreground pb-3">
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
        <div className="flex justify-between mt-4" style={{ fontSize: "14px" }}>
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
          <div className="relative">
            {request?.status === "changes_requested" && (
              <div className="absolute inset-0 bg-muted/10 backdrop-blur-[0.5px] z-10 flex items-center justify-center">
                <div className="bg-background/95 border border-border rounded-lg p-6 shadow-lg text-center">
                  <p className="font-semibold text-foreground text-lg">
                    Changes Requested
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    The request has been sent back for revisions. Please update
                    the form data and resubmit.
                  </p>
                </div>
              </div>
            )}
            <div
              className={
                request?.status === "changes_requested"
                  ? "opacity-75 pointer-events-none"
                  : ""
              }
            >
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
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {request?.status === "changes_requested" ? (
              <div className="relative">
                <div className="absolute inset-0 bg-muted/10 backdrop-blur-[0.5px] z-10 flex items-center justify-center">
                  <div className="bg-background/95 border border-border rounded-lg p-6 shadow-lg text-center">
                    <p className="font-semibold text-foreground text-lg">
                      Changes Requested
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">
                      The request has been sent back for revisions. Please
                      update the form data and resubmit.
                    </p>
                  </div>
                </div>
                <div className="opacity-75 pointer-events-none">
                  {preComments && (
                    <div
                      style={{
                        fontSize: "14px",
                        fontFamily: "Arial, sans-serif",
                      }}
                      dangerouslySetInnerHTML={{
                        __html: safePreComments,
                      }}
                    />
                  )}
                  {repeatableFields.length > 0 && (
                    <div className="space-y-6 my-4">
                      {repeatableGroupOrder.map((group) => {
                          const groupFields = repeatableFields.filter(
                            (f) => (f.group || "General") === group,
                          );
                          const groupItems = items.filter(
                            (item: LineItem) =>
                              String(item.__group || "General") === group,
                          );

                          if (groupFields.length === 0) return null;

                          return (
                            <div key={group} className="p-3">
                              <h3 className="text-sm font-semibold mb-2">
                                {group}
                              </h3>
                              {groupItems.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-2">
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
                                          className="border border-foreground p-2 bg-muted font-semibold text-center"
                                        >
                                          {field.label || field.name}
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
                                            {item[field.name] ?? "—"}
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
                </div>
              </div>
            ) : (
              <>
                {preComments && (
                  <div
                    style={{
                      fontSize: "14px",
                      fontFamily: "Arial, sans-serif",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: safePreComments,
                    }}
                  />
                )}
                {repeatableFields.length > 0 && (
                  <div className="space-y-6 my-4">
                    {repeatableGroupOrder.map((group) => {
                        const groupFields = repeatableFields.filter(
                          (f) => (f.group || "General") === group,
                        );
                        const groupItems = items.filter(
                          (item: LineItem) =>
                            String(item.__group || "General") === group,
                        );

                        if (groupFields.length === 0) return null;

                        return (
                          <div key={group} className="p-3">
                            <h3 className="text-sm font-semibold mb-2">
                              {group}
                            </h3>
                            {groupItems.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-2">
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
                                        className="border border-foreground p-2 bg-muted font-semibold text-center"
                                      >
                                        {field.label || field.name}
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
                                          {item[field.name] ?? "—"}
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
            )}
          </div>
        )}
        <div className="mt-12 flex justify-start">
          <div className="text-left w-full max-w-[210px]">
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/approvals")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-foreground">{displayId}</h1>
          <StatusBadge status={request.status} />
        </div>
        <div className="flex items-center gap-2">
          {canDeleteRequest() && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteRequest}
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
          height: pageHeight,
          boxSizing: "border-box",
        }}
      >
        {letterContent}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <div className="space-y-6">
          <Card className="border no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Type
                  </p>
                  <p className="font-medium">{request.approval_types?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Initiator
                  </p>
                  <p className="font-medium">{initiatorName || "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Department
                  </p>
                  <p className="font-medium">{initiatorDepartment ?? "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Date
                  </p>
                  <p className="font-medium">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {formEntries.length > 0 && (
                <div className="rounded-xl border p-4">
                  <p className="mb-3 text-sm font-semibold text-foreground">
                    Captured Fields
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {formEntries.map(([key, value]) => (
                      <div key={key}>
                        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {String(value || "—")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {repeatableFields.length > 0 && (
                <div className="rounded-xl border p-4">
                  <p className="mb-4 text-sm font-semibold text-foreground">
                    Submitted Entries
                  </p>
                  <div className="space-y-5">
                    {repeatableGroupOrder.map((group) => {
                      const groupFields = repeatableFields.filter(
                        (field) => (field.group || "General") === group,
                      );
                      const groupItems = normalizedItems.filter(
                        (item) => String(item.__group || "General") === group,
                      );

                      if (groupFields.length === 0) {
                        return null;
                      }

                      return (
                        <div key={group} className="space-y-3">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              {group}
                            </h3>
                          </div>

                          {groupItems.length === 0 ? (
                            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                              No entries submitted for this section.
                            </div>
                          ) : (
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b bg-muted/30">
                                    {groupFields.map((field) => (
                                      <th
                                        key={`${group}-${field.name}-submitted`}
                                        className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                      >
                                        {field.label || field.name}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {groupItems.map((item, itemIndex) => (
                                    <tr key={item.id || `${group}-${itemIndex}`}>
                                      {groupFields.map((field) => {
                                        const rawValue = item[field.name];
                                        let displayValue: string;

                                        if (field.type === "checkbox") {
                                          displayValue =
                                            rawValue === "true" ? "Yes" : "-";
                                        } else if (
                                          rawValue === undefined ||
                                          rawValue === null ||
                                          String(rawValue).trim() === ""
                                        ) {
                                          displayValue = "-";
                                        } else {
                                          displayValue = String(rawValue);
                                        }

                                        return (
                                          <td
                                            key={`${item.id}-${field.name}-submitted`}
                                            className="px-4 py-3 align-top text-foreground"
                                          >
                                            {displayValue}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
            <Card className="border no-print">
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
                          onClick={() => handleDownloadFile(attachment)}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {canDeleteFiles() && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteFile(attachment)}
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
          <Card className="border no-print xl:sticky xl:top-6">
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
                  {request.status === "changes_requested" && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800">
                        <strong>Changes Requested:</strong> This request has been sent back to the initiator for updates. 
                        No approval actions can be taken until the request is updated and resubmitted.
                      </p>
                    </div>
                  )}
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
                  <Button
                    onClick={handleReject}
                    disabled={actioning}
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
                    onClick={() => setShowRequestChangesDialog(true)}
                    disabled={actioning}
                    variant="outline"
                    className="w-full gap-2"
                    size="sm"
                  >
                    {actioning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}{" "}
                    Request Changes
                  </Button>
                </div>
              )}

              {shouldShowUpdateButton && (
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
                    Update Request
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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

      {/* Request Changes Dialog */}
      <Dialog
        open={showRequestChangesDialog}
        onOpenChange={setShowRequestChangesDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Message to Initiator
              </label>
              <Textarea
                placeholder="Explain what changes are needed..."
                value={changesComment}
                onChange={(e) => setChangesComment(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRequestChangesDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRequestChanges} disabled={actioning}>
              {actioning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Request Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Request Dialog */}
      <Dialog open={showUpdateForm} onOpenChange={setShowUpdateForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Update Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-sm font-medium mb-2">
                Pre-Salutation (Optional)
              </label>
              <RichTextEditor
                key={`pre-comments-${showUpdateForm ? "open" : "closed"}`}
                content={
                  typeof updatingFormData.pre_comments === "string"
                    ? updatingFormData.pre_comments
                    : ""
                }
                onChange={(html) =>
                  setUpdatingFormData((prev) => ({
                    ...prev,
                    pre_comments: html,
                  }))
                }
                placeholder="e.g., Dear Mr. Manager, I hope you are doing well. Please find below..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: Add a greeting or salutation before the form data
              </p>
            </div>

            {typeof updatingFormData.content === "string" && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Letter body
                </label>
                <RichTextEditor
                  key={`letter-body-${showUpdateForm ? "open" : "closed"}`}
                  content={updatingFormData.content}
                  onChange={(html) =>
                    setUpdatingFormData((prev) => ({
                      ...prev,
                      content: html,
                    }))
                  }
                  placeholder="Letter content…"
                />
              </div>
            )}

            {repeatableFields.length > 0 ? (
              <LineItemsManager
                items={
                  Array.isArray(updatingFormData.items)
                    ? (updatingFormData.items as LineItem[])
                    : []
                }
                onItemsChange={(newItems) =>
                  setUpdatingFormData((prev) => ({
                    ...prev,
                    items: newItems,
                  }))
                }
                repeatableFields={repeatableFields}
                title="Line items"
              />
            ) : (
              fields.map((field) => {
                const currentValue = updatingFormData[field.name] ?? "";
                return (
                  <div key={field.name}>
                    <label className="block text-sm font-medium mb-2">
                      {field.label}
                    </label>
                    {field.type === "text" ||
                    field.type === "email" ||
                    field.type === "number" ? (
                      <input
                        type={field.type}
                        value={String(currentValue)}
                        onChange={(e) =>
                          setUpdatingFormData((prev) => ({
                            ...prev,
                            [field.name]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder={field.label}
                      />
                    ) : field.type === "textarea" ? (
                      <textarea
                        value={String(currentValue)}
                        onChange={(e) =>
                          setUpdatingFormData((prev) => ({
                            ...prev,
                            [field.name]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        rows={3}
                        placeholder={field.label}
                      />
                    ) : field.type === "select" && field.options ? (
                      <select
                        value={String(currentValue)}
                        onChange={(e) =>
                          setUpdatingFormData((prev) => ({
                            ...prev,
                            [field.name]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select {field.label}</option>
                        {field.options?.map((opt: string) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                Post-Comments (Optional)
              </label>
              <RichTextEditor
                key={`post-comments-${showUpdateForm ? "open" : "closed"}`}
                content={
                  typeof updatingFormData.post_comments === "string"
                    ? updatingFormData.post_comments
                    : ""
                }
                onChange={(html) =>
                  setUpdatingFormData((prev) => ({
                    ...prev,
                    post_comments: html,
                  }))
                }
                placeholder="e.g., Thank you for your time and consideration. Please contact me if you need any additional information."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: Add any closing comments before your signature
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRequest} disabled={actioning}>
              {actioning ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Submit Updated Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
