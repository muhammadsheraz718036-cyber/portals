import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

type SpreadsheetPreview = {
  name: string;
  rows: unknown[][];
};

type FilePreviewDialogProps = {
  open: boolean;
  fileName: string;
  blob: Blob | null;
  onOpenChange: (open: boolean) => void;
  onDownload?: () => void;
};

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

export function FilePreviewDialog({
  open,
  fileName,
  blob,
  onOpenChange,
  onDownload,
}: FilePreviewDialogProps) {
  const [objectUrl, setObjectUrl] = useState("");
  const [htmlPreview, setHtmlPreview] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<SpreadsheetPreview[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const extension = useMemo(() => getExtension(fileName), [fileName]);

  useEffect(() => {
    if (!open || !blob) {
      setObjectUrl("");
      setHtmlPreview("");
      setTextPreview("");
      setSpreadsheetPreview([]);
      setError("");
      setLoading(false);
      return;
    }

    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    setHtmlPreview("");
    setTextPreview("");
    setSpreadsheetPreview([]);
    setError("");

    let cancelled = false;
    const loadPreview = async () => {
      try {
        setLoading(true);
        if (blob.type.startsWith("text/plain")) {
          const text = await blob.text();
          if (!cancelled) setTextPreview(text);
          return;
        }

        if (extension === "docx") {
          const mammoth = await import("mammoth");
          const arrayBuffer = await blob.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (!cancelled) setHtmlPreview(sanitizeHtml(result.value));
          return;
        }

        if (extension === "xls" || extension === "xlsx") {
          const XLSX = await import("xlsx");
          const arrayBuffer = await blob.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
          const sheets = workbook.SheetNames.map((name) => ({
            name,
            rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
              header: 1,
              blankrows: false,
            }),
          }));
          if (!cancelled) setSpreadsheetPreview(sheets);
        }
      } catch (previewError) {
        if (!cancelled) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : "Unable to preview this file",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (blob.type.startsWith("text/plain") || ["docx", "xls", "xlsx"].includes(extension)) {
      void loadPreview();
    }

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [blob, extension, open]);

  const isImage = ["jpg", "jpeg", "png"].includes(extension);
  const isPdf = extension === "pdf";
  const isLegacyDoc = extension === "doc";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-6xl flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle className="break-all text-left">{fileName}</DialogTitle>
            {onDownload && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/20">
          {!blob ? (
            <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading preview...
            </div>
          ) : isImage && objectUrl ? (
            <div className="flex min-h-full items-center justify-center bg-background p-4">
              <img
                src={objectUrl}
                alt={fileName}
                className="max-h-full max-w-full rounded border object-contain"
              />
            </div>
          ) : isPdf && objectUrl ? (
            <iframe
              title={fileName}
              src={objectUrl}
              className="h-full min-h-[70vh] w-full bg-background"
            />
          ) : extension === "docx" ? (
            <div className="min-h-full bg-background p-4 sm:p-8">
              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing document preview...
                </div>
              ) : error ? (
                <PreviewError message={error} />
              ) : (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: htmlPreview }}
                />
              )}
            </div>
          ) : extension === "xls" || extension === "xlsx" ? (
            <div className="space-y-6 bg-background p-4">
              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing spreadsheet preview...
                </div>
              ) : error ? (
                <PreviewError message={error} />
              ) : (
                spreadsheetPreview.map((sheet) => (
                  <div key={sheet.name} className="space-y-2">
                    <h3 className="text-sm font-semibold">{sheet.name}</h3>
                    <div className="overflow-auto rounded-md border">
                      <table className="w-full border-collapse text-xs">
                        <tbody>
                          {sheet.rows.map((row, rowIndex) => (
                            <tr key={`${sheet.name}-${rowIndex}`}>
                              {row.map((cell, cellIndex) => (
                                <td
                                  key={`${sheet.name}-${rowIndex}-${cellIndex}`}
                                  className="border px-2 py-1 align-top"
                                >
                                  {renderCell(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : isLegacyDoc && blob.type.startsWith("text/plain") ? (
            <div className="min-h-full bg-background p-4 sm:p-8">
              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Preparing document preview...
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6">
                  {textPreview}
                </pre>
              )}
            </div>
          ) : isLegacyDoc ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">Legacy Word preview</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  This older .doc format cannot be rendered reliably in the browser.
                  Use Download to open it in Microsoft Word or a compatible editor.
                </p>
              </div>
            </div>
          ) : (
            <PreviewError message="No preview renderer is available for this file type." />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
