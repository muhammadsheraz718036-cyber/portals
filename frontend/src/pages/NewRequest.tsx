import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Loader2, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  useApprovalTypes,
  useApprovalChains,
  useCreateApprovalRequest,
  useApprovalTypeAttachments,
  useUploadRequestAttachments,
  useDepartmentsForUsers,
} from "@/hooks/services";
import { useAuth } from "@/contexts/auth-hooks";
import { useCompany } from "@/contexts/company-hooks";
import {
  LineItemsManager,
} from "@/components/LineItemsManager";
import {
  buildSingleEntryItems,
  type LineItem,
} from "@/lib/lineItems";
import { RichTextEditor } from "@/components/RichTextEditor";
import { FileUpload } from "@/components/FileUpload";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { services } from "@/services";
import type { ApprovalFormField } from "@/lib/constants";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { formatExistingActionLabel, getScopeLabel } from "@/lib/workflowLabels";
import { formatFormValue, isFieldRequired, isFieldVisible } from "@/lib/formSchema";

function getGroupRenderOrder(fields: ApprovalFormField[]) {
  return Array.from(new Set(fields.map((field) => field.group || "General")));
}

type PreviewFile = {
  fileName: string;
  blob: Blob;
};

export default function NewRequest() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { settings } = useCompany();
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [items, setItems] = useState<LineItem[]>([]);
  const [preComments, setPreComments] = useState<string>("");
  const [postComments, setPostComments] = useState<string>("");
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<
    Record<string, File[]>
  >({});

  // React Query hooks
  const { data: departments = [] } = useDepartmentsForUsers();
  const { data: types = [], isLoading: loading } = useApprovalTypes(
    departmentFilter === "all" ? undefined : departmentFilter,
  );
  const { data: chains = [] } = useApprovalChains();
  const createMutation = useCreateApprovalRequest();
  const uploadMutation = useUploadRequestAttachments();

  // Get attachment configurations for selected type
  const { data: attachmentConfigs = [] } =
    useApprovalTypeAttachments(selectedType);

  useEffect(() => {
    const approvalType = types.find((t) => t.id === selectedType);
    if (approvalType) {
      setPreComments(approvalType.pre_salutation || "");
      setPostComments(approvalType.post_salutation || "");
    }
  }, [selectedType, types]);

  const approvalType = types.find((t) => t.id === selectedType);
  const chainList = selectedType
    ? chains.filter((c) => c.approval_type_id === selectedType)
    : [];
  const chain = chainList[0];

  useEffect(() => {
    // Default the filter to the user's department to shorten the list,
    // but do not use the filter as the submitted request department.
    if (departmentFilter === "all" && profile?.department_id) {
      setDepartmentFilter(profile.department_id);
    }
  }, [profile, departmentFilter]);

  useEffect(() => {
    setSelectedType("");
  }, [departmentFilter]);

  const safePreComments = preComments ? sanitizeHtml(preComments) : "";
  const safePostComments = postComments ? sanitizeHtml(postComments) : "";

  // All fields are now repeatable (line items)
  const approvalTypeFields = approvalType?.fields;
  const repeatableFields = useMemo(
    () => approvalTypeFields ?? [],
    [approvalTypeFields],
  );
  const repeatableGroupOrder = useMemo(
    () => getGroupRenderOrder(repeatableFields),
    [repeatableFields],
  );
  const defaultItems = useMemo(
    () => buildSingleEntryItems(repeatableFields, []),
    [repeatableFields],
  );

  useEffect(() => {
    if (!selectedType) {
      setItems((current) => (current.length === 0 ? current : []));
      return;
    }

    setItems((current) => {
      const next = buildSingleEntryItems(repeatableFields, current);
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [selectedType, defaultItems, repeatableFields]);

  const companyName = settings?.company_name || "COMPANY NAME";

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async (
    attachmentId: string,
    filename: string,
  ) => {
    try {
      const blob = await services.approvalTypes.downloadTemplateFile(attachmentId);
      downloadBlob(blob, filename);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to download template",
      );
    }
  };

  const handlePreviewTemplate = async (
    attachmentId: string,
    filename: string,
  ) => {
    try {
      const blob = await services.approvalTypes.previewTemplateFile(attachmentId);
      setPreviewFile({ fileName: filename, blob });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load preview",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !chain) {
      toast.error("Select a request type with a configured approval chain.");
      return;
    }

    // Validate required attachments
    for (const config of attachmentConfigs) {
      const files = attachmentFiles[config.field_name] || [];
      if (config.required && files.length === 0) {
        toast.error(`${config.label} is required`);
        return;
      }
      if (files.length > config.max_files) {
        toast.error(
          `${config.label}: Maximum ${config.max_files} files allowed`,
        );
        return;
      }
    }

    // Validate required fields in the single entry for each group
    if (repeatableFields.some((f) => f.required)) {
      for (const item of items) {
        // Get fields applicable to this item's group
        const itemGroup = String(item.__group || "General");
        const formDataForConditions = { ...formValues, items };
        const itemFields = repeatableFields.filter(
          (field) =>
            (field.group || "General") === itemGroup &&
            isFieldVisible(field, formDataForConditions, itemGroup),
        );
        const missingItemFields = itemFields.filter(
          (field) => {
            if (!isFieldRequired(field, formDataForConditions, itemGroup)) return false;
            const value = item[field.name];
            if (field.type === "checkbox") return value !== true && value !== "true";
            if (field.type === "multiselect") return !Array.isArray(value) || value.length === 0;
            return !value || String(value).trim() === "";
          },
        );
        if (missingItemFields.length > 0) {
          toast.error(
            `Please fill in required fields: ${missingItemFields.map((f) => f.label).join(", ")}`,
          );
          return;
        }
      }
    }

    if (!user) {
      toast.error("You must be signed in.");
      return;
    }

    const steps = chain.steps ?? [];
    const totalSteps = steps.length;

    try {
      const requestDepartmentId = profile?.department_id ?? null;
      if (!requestDepartmentId) {
        toast.error("Your profile must be assigned to a department");
        return;
      }

      const requestData = await createMutation.mutateAsync({
        approval_type_id: selectedType,
        approval_chain_id: chain.id,
        department_id: requestDepartmentId,
        form_data: {
          ...formValues,
          items: items,
          pre_comments: preComments,
          post_comments: postComments,
        } as Record<string, unknown>,
        current_step: 1,
        total_steps: Math.max(totalSteps, 1),
        status: totalSteps > 0 ? "in_progress" : "pending",
      });

      // Upload files after request is created
      const uploadPromises: Promise<unknown>[] = [];
      for (const config of attachmentConfigs) {
        const files = attachmentFiles[config.field_name] || [];
        if (files.length > 0) {
          uploadPromises.push(
            uploadMutation.mutateAsync({
              requestId: requestData.id,
              fieldName: config.field_name,
              files,
            }),
          );
        }
      }

      if (uploadPromises.length > 0) {
        await Promise.all(uploadPromises);
        toast.success("Request submitted with attachments");
      } else {
        toast.success("Request submitted");
      }

      navigate("/approvals");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit request",
      );
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                New Approval Request
              </h1>
              <p className="text-sm text-muted-foreground">
                Select a type, fill details, and submit for approval.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Select Request Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Department Scope
                  </p>
                  <Select
                    value={departmentFilter}
                    onValueChange={(v) => {
                      setDepartmentFilter(v);
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Choose a department filter..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Approval Type
                  </p>
                  <Select
                    value={selectedType}
                    disabled={loading}
                    onValueChange={(v) => {
                      setSelectedType(v);
                      setFormValues({});
                      setItems([]);
                      setPreComments("");
                      setPostComments("");
                      setAttachmentFiles({});
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {loading && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        )}
                        <SelectValue
                          placeholder={
                            loading
                              ? "Loading approval types..."
                              : "Choose an approval type..."
                          }
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {types.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!loading && types.length === 0 && (
                <p className="px-1 text-sm text-muted-foreground">
                  No approval types configured yet.
                </p>
              )}
              {selectedType && (
                <p className="px-1 text-sm text-muted-foreground">
                  Fill in your request data in the sections below, then submit.
                </p>
              )}
            </CardContent>
          </Card>

          {approvalType && (
            <>
              <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Request Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {approvalType.description && (
                  <div className="bg-muted/50 border rounded-md p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Instructions
                    </p>
                    <p className="text-sm text-foreground">
                      {approvalType.description}
                    </p>
                  </div>
                )}

                {/* Pre-Comments (Salutation) */}
                {approvalType?.pre_salutation && (
                  <div className="space-y-2 border-t pt-4">
                    <label className="block text-sm font-medium text-foreground">
                      Pre-Salutation
                    </label>
                    <RichTextEditor
                      content={preComments}
                      onChange={setPreComments}
                      placeholder="e.g., Dear Mr. Manager, I hope you are doing well. Please find below the details of my request..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Add a greeting or salutation before the form data
                    </p>
                  </div>
                )}

                {/* Rich Text Editor - Commented Out */}
                {/* 
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Additional Details</h3>
                  <RichTextEditor
                    content={editorContent}
                    onChange={setEditorContent}
                    placeholder="Compose your request here..."
                  />
                </div>
                */}
              </CardContent>
              </Card>

              {/* Line Items Manager */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Request Input Fields</p>
                <p className="text-xs text-muted-foreground">
                  Enter your values in the fields below.
                </p>
                <LineItemsManager
                  items={items}
                  onItemsChange={setItems}
                  repeatableFields={repeatableFields}
                />
              </div>

              {/* File Attachments */}
              {attachmentConfigs.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">File Attachments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {attachmentConfigs.map((config) => (
                      <div key={config.field_name} className="space-y-3">
                        {config.template_original_filename && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                            <div>
                              <p className="text-sm font-medium">
                                Template: {config.template_original_filename}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Download this file, complete it if needed, then upload it below.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() =>
                                  handlePreviewTemplate(
                                    config.id,
                                    config.template_original_filename!,
                                  )
                                }
                              >
                                <Eye className="h-4 w-4" />
                                Preview
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() =>
                                  handleDownloadTemplate(
                                    config.id,
                                    config.template_original_filename!,
                                  )
                                }
                              >
                                <Download className="h-4 w-4" />
                                Download
                              </Button>
                            </div>
                          </div>
                        )}
                        <FileUpload
                          fieldName={config.field_name}
                          label={config.label}
                          required={config.required}
                          maxFiles={config.max_files}
                          maxSizeMB={config.max_file_size_mb}
                          allowedExtensions={config.allowed_extensions}
                          value={attachmentFiles[config.field_name] || []}
                          onChange={(files) =>
                            setAttachmentFiles((prev) => ({
                              ...prev,
                              [config.field_name]: files,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

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

            {/* Post-Comments (Closing Remarks) */}
              {repeatableFields.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Closing Remarks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {approvalType?.post_salutation && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-foreground">
                          Post-Comments
                        </label>
                        <RichTextEditor
                          content={postComments}
                          onChange={setPostComments}
                          placeholder="e.g., Thank you for your time and consideration. Please contact me if you need any additional information."
                        />
                        <p className="text-xs text-muted-foreground">
                          Add a closing statement or signature
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

            {/* Letter Preview (live, before submission) */}
            {approvalType &&
              (() => {
                const pageLayout =
                  approvalType.page_layout === "landscape"
                    ? "landscape"
                    : "portrait";
                const pageWidth = pageLayout === "portrait" ? "8.5in" : "11in";
                const pageHeight = pageLayout === "portrait" ? "11in" : "8.5in";

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
                        <p>{approvalType.name ?? "—"}</p>
                      </div>

                      <div
                        className="flex justify-between mt-2"
                        style={{ fontSize: "14px" }}
                      >
                        <div>
                          <p>
                            <strong>Request ID:</strong> DRAFT
                          </p>
                          <p>
                            <strong>Status:</strong> DRAFT
                          </p>
                        </div>
                        <div className="text-right">
                          <p>
                            <strong>Date:</strong>{" "}
                            {new Date().toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="my-4">
                        {preComments ? (
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
                        ) : null}

                        {repeatableFields.length > 0 && (
                          <div className="space-y-4">
                            {repeatableGroupOrder.map((group) => {
                              const groupFields = repeatableFields.filter(
                                (f) =>
                                  (f.group || "General") === group &&
                                  !f.print_hidden &&
                                  isFieldVisible(f, { ...formValues, items }, group),
                              );
                              const groupItems = items.filter(
                                (item) =>
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
                                          {groupItems.map(
                                            (item, idx: number) => (
                                              <tr key={idx}>
                                                {groupFields.map((field) => {
                                              return (
                                                <td
                                                  key={`${idx}-${field.name}`}
                                                  className="border border-foreground p-2 text-center"
                                                >
                                                  {formatFormValue(field, item[field.name])}
                                                </td>
                                              );
                                            })}
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

                        {postComments ? (
                          <div
                            style={{
                              fontSize: "14px",
                              fontFamily: "Arial, sans-serif",
                              marginTop: "0.625rem",
                            }}
                            dangerouslySetInnerHTML={{
                              __html: safePostComments,
                            }}
                          />
                        ) : null}
                      </div>

                      <div className="flex justify-start">
                        <div className="text-left w-full max-w-[210px]">
                          {profile?.signature_url && (
                            <img
                              src={profile.signature_url}
                              alt={`${profile?.full_name || "Initiator"} signature`}
                              className="mb-0 block h-14 max-w-[180px] object-contain"
                            />
                          )}
                          <p className="font-bold" style={{ fontSize: "14px" }}>
                            {profile?.full_name ?? ""}
                          </p>
                          <p
                            className="text-muted-foreground"
                            style={{ fontSize: "13px" }}
                          >
                            {profile?.role_name || "No Role Assigned"}
                          </p>
                          <p
                            className="text-muted-foreground"
                            style={{ fontSize: "13px" }}
                          >
                            {profile?.department_name || ""}
                          </p>
                          <p
                            className="text-muted-foreground"
                            style={{ fontSize: "13px" }}
                          >
                            {settings?.company_name ?? ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );

                return (
                  <Card>
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
                          minHeight: pageHeight,
                          overflow: "visible",
                          boxSizing: "border-box",
                          display: "flex",
                          flexDirection: "column",
                          margin: "0 auto",
                        }}
                      >
                        {letterContent}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {chain ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      Approval Chain: {chain.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {chain.steps.map((step) => (
                        <div
                          key={`${step.step_order}-${step.role}`}
                          className="flex items-start gap-3 border-l-2 border-primary/30 pl-3 text-sm"
                        >
                          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {step.step_order}
                          </div>
                          <div className="space-y-0.5">
                            <p className="font-medium">{step.role}</p>
                            <p className="text-xs text-muted-foreground">
                              {step.action_label
                                ? formatExistingActionLabel(step.role, step.action_label)
                                : getScopeLabel(
                                    step.scope_type,
                                    step.scope_value,
                                  )}
                            </p>
                          </div>
                        </div>
                      ))}
                      {chain.steps.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          This chain has no steps yet.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                selectedType && (
                  <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    No approval chain is configured for this type. Ask an
                    administrator to create one in Admin → Chains.
                  </p>
                )
              )}

              <div className="sticky bottom-3 z-10 bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <Button
                  type="submit"
                  className="w-full gap-2 sm:w-auto"
                  disabled={createMutation.isPending || !chain}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Submit Request
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
