import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, CheckCircle, XCircle, Clock, AlertCircle, SkipForward, Loader2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { ApprovalFormField } from "@/lib/constants";

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
  approval_types: { name: string; description: string | null; fields: unknown } | null;
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

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useCompany();
  const { user, profile } = useAuth();
  const [request, setRequest] = useState<RequestRow | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [initiatorName, setInitiatorName] = useState("");
  const [initiatorRole, setInitiatorRole] = useState("");
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [showRequestChangesDialog, setShowRequestChangesDialog] = useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [updatingFormData, setUpdatingFormData] = useState<Record<string, unknown>>({});

  const companyName = settings?.company_name || "COMPANY NAME";

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        let resolvedId = id;
        if (!uuidRe.test(id)) {
          const r = await api.approvalRequests.resolveNumber(id);
          resolvedId = r.id;
        }
        const data = await api.approvalRequests.get(resolvedId);
        if (cancelled) return;
        const row = data.request as RequestRow;
        setRequest(row);
        setInitiatorName(row.initiator?.full_name ?? "");
        
        // Fetch initiator's profile to get role
        try {
          const profiles = await api.profiles.list();
          const initiatorProfile = (profiles as any[]).find(p => p.id === row.initiator_id);
          if (initiatorProfile?.role_id) {
            const roles = await api.roles.list();
            const role = (roles as any[]).find(r => r.id === initiatorProfile.role_id);
            setInitiatorRole(role?.name ?? "");
          }
        } catch {
          setInitiatorRole("");
        }
        
        setActions((data.actions ?? []) as ActionRow[]);
        setActorNames(data.actorNames ?? {});
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setRequest(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const handleApprove = async () => {
    if (!request) return;
    setActioning(true);
    try {
      const data = await api.approvalRequests.approve(request.id, { comment: "" }) as unknown as { request: RequestRow; actions: ActionRow[] };
      setRequest(data.request);
      setActions(data.actions ?? []);
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
      const data = await api.approvalRequests.reject(request.id, { comment: "" }) as unknown as { request: RequestRow; actions: ActionRow[] };
      setRequest(data.request);
      setActions(data.actions ?? []);
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
      const data = await api.approvalRequests.requestChanges(request.id, { comment: changesComment }) as unknown as { request: RequestRow; actions: ActionRow[] };
      setRequest(data.request);
      setActions(data.actions ?? []);
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
      const data = await api.approvalRequests.update(request.id, { form_data: updatingFormData }) as unknown as { request: RequestRow; actions: ActionRow[] };
      setRequest(data.request);
      setActions(data.actions ?? []);
      setShowUpdateForm(false);
      setUpdatingFormData({});
      toast.success("Request updated and resubmitted successfully");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update request");
    } finally {
      setActioning(false);
    }
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

  const shouldShowButtons = request && request.status === "in_progress" && canApprove();
  const shouldShowUpdateButton = request && request.status === "changes_requested" && user && request.initiator_id === user.id;

  // Initialize form data when entering update mode
  useEffect(() => {
    if (showUpdateForm && request?.form_data) {
      setUpdatingFormData(request.form_data);
    }
  }, [showUpdateForm, request?.form_data]);

  const fields: ApprovalFormField[] = Array.isArray(request?.approval_types?.fields)
    ? (request!.approval_types!.fields as unknown as ApprovalFormField[])
    : [];

  const regularFields = fields.filter((f) => !f.repeatable);
  const repeatableFields = fields.filter((f) => f.repeatable);

  const formData = (request?.form_data as Record<string, unknown>) ?? {};
  const items = Array.isArray(formData.items) ? formData.items : [];
  const richContent = typeof formData.content === "string" ? formData.content : null;
  const formEntries = Object.entries(formData).filter(([key]) => key !== "items" && key !== "content");

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
        <Button variant="ghost" onClick={() => navigate("/approvals")} className="mt-2">
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
          <Button variant="ghost" size="sm" onClick={() => navigate("/approvals")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-bold text-foreground">{displayId}</h1>
          <StatusBadge status={request.status} />
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
          <Printer className="h-4 w-4" /> Print Letter
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Type</p>
                  <p className="font-medium">{request.approval_types?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Initiator</p>
                  <p className="font-medium">{initiatorName || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Department</p>
                  <p className="font-medium">{request.departments?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Date</p>
                  <p className="font-medium">{new Date(request.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Form Data</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {formEntries.map(([key, value]) => {
                  const field = fields.find((f) => f.name === key);
                  return (
                    <div key={key}>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">{field?.label || key}</p>
                      <p className="font-medium">{value === null || value === undefined ? "—" : String(value)}</p>
                    </div>
                  );
                })}
                {formEntries.length === 0 && <p className="text-sm text-muted-foreground">No form data</p>}
              </div>
            </CardContent>
          </Card>

          {/* Line Items Section */}
          {items.length > 0 && repeatableFields.length > 0 && (
            <Card className="border no-print">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Entries</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {repeatableFields.map((field) => (
                          <th
                            key={field.name}
                            className={`text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide ${
                              field.type === "number" ? "text-right" : ""
                            }`}
                          >
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item: any, idx: number) => (
                        <tr key={idx}>
                          {repeatableFields.map((field) => {
                            const value = item[field.name] ?? "";
                            return (
                              <td
                                key={`${idx}-${field.name}`}
                                className={`px-4 py-3 ${field.type === "number" ? "text-right" : ""}`}
                              >
                                {value === null || value === undefined || value === "" ? "—" : String(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-none print-only" id="print-letter" style={{ display: "none" }}>
            <CardContent className="p-8 relative" style={{ fontSize: "12pt" }}>
              {/* Watermark - Request ID */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.06] rotate-[-35deg]">
                <span className="text-[6rem] font-bold tracking-widest text-foreground whitespace-nowrap select-none">
                  {user.email}
                </span>
              </div>
              {/* Full letter content */}
              <div className="relative z-10">
                <div className="text-center border-b-2 border-foreground pb-3">
                  {settings?.logo_url && (
                    <img src={settings.logo_url} alt="Logo" className="h-10 mx-auto mb-1 object-contain" />
                  )}
                  <h2 className="text-lg font-bold tracking-wide">{companyName.toUpperCase()}</h2>
                </div>
                <div className="flex justify-between text-xs mt-4">
                  <div>
                    <p><strong>Request ID:</strong> {displayId}</p>
                    <p><strong>Type:</strong> {request.approval_types?.name ?? "—"}</p>
                  </div>
                  <div className="text-right">
                    <p><strong>Date:</strong> {new Date(request.created_at).toLocaleDateString()}</p>
                    <p><strong>Status:</strong> {request.status.replace("_", " ").toUpperCase()}</p>
                  </div>
                </div>
                <Separator className="my-3" />
                <div className="text-xs">
                  <p><strong>From:</strong> {initiatorName}, {request.departments?.name ?? "—"}</p>
                </div>
                <p className="font-bold text-xs mt-3">Subject: {request.approval_types?.name ?? "Request"}</p>
                {richContent ? (
                  <div
                    className="my-3 text-xs prose prose-sm max-w-none [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-1 [&_th]:border [&_th]:border-border [&_th]:p-1 [&_th]:bg-muted [&_th]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: richContent }}
                  />
                ) : (
                  <div className="pl-3 border-l-2 border-muted space-y-1 my-3">
                    {formEntries.map(([key, value]) => {
                      const field = fields.find((f) => f.name === key);
                      return (
                        <p key={key} className="text-xs">
                          <strong>{field?.label || key}:</strong> {String(value ?? "")}
                        </p>
                      );
                    })}
                  </div>
                )}
                {/* Line Items Table for Letter */}
                {items.length > 0 && repeatableFields.length > 0 && (
                  <div className="my-4">
                    <p className="font-bold text-xs mb-2">Entries:</p>
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr>
                          {repeatableFields.map((field) => (
                            <th
                              key={field.name}
                              className={`border border-foreground p-1 font-semibold bg-muted ${
                                field.type === "number" ? "text-right" : "text-left"
                              }`}
                            >
                              {field.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item: any, idx: number) => (
                          <tr key={idx}>
                            {repeatableFields.map((field) => (
                              <td
                                key={`${idx}-${field.name}`}
                                className={`border border-foreground p-1 ${
                                  field.type === "number" ? "text-right" : "text-left"
                                }`}
                              >
                                {item[field.name] ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs leading-relaxed">I kindly request your prompt review and approval of this request.</p>
                <div className="mt-6">
                  <p className="text-xs">Respectfully submitted,</p>
                  <p className="text-xs font-bold mt-3">{initiatorName}</p>
                  {initiatorRole && <p className="text-xs text-muted-foreground">{initiatorRole}</p>}
                  <p className="text-[11px] text-muted-foreground">{request.departments?.name ?? ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border no-print">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Letter Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-document bg-card border rounded p-6 space-y-4 text-sm max-w-2xl mx-auto shadow-sm">
                <div className="text-center border-b-2 border-foreground pb-3">
                  {settings?.logo_url && (
                    <img src={settings.logo_url} alt="Logo" className="h-10 mx-auto mb-1 object-contain" />
                  )}
                  <h2 className="text-lg font-bold tracking-wide">{companyName.toUpperCase()}</h2>
                </div>
                <div className="flex justify-between text-xs">
                  <div>
                    <p>
                      <strong>Request ID:</strong> {displayId}
                    </p>
                    <p>
                      <strong>Type:</strong> {request.approval_types?.name ?? "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p>
                      <strong>Date:</strong> {new Date(request.created_at).toLocaleDateString()}
                    </p>
                    <p>
                      <strong>Status:</strong> {request.status.replace("_", " ").toUpperCase()}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="text-xs">
                  <p>
                    <strong>From:</strong> {initiatorName}, {request.departments?.name ?? "—"}
                  </p>
                </div>
                <p className="font-bold text-xs">Subject: {request.approval_types?.name ?? "Request"}</p>
                {richContent ? (
                  <div
                    className="my-3 text-xs prose prose-sm max-w-none [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-1 [&_th]:border [&_th]:border-border [&_th]:p-1 [&_th]:bg-muted [&_th]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: richContent }}
                  />
                ) : (
                  <div className="pl-3 border-l-2 border-muted space-y-1 my-3">
                    {formEntries.map(([key, value]) => {
                      const field = fields.find((f) => f.name === key);
                      return (
                        <p key={key} className="text-xs">
                          <strong>{field?.label || key}:</strong> {String(value ?? "")}
                        </p>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs leading-relaxed">I kindly request your prompt review and approval of this request.</p>
                <div className="mt-6">
                  <p className="text-xs">Respectfully submitted,</p>
                  <p className="text-xs font-bold mt-3">{initiatorName}</p>
                  {initiatorRole && <p className="text-xs text-muted-foreground">{initiatorRole}</p>}
                  <p className="text-[11px] text-muted-foreground">{request.departments?.name ?? ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
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
                        <div className="flex-shrink-0">{actionIcons[iconKey] || actionIcons.Waiting}</div>
                        {idx < actions.length - 1 && <div className="w-px h-full min-h-[40px] bg-border my-1" />}
                      </div>
                      <div className="pb-6">
                        <p className="text-sm font-medium">
                          Step {step.step_order}: {step.role_name}
                        </p>
                        <p className="text-xs text-muted-foreground">{step.action_label}</p>
                        {step.acted_by && (
                          <p className="text-xs text-muted-foreground">By: {actorNames[step.acted_by] ?? "—"}</p>
                        )}
                        {step.acted_at && (
                          <p className="text-[11px] text-muted-foreground/70 mt-0.5">{new Date(step.acted_at).toLocaleString()}</p>
                        )}
                        {step.comment && (
                          <p className="text-xs text-foreground mt-1 bg-muted/50 rounded px-2 py-1">&quot;{step.comment}&quot;</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {actions.length === 0 && <p className="text-sm text-muted-foreground">No timeline steps yet.</p>}
              </div>

              {shouldShowButtons && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <Button onClick={handleApprove} disabled={actioning} className="w-full gap-2" size="sm">
                    {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Approve
                  </Button>
                  <Button onClick={handleReject} disabled={actioning} variant="destructive" className="w-full gap-2" size="sm">
                    {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                  </Button>
                  <Button onClick={() => setShowRequestChangesDialog(true)} disabled={actioning} variant="outline" className="w-full gap-2" size="sm">
                    {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />} Request Changes
                  </Button>
                </div>
              )}

              {shouldShowUpdateButton && (
                <div className="mt-4 pt-4 border-t space-y-2">
                  <Button onClick={() => setShowUpdateForm(true)} disabled={actioning} variant="outline" className="w-full gap-2" size="sm">
                    {actioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit2 className="h-4 w-4" />} Update Request
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Request Changes Dialog */}
      <Dialog open={showRequestChangesDialog} onOpenChange={setShowRequestChangesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Message to Initiator</label>
              <Textarea
                placeholder="Explain what changes are needed..."
                value={changesComment}
                onChange={(e) => setChangesComment(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestChangesDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRequestChanges} disabled={actioning}>
              {actioning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
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
            {fields.map((field) => {
              const currentValue = updatingFormData[field.name] ?? "";
              return (
                <div key={field.name}>
                  <label className="block text-sm font-medium mb-2">{field.label}</label>
                  {field.type === "text" || field.type === "email" || field.type === "number" ? (
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
                      {field.options.map((opt: any) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRequest} disabled={actioning}>
              {actioning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Submit Updated Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
