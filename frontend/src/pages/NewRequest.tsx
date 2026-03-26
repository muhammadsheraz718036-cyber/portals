import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Loader2 } from "lucide-react";
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
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { FormFieldInput } from "@/components/FormFieldInput";
import { LineItemsManager, type LineItem } from "@/components/LineItemsManager";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { ApprovalFormField } from "@/lib/constants";

type ChainStep = { order: number; roleName: string; action: string };

type ApprovalTypeRow = {
  id: string;
  name: string;
  description: string | null;
  fields: ApprovalFormField[];
  page_layout?: string;
};

type ChainRow = {
  id: string;
  name: string;
  approval_type_id: string | null;
  steps: ChainStep[];
};

export default function NewRequest() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { settings } = useCompany();
  const [selectedType, setSelectedType] = useState<string>("");
  // const [editorContent, setEditorContent] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [items, setItems] = useState<LineItem[]>([]);
  const [preComments, setPreComments] = useState<string>("");
  const [postComments, setPostComments] = useState<string>("");
  const [types, setTypes] = useState<ApprovalTypeRow[]>([]);
  const [chainsByType, setChainsByType] = useState<Record<string, ChainRow[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [rawTypes, chains] = await Promise.all([
          api.approvalTypes.list() as Promise<any[]>,
          api.approvalChains.list() as Promise<any[]>,
        ]);

        if (cancelled) return;

        setTypes(
          rawTypes.map((t) => ({
            ...t,
            fields: Array.isArray(t.fields) ? t.fields : [],
          })),
        );

        const map: Record<string, ChainRow[]> = {};
        for (const c of chains as any[]) {
          const tid = c.approval_type_id;
          if (!tid) continue;
          if (!map[tid]) map[tid] = [];
          map[tid].push({
            id: c.id,
            name: c.name,
            approval_type_id: c.approval_type_id,
            steps: Array.isArray(c.steps) ? c.steps : [],
          });
        }
        setChainsByType(map);
      } catch {
        if (!cancelled) {
          setTypes([]);
          setChainsByType({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const approvalType = types.find((t) => t.id === selectedType);
  const chainList = selectedType ? (chainsByType[selectedType] ?? []) : [];
  const chain = chainList[0];

  // Separate repeatable fields (line items) from regular form fields
  const regularFields = approvalType?.fields.filter((f) => !f.repeatable) ?? [];
  const repeatableFields =
    approvalType?.fields.filter((f) => f.repeatable) ?? [];

  const companyName = settings?.company_name || "COMPANY NAME";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !chain) {
      toast.error("Select a request type with a configured approval chain.");
      return;
    }

    // Validate required regular fields
    const missingRegularFields = regularFields.filter(
      (field) =>
        field.required &&
        (!formValues[field.name] || formValues[field.name].trim() === ""),
    );
    if (missingRegularFields.length > 0) {
      toast.error(
        `Please fill in required fields: ${missingRegularFields.map((f) => f.label).join(", ")}`,
      );
      return;
    }

    // Validate required repeatable fields in items
    if (repeatableFields.some((f) => f.required)) {
      for (const item of items) {
        const missingItemFields = repeatableFields.filter(
          (field) =>
            field.required &&
            (!item[field.name] || String(item[field.name]).trim() === ""),
        );
        if (missingItemFields.length > 0) {
          toast.error(
            `Please fill in required fields in all line items: ${missingItemFields.map((f) => f.label).join(", ")}`,
          );
          return;
        }
      }
    }

    // Validate required comments
    if (!preComments || preComments.trim() === "") {
      toast.error("Pre-salutation is required");
      return;
    }
    if (!postComments || postComments.trim() === "") {
      toast.error("Closing remarks are required");
      return;
    }

    setSubmitting(true);
    if (!user) {
      toast.error("You must be signed in.");
      setSubmitting(false);
      return;
    }

    const steps = chain.steps ?? [];
    const totalSteps = steps.length;

    try {
      await api.approvalRequests.create({
        approval_type_id: selectedType,
        approval_chain_id: chain.id,
        department_id: profile?.department_id ?? null,
        form_data: {
          ...formValues,
          items: items,
          pre_comments: preComments,
          post_comments: postComments,
          // content: editorContent, // Rich text editor content (commented out)
        } as Record<string, unknown>,
        current_step: 1,
        total_steps: Math.max(totalSteps, 1),
        status: totalSteps > 0 ? "in_progress" : "pending",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
      setSubmitting(false);
      return;
    }

    toast.success("Request submitted");
    navigate("/approvals");
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="w-full p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/approvals")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <h1 className="text-xl font-bold text-foreground">
          New Approval Request
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Request Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedType}
              onValueChange={(v) => {
                setSelectedType(v);
                setFormValues({});
                setItems([]);
                setPreComments("");
                setPostComments("");
                // setEditorContent("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an approval type..." />
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name} - {type.description ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {types.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                No approval types configured yet.
              </p>
            )}
          </CardContent>
        </Card>

        {approvalType && (
          <>
            <Card className="border">
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

                {/* Form Fields - Grouped by group property */}
                {regularFields.length > 0 && (
                  <div className="space-y-4">
                    {(() => {
                      // Group fields by their group property
                      const groups = Array.from(
                        new Set(regularFields.map((f) => f.group || "General")),
                      ).sort();

                      return (
                        <div className="space-y-6">
                          {groups.map((group) => {
                            const groupFields = regularFields.filter(
                              (f) => (f.group || "General") === group,
                            );

                            return (
                              <div key={group}>
                                {group !== "General" && (
                                  <h3 className="text-sm font-semibold text-foreground mb-3">
                                    {group}
                                  </h3>
                                )}
                                {group === "General" && (
                                  <h3 className="text-sm font-semibold text-foreground mb-3">
                                    Request Information
                                  </h3>
                                )}
                                <div
                                  className={
                                    group !== "General"
                                      ? "border rounded-lg p-4 bg-muted/30 space-y-4"
                                      : "space-y-4"
                                  }
                                >
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {groupFields.map((field) => (
                                      <div key={field.name}>
                                        <FormFieldInput
                                          field={field}
                                          value={formValues[field.name] ?? ""}
                                          onChange={(value) =>
                                            setFormValues((prev) => ({
                                              ...prev,
                                              [field.name]: value,
                                            }))
                                          }
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Pre-Comments (Salutation) */}
                <div className="space-y-2 border-t pt-4">
                  <label className="block text-sm font-medium text-foreground">
                    Pre-Salutation <span className="text-destructive">*</span>
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
            <LineItemsManager
              items={items}
              onItemsChange={setItems}
              repeatableFields={repeatableFields}
            />

            {/* Post-Comments (Closing Remarks) */}
            {(regularFields.length > 0 || repeatableFields.length > 0) && (
              <Card className="border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Closing Remarks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-foreground">
                      Post-Comments <span className="text-destructive">*</span>
                    </label>
                    <RichTextEditor
                      content={postComments}
                      onChange={setPostComments}
                      placeholder="e.g., Thank you for your time and consideration. Please contact me if you need any additional information."
                    />
                    <p className="text-xs text-muted-foreground">
                      Add any closing remarks after your form data
                    </p>
                  </div>
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
                      fontSize: "12px",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: "100%",
                      height: "100%",
                      width: "100%",
                      padding: "0.825in",
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
                        <p>{approvalType.name ?? "—"}</p>
                      </div>

                      <div
                        className="flex justify-between mt-4"
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

                      <div className="mt-6 space-y-3">
                        {preComments ? (
                          <div
                            style={{
                              fontSize: "14px",
                              fontFamily: "Arial, sans-serif",
                            }}
                            dangerouslySetInnerHTML={{ __html: preComments }}
                          />
                        ) : null}

                        {(() => {
                          // Group fields by their group property for preview
                          const groups = Array.from(
                            new Set(
                              regularFields.map((f) => f.group || "General"),
                            ),
                          ).sort();

                          return (
                            <div className="space-y-3">
                              {groups.map((group) => (
                                <div key={group}>
                                  {group !== "General" && (
                                    <h3
                                      className="font-semibold text-sm mb-2"
                                      style={{ fontSize: "14px" }}
                                    >
                                      {group}
                                    </h3>
                                  )}
                                  <div
                                    className={
                                      group === "General"
                                        ? "pl-3 border-l-2 border-muted space-y-1"
                                        : "space-y-1"
                                    }
                                  >
                                    {regularFields
                                      .filter(
                                        (f) => (f.group || "General") === group,
                                      )
                                      .map((field) => {
                                        const raw =
                                          formValues[field.name] ?? "";
                                        const display =
                                          field.type === "checkbox"
                                            ? raw === "true"
                                              ? "Yes"
                                              : "—"
                                            : String(raw ?? "").trim() || "—";

                                        return (
                                          <p
                                            key={field.name}
                                            style={{ fontSize: "14px" }}
                                          >
                                            <strong>{field.label}:</strong>{" "}
                                            {display}
                                          </p>
                                        );
                                      })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}

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
                                  (item) =>
                                    String(item.__group || "General") === group,
                                );

                                if (groupFields.length === 0) return null;

                                return (
                                  <div key={group} className="space-y-2">
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
                                        style={{ fontSize: "14px" }}
                                      >
                                        <thead>
                                          <tr>
                                            {groupFields.map((field) => (
                                              <th
                                                key={field.name}
                                                className={`border border-foreground p-2 font-semibold bg-muted ${
                                                  field.type === "number"
                                                    ? "text-right"
                                                    : "text-left"
                                                }`}
                                              >
                                                {field.label}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {groupItems.map((item) => (
                                            <tr key={item.id}>
                                              {groupFields.map((field) => {
                                                const val = (
                                                  item as Record<
                                                    string,
                                                    unknown
                                                  >
                                                )[field.name];
                                                return (
                                                  <td
                                                    key={`${item.id}-${field.name}`}
                                                    className={`border border-foreground p-2 ${
                                                      field.type === "number"
                                                        ? "text-right"
                                                        : "text-left"
                                                    }`}
                                                  >
                                                    {String(val ?? "—")}
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
                              marginTop: "1rem",
                            }}
                            dangerouslySetInnerHTML={{ __html: postComments }}
                          />
                        ) : null}
                      </div>

                      <div className="mt-6">
                        <p
                          className="font-bold mt-6"
                          style={{ fontSize: "14px" }}
                        >
                          {profile?.full_name ?? ""}
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
                );

                return (
                  <Card className="border">
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
                          height: pageHeight,
                          overflow: "hidden",
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
              <Card className="border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Approval Chain: {chain.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {chain.steps.map((step) => (
                      <div
                        key={step.order}
                        className="flex items-center gap-3 text-sm"
                      >
                        <div className="h-6 w-6 rounded bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                          {step.order}
                        </div>
                        <div>
                          <span className="font-medium">{step.roleName}</span>
                          <span className="text-muted-foreground ml-2">
                            {step.action ? "-" : step.action}
                          </span>
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
                <p className="text-sm text-destructive">
                  No approval chain is configured for this type. Ask an
                  administrator to create one in Admin → Chains.
                </p>
              )
            )}

            <Button
              type="submit"
              className="gap-2"
              disabled={submitting || !chain}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit Request
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
