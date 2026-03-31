import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import {
  ArrowLeft,
  Printer,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  SkipForward,
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
  useResolveRequestNumber,
  useRequestAttachments,
  useDownloadAttachment,
  useDeleteRequestAttachment
} from "@/hooks/services";
import { toast } from "sonner";
import type { ApprovalFormField } from "@/lib/constants";
import type { LineItem } from "@/components/LineItemsManager";
import type { RequestAttachment } from "@/services/types";

const actionIcons: Record<string, React.ReactNode> = {
  Approved: <CheckCircle className="h-5 w-5 text-success" />,
  Rejected: <XCircle className="h-5 w-5 text-destructive" />,
  Pending: <Clock className="h-5 w-5 text-warning" />,
  Waiting: <AlertCircle className="h-5 w-5 text-muted-foreground" />,
  Skipped: <SkipForward className="h-5 w-5 text-muted-foreground" />,
  ChangesRequested: <AlertCircle className="h-5 w-5 text-warning" />,
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
    default:
      return "Waiting";
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
  initiator?: { full_name: string };
  approval_types: {
    name: string;
    description: string | null;
    fields: unknown;
    page_layout?: string;
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
};

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const [actioning, setActioning] = useState(false);
  const [showRequestChangesDialog, setShowRequestChangesDialog] = useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updatingFormData, setUpdatingFormData] = useState<Record<string, unknown>>({});
  const printLetterRef = useRef<HTMLDivElement>(null);

  const resolveMutation = useResolveRequestNumber();
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const requestChangesMutation = useRequestChanges();
  const updateRequestMutation = useUpdateApprovalRequest();
  
  const { data: requestData, isLoading: loading, error: notFound } = useApprovalRequest(id || "");
  const { data: attachments = [] } = useRequestAttachments(id || "");
  const downloadMutation = useDownloadAttachment();
  const deleteMutation = useDeleteRequestAttachment();

  const request = requestData?.request as RequestRow | undefined;
  const actions = (requestData?.actions ?? []) as ActionRow[];
  const actorNames = requestData?.actorNames ?? {};

  const { data: initiatorProfile } = useProfile(request?.initiator_id || "");

  const [initiatorName, setInitiatorName] = useState("");
  const [initiatorRole, setInitiatorRole] = useState("");

  useEffect(() => {
    if (request?.initiator?.full_name) {
      setInitiatorName(request.initiator.full_name);
    }
    if (initiatorProfile?.role_name) {
      setInitiatorRole(initiatorProfile.role_name);
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
      #print-letter table td, #print-letter table th { word-break: break-word !important; }
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
      await approveMutation.mutateAsync({ id: request.id, data: { comment: "" } });
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
      await rejectMutation.mutateAsync({ id: request.id, data: { comment: "" } });
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
      await requestChangesMutation.mutateAsync({ id: request.id, data: { comment: changesComment } });
      setShowRequestChangesDialog(false);
      setChangesComment("");
      toast.success("Changes requested successfully");
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
      await updateRequestMutation.mutateAsync({ id: request.id, data: { form_data: updatingFormData } });
      setShowUpdateForm(false);
      setUpdatingFormData({});
      toast.success("Request updated and resubmitted successfully");
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
      const a = document.createElement('a');
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
    if (!confirm(`Are you sure you want to delete ${attachment.original_filename}?`)) {
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
    return request.initiator_id === user.id && 
           (request.status === "pending" || request.status === "in_progress");
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Check if user can approve: they must have the role of the first pending action
  const canApprove = () => {
    if (!request || !user || !profile || request.status !== "in_progress") {
      return false;
    }

    // Hide buttons if user is the initiator
    if (request.initiator_id === user.id) {
      return false;
    }

    // Find the first pending action
    const pendingAction = actions.find((a) => a.status === "pending");
    if (!pendingAction) {
      return false;
    }

    // Check if user has already acted on any step
    if (actions.some((a) => a.acted_by === user.id)) {
      return false; // User already approved/rejected, disable buttons
    }

    // User must have a role assigned
    if (!profile.role_id) {
      return false;
    }

    // For simplicity, we'll rely on the API to validate the role matches
    // The backend will return an error if the role doesn't match
    // This is just a UI check to hide buttons if no pending action exists
    return true;
  };

  const shouldShowButtons =
    request && request.status === "in_progress" && canApprove();
  const shouldShowUpdateButton =
    request &&
    request.status === "changes_requested" &&
    user &&
    request.initiator_id === user.id;

  // Initialize form data when entering update mode
  useEffect(() => {
    if (showUpdateForm && request?.form_data) {
      setUpdatingFormData({ ...request.form_data });
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
  const regularFields: ApprovalFormField[] = [];
  const repeatableFields = fields;

  const formData = (request?.form_data as Record<string, unknown>) ?? {};
  const items = Array.isArray(formData.items) ? formData.items : [];
  const richContent =
    typeof formData.content === "string" ? formData.content : null;
  const preComments =
    typeof formData.pre_comments === "string" ? formData.pre_comments : "";
  const postComments =
    typeof formData.post_comments === "string" ? formData.post_comments : "";
  const formEntries = Object.entries(formData).filter(
    ([key]) =>
      key !== "items" &&
      key !== "content" &&
      key !== "pre_comments" &&
      key !== "post_comments",
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

  const displayId = request.request_number;

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
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          className="gap-2"
        >
          <Printer className="h-4 w-4" /> Print Letter
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:contents">
          <Card className="border no-print lg:col-span-2 lg:row-start-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Type
                  </p>
                  <p className="font-medium">
                    {request.approval_types?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Initiator
                  </p>
                  <p className="font-medium">{initiatorName || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Department
                  </p>
                  <p className="font-medium">
                    {request.departments?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Date
                  </p>
                  <p className="font-medium">
                    {new Date(request.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-3 lg:row-start-2">
            {/* Shared letter content used for both print and preview */}
            {(() => {
              const pageLayout =
                request.approval_types?.page_layout || "portrait";
              // Standard US Letter size (inches)
              const pageWidth = pageLayout === "portrait" ? "8.5in" : "11in";
              const pageHeight = pageLayout === "portrait" ? "11in" : "8.5in";
              const pageOrientation =
                pageLayout === "portrait" ? "portrait" : "landscape";

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
                  {/* Watermark */}
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
                      <p>{request.approval_types?.name ?? "—"}</p>
                    </div>
                    <div
                      className="flex justify-between mt-4"
                      style={{ fontSize: "14px" }}
                    >
                      <div>
                        <p>
                          <strong>Request ID:</strong> {displayId}
                        </p>
                        <p>
                          <strong>Status:</strong>{" "}
                          {request.status.replace("_", " ").toUpperCase()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p>
                          <strong>Date:</strong>{" "}
                          {new Date(request.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {richContent ? (
                      <div className="relative">
                        {request.status === "changes_requested" && (
                          <div className="absolute inset-0 bg-muted/10 backdrop-blur-[0.5px] z-10 flex items-center justify-center">
                            <div className="bg-background/95 border border-border rounded-lg p-6 shadow-lg text-center">
                              <p className="font-semibold text-foreground text-lg">
                                Changes Requested
                              </p>
                              <p className="text-sm text-muted-foreground mt-2">
                                The request has been sent back for revisions.
                                Please update the form data and resubmit.
                              </p>
                            </div>
                          </div>
                        )}
                        <div
                          className={
                            request.status === "changes_requested"
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
                            dangerouslySetInnerHTML={{ __html: richContent }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-6 space-y-3">
                        {request.status === "changes_requested" ? (
                          <div className="relative">
                            <div className="absolute inset-0 bg-muted/10 backdrop-blur-[0.5px] z-10 flex items-center justify-center">
                              <div className="bg-background/95 border border-border rounded-lg p-6 shadow-lg text-center">
                                <p className="font-semibold text-foreground text-lg">
                                  Changes Requested
                                </p>
                                <p className="text-sm text-muted-foreground mt-2">
                                  The request has been sent back for revisions.
                                  Please update the form data and resubmit.
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
                                    __html: preComments,
                                  }}
                                />
                              )}
                              {repeatableFields.length > 0 && (
                                <div className="space-y-6 my-4">
                                  {Array.from(
                                    new Set(
                                      repeatableFields.map(
                                        (f) => f.group || "General",
                                      ),
                                    ),
                                  )
                                    .sort((a, b) => {
                                      if (a === "General") return -1;
                                      if (b === "General") return 1;
                                      return a.localeCompare(b);
                                    })
                                    .map((group) => {
                                      const groupFields =
                                        repeatableFields.filter(
                                          (f) =>
                                            (f.group || "General") === group,
                                        );
                                      const groupItems = items.filter(
                                        (item: LineItem) =>
                                          String(item.__group || "General") ===
                                          group,
                                      );

                                      if (groupFields.length === 0) return null;

                                      return (
                                        <div
                                          key={group}
                                          className="border rounded p-3 bg-muted/10"
                                        >
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
                                                      {field.label ||
                                                        field.name}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {groupItems.map(
                                                  (
                                                    item: LineItem,
                                                    idx: number,
                                                  ) => (
                                                    <tr key={idx}>
                                                      {groupFields.map(
                                                        (field) => (
                                                          <td
                                                            key={`${idx}-${field.name}`}
                                                            className="border border-foreground p-2 text-center"
                                                          >
                                                            {item[field.name] ??
                                                              "—"}
                                                          </td>
                                                        ),
                                                      )}
                                                    </tr>
                                                  ),
                                                )}
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
                                    __html: postComments,
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
                                  __html: preComments,
                                }}
                              />
                            )}
                            {repeatableFields.length > 0 && (
                              <div className="space-y-6 my-4">
                                {Array.from(
                                  new Set(
                                    repeatableFields.map(
                                      (f) => f.group || "General",
                                    ),
                                  ),
                                )
                                  .sort((a, b) => {
                                    if (a === "General") return -1;
                                    if (b === "General") return 1;
                                    return a.localeCompare(b);
                                  })
                                  .map((group) => {
                                    const groupFields = repeatableFields.filter(
                                      (f) => (f.group || "General") === group,
                                    );
                                    const groupItems = items.filter(
                                      (item: LineItem) =>
                                        String(item.__group || "General") ===
                                        group,
                                    );

                                    if (groupFields.length === 0) return null;

                                    return (
                                      <div
                                        key={group}
                                        className="border rounded p-3 bg-muted/10"
                                      >
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
                                              {groupItems.map(
                                                (
                                                  item: LineItem,
                                                  idx: number,
                                                ) => (
                                                  <tr key={idx}>
                                                    {groupFields.map(
                                                      (field) => (
                                                        <td
                                                          key={`${idx}-${field.name}`}
                                                          className="border border-foreground p-2 text-center"
                                                        >
                                                          {item[field.name] ??
                                                            "—"}
                                                        </td>
                                                      ),
                                                    )}
                                                  </tr>
                                                ),
                                              )}
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
                                  __html: postComments,
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <div className="mt-12 flex justify-end">
                      <div className="text-left w-full max-w-[210px]">
                        <p className="font-bold" style={{ fontSize: "14px" }}>
                          {initiatorName}
                        </p>
                        <p
                          className="text-muted-foreground"
                          style={{ fontSize: "13px" }}
                        >
                          {initiatorRole || "No Role Assigned"}
                        </p>
                        <p
                          className="text-muted-foreground"
                          style={{ fontSize: "13px" }}
                        >
                          {request.departments?.name ?? ""}
                        </p>
                        <p
                          className="text-muted-foreground"
                          style={{ fontSize: "13px" }}
                        >
                          {companyName ?? ""}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );

              return (
                <>
                  {/* Print version (hidden on screen) */}
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

                  {/* On-screen preview */}
                  <Card className="border no-print">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        Letter Preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div
                        className="bg-card border rounded shadow-sm"
                        style={{
                          width: pageWidth,
                          margin: "0 auto",
                          height: pageHeight,
                          overflow: "hidden",
                          boxSizing: "border-box",
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        {letterContent}
                      </div>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </div>
        </div>

        <div className="lg:col-start-3 lg:row-start-1 lg:col-span-1">
          <Card className="border sticky top-6 no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Approval Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {actions.map((step, idx) => {
                  const iconKey = iconKeyForAction(step.status);
                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex-shrink-0">
                          {actionIcons[iconKey] || actionIcons.Waiting}
                        </div>
                        {idx < actions.length - 1 && (
                          <div className="w-px h-full min-h-[40px] bg-border my-1" />
                        )}
                      </div>
                      <div className="pb-6">
                        <p className="text-sm font-medium">
                          Step {step.step_order}: {step.role_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {step.action_label}
                        </p>
                        {step.acted_by && (
                          <p className="text-xs text-muted-foreground">
                            By: {actorNames[step.acted_by] ?? "—"}
                          </p>
                        )}
                        {step.acted_at && (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                            {new Date(step.acted_at).toLocaleString()}
                          </p>
                        )}
                        {step.comment && (
                          <p className="text-xs text-foreground mt-1 bg-muted/50 rounded px-2 py-1">
                            &quot;{step.comment}&quot;
                          </p>
                        )}
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

          {/* File Attachments */}
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
                            <span>{new Date(attachment.created_at!).toLocaleDateString()}</span>
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
      </div>

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

            {fields.map((field) => {
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
            })}

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
