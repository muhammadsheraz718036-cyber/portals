import nodemailer, { type Transporter } from "nodemailer";
import { pool } from "../db.js";
import { env } from "../env.js";

type Recipient = {
  email: string;
  full_name: string | null;
};

type PendingRecipient = Recipient & {
  step_order: number;
  role_name: string;
  action_label: string;
};

type RequestContext = {
  id: string;
  request_number: string;
  status: string;
  current_step: number;
  total_steps: number;
  created_at: string;
  updated_at: string;
  form_data: Record<string, unknown> | null;
  approval_type_name: string;
  approval_type_description: string | null;
  department_name: string | null;
  initiator_name: string | null;
  initiator_email: string | null;
  work_assignee_id: string | null;
  work_assignee_name: string | null;
  work_assignee_email: string | null;
  work_status: string;
  work_completed_at: string | null;
  company_name: string | null;
  company_logo_url: string | null;
};

type EventSummary = {
  heading: string;
  intro: string;
  highlightLabel: string;
  highlightValue: string;
  actionLabel?: string | null;
  actorName?: string | null;
  actorComment?: string | null;
  occurredAt?: string | null;
  occurredAtLabel?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeRichHtml(value: string): string {
  const allowedTags = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ]);

  return value.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tagName) => {
    const tag = String(tagName).toLowerCase();
    if (!allowedTags.has(tag)) return "";
    return match.startsWith("</") ? `</${tag}>` : `<${tag}>`;
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatCommentHtml(value: string): string {
  return /<\/?[a-z][\s\S]*>/i.test(value)
    ? sanitizeRichHtml(value)
    : escapeHtml(value);
}

function startCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatScalar(value: unknown): string {
  if (value == null) {
    return "Not provided";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "Not provided";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
}

function formatFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "None";
    }

    const primitiveArray = value.every(
      (item) =>
        item == null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );

    if (primitiveArray) {
      return value.map((item) => formatScalar(item)).join(", ");
    }

    return JSON.stringify(value, null, 2);
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }

  return formatScalar(value);
}

function formatStatusLabel(status: string): string {
  return startCase(status);
}

function buildRequestUrl(requestId: string): string {
  return `${env.DISPLAY_BASE_URL}/approvals/${requestId}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFormDataText(formData: Record<string, unknown> | null, keys: string[]): string | null {
  if (!formData || typeof formData !== "object") {
    return null;
  }

  const normalizedKeys = new Map(
    Object.keys(formData).map((key) => [key.toLowerCase().replace(/[_\s-]+/g, ""), key]),
  );

  for (const key of keys) {
    const actualKey = normalizedKeys.get(key.toLowerCase().replace(/[_\s-]+/g, ""));
    if (!actualKey) {
      continue;
    }

    const value = formData[actualKey];
    if (value == null) {
      continue;
    }

    const text = String(value).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function getRequestTitle(request: RequestContext): string {
  return (
    getFormDataText(request.form_data, ["title", "request_title", "request name", "subject"]) ||
    request.approval_type_name ||
    request.request_number
  );
}

function buildFieldRows(formData: Record<string, unknown> | null): Array<{ label: string; value: string }> {
  if (!formData || typeof formData !== "object") {
    return [];
  }

  return Object.entries(formData).flatMap(([key, value]) => {
    if (
      value === undefined ||
      key === "items" ||
      key === "content" ||
      key === "pre_comments" ||
      key === "post_comments"
    ) {
      return [];
    }

    return [{
      label: startCase(key),
      value: formatFieldValue(value),
    }];
  });
}

function buildOutlookButtonHtml(label: string, url: string, primaryColor: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  const safeColor = escapeHtml(primaryColor);

  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="border-collapse:separate;">
    <tr>
      <td align="center" style="padding: 10px 0;">
        
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
          href="${safeUrl}"
          style="height:48px;v-text-anchor:middle;width:240px;"
          arcsize="50%"
          stroke="f"
          fillcolor="${safeColor}">
          <w:anchorlock/>
          <center style="
            color:#ffffff;
            font-family:Arial,Helvetica,sans-serif;
            font-size:15px;
            font-weight:600;">
            ${safeLabel}
          </center>
        </v:roundrect>
        <![endif]-->

        <!--[if !mso]><!-- -->
        <a href="${safeUrl}" target="_blank"
          style="
            display:inline-block;
            background-color:${safeColor};
            color:#ffffff;
            font-family:Arial,Helvetica,sans-serif;
            font-size:15px;
            font-weight:600;
            line-height:48px;
            padding:0 28px;
            text-align:center;
            text-decoration:none;
            border-radius:999px;
            -webkit-text-size-adjust:none;
            mso-hide:all;
          ">
          ${safeLabel}
        </a>
        <!--<![endif]-->

      </td>
    </tr>
  </table>`;
}

function renderHtmlEmail(args: {
  recipientName: string;
  request: RequestContext;
  event: EventSummary;
  fields: Array<{ label: string; value: string }>;
  requestUrl: string;
  pendingRecipients?: PendingRecipient[];
  hideRequesterDetails?: boolean;
}): string {
  const { recipientName, request, event, fields, requestUrl, pendingRecipients = [], hideRequesterDetails = false } = args;
  const primaryColor = process.env.EMAIL_PRIMARY_COLOR || "{{Primary Color}}";
  const companyName = request.company_name?.trim() || "{{Company Name}}";
  const logoUrl = request.company_logo_url?.trim() || "{{Company Logo URL}}";
  const requestTitle = getRequestTitle(request);
  const requesterName = request.initiator_name || request.initiator_email || "Unknown";
  const submittedOn = formatDateTime(request.created_at);
  const occurredOn = event.occurredAt ? formatDateTime(event.occurredAt) : null;
  const safePrimaryColor = escapeHtml(primaryColor);

  const summaryRows = [
    ["Request Number", request.request_number],
    ["Request Type", request.approval_type_name],
    ["Current Status", formatStatusLabel(request.status)],
    ...(!hideRequesterDetails
      ? [
          ["Requester", requesterName],
          ["Department", request.department_name || "Not assigned"],
        ]
      : []),
    ["Submission Date", submittedOn],
    ...(occurredOn
      ? [[event.occurredAtLabel || "Activity Date", occurredOn]]
      : []),
  ];

  const actorRows = [
    event.actorName ? ["By", event.actorName] : null,
    event.actorComment ? ["Comment", event.actorComment] : null,
  ].filter((row): row is [string, string] => row !== null);


  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <!--[if mso]>
    <xml>
      <o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office">
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
  </head>
  <body bgcolor="#ffffff" style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <center style="width:100%;background-color:#ffffff;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;">
              <tr>
                <td align="center" bgcolor="#ffffff" style="padding:26px 28px 22px 28px;background-color:#ffffff;border-bottom:4px solid ${safePrimaryColor};">
                  <img src="${escapeHtml(logoUrl)}" width="160" alt="${escapeHtml(companyName)}" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />
                </td>
              </tr>
              <tr>
                <td style="padding:28px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                    <tr style="margin:0;padding:0; text-align:center;">
                      <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px !important;line-height:28px;color:${safePrimaryColor};font-weight:bold;text-transform:uppercase;">
                        ${escapeHtml(companyName)}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:20px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#4b5563;">
                        Hello ${escapeHtml(recipientName)}, <br><br> ${escapeHtml(event.intro)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              ${actorRows.length > 0 ? `
                <tr>
                  <td style="padding:0 32px 18px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #e5e7eb;">
                      ${actorRows
                        .map(
                          ([label, value]) => `
                            <tr>
                              <td width="38%" valign="top" style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background-color:#f9fafb;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;font-weight:bold;color:#374151;">${escapeHtml(label)}</td>
                              <td valign="top" style="padding:12px 14px;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111827;white-space:pre-wrap;">${label === "Comment" ? formatCommentHtml(value) : escapeHtml(value)}</td>
                            </tr>`,
                        )
                        .join("")}
                    </table>
                  </td>
                </tr>`
                : ""}
              <tr>
                <td style="padding:0 32px 8px 32px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #e5e7eb;">
                    ${summaryRows
                      .map(
                        ([label, value]) => `
                          <tr>
                            <td width="38%" valign="top" style="padding:12px 14px;border-bottom:1px solid #e5e7eb;background-color:#f9fafb;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;font-weight:bold;color:#374151;">${escapeHtml(label)}</td>
                            <td valign="top" style="padding:12px 14px;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#111827;">${escapeHtml(value)}</td>
                          </tr>`,
                      )
                      .join("")}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 32px 6px 32px;">
                  ${buildOutlookButtonHtml("Click to open request", requestUrl, primaryColor)}
                </td>
              </tr>
              <tr>
                <td style="padding:26px 32px 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#4b5563;text-align:center;">
                  This is an automated email, do not reply.
                </td>
              </tr>
            </table>
    </center>
  </body>
</html>`;
}

function renderTextEmail(args: {
  recipientName: string;
  request: RequestContext;
  event: EventSummary;
  fields: Array<{ label: string; value: string }>;
  requestUrl: string;
  pendingRecipients?: PendingRecipient[];
  hideRequesterDetails?: boolean;
}): string {
  const { recipientName, request, event, requestUrl, hideRequesterDetails = false } = args;
  const requestTitle = getRequestTitle(request);
  const requesterName = request.initiator_name || request.initiator_email || "Unknown";
  const occurredOn = event.occurredAt ? formatDateTime(event.occurredAt) : null;

  const lines = [
    `${event.heading}`,
    "",
    `Hello ${recipientName},`,
    "",
    event.intro,
    "",
    `Request Title: ${requestTitle}`,
    `Request Number: ${request.request_number}`,
    `Approval Type: ${request.approval_type_name}`,
    `Current Status: ${formatStatusLabel(request.status)}`,
    hideRequesterDetails ? null : `Requester: ${requesterName}`,
    hideRequesterDetails ? null : `Department: ${request.department_name || "Not assigned"}`,
    `Submission Date: ${formatDateTime(request.created_at)}`,
    occurredOn ? `${event.occurredAtLabel || "Activity Date"}: ${occurredOn}` : null,
    "",
    `${event.highlightLabel}: ${event.highlightValue}`,
    event.actionLabel ? `Required action: ${event.actionLabel}` : null,
    event.actorName ? `By: ${event.actorName}` : null,
    event.actorComment ? `Comment: ${stripHtml(event.actorComment)}` : null,
    "",
    `Review & Approve: ${requestUrl}`,
    "",
    "This is an automated email, do not reply.",
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

export class EmailNotificationService {
  private transporter: Transporter | null = null;
  private initialized = false;

  private logStatus(
    level: "info" | "warn" | "error",
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const payload = details ? ` ${JSON.stringify(details)}` : "";
    const line = `[email] ${message}${payload}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  private notificationsEnabled(): boolean {
    return process.env.EMAIL_NOTIFICATIONS_ENABLED !== "false";
  }

  private isEnabled(): boolean {
    if (!this.notificationsEnabled()) {
      return false;
    }

    return Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_PORT &&
        process.env.SMTP_FROM,
    );
  }

  private getTransporter(): Transporter | null {
    if (!this.isEnabled()) {
      return null;
    }

    if (!this.initialized) {
      const port = Number(process.env.SMTP_PORT || "587");
      this.logStatus("info", "initializing smtp transporter", {
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        hasAuth: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
      });
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
              }
            : undefined,
      });
      this.initialized = true;
    }

    return this.transporter;
  }

  private async getRequestContext(requestId: string): Promise<RequestContext | null> {
    const { rows } = await pool.query<RequestContext>(
      `SELECT
         ar.id,
         ar.request_number,
         ar.status,
         ar.current_step,
         ar.total_steps,
         ar.created_at::text,
         ar.updated_at::text,
         ar.form_data,
         at.name AS approval_type_name,
         at.description AS approval_type_description,
         d.name AS department_name,
         initiator.full_name AS initiator_name,
         initiator.email AS initiator_email,
         work_assignee.id AS work_assignee_id,
         work_assignee.full_name AS work_assignee_name,
         work_assignee.email AS work_assignee_email,
         ar.work_status,
         ar.work_completed_at::text,
         cs.company_name,
         cs.logo_url AS company_logo_url
       FROM approval_requests ar
       JOIN approval_types at ON at.id = ar.approval_type_id
       JOIN profiles initiator ON initiator.id = ar.initiator_id
       LEFT JOIN profiles work_assignee ON work_assignee.id = ar.work_assignee_id
       LEFT JOIN departments d ON d.id = ar.department_id
       LEFT JOIN company_settings cs ON true
       WHERE ar.id = $1
       LIMIT 1`,
      [requestId],
    );

    return rows[0] ?? null;
  }

  private async getPendingRecipients(requestId: string): Promise<PendingRecipient[]> {
    const { rows } = await pool.query<PendingRecipient>(
      `SELECT DISTINCT
         p.email,
         p.full_name,
         aa.step_order,
         aa.role_name,
         aa.action_label
       FROM approval_actions aa
       JOIN profiles p ON p.id = aa.approver_user_id
       WHERE aa.request_id = $1
         AND aa.status = 'pending'
         AND p.email IS NOT NULL
       ORDER BY aa.step_order, p.full_name NULLS LAST, p.email`,
      [requestId],
    );

    return rows;
  }

  private logPendingRecipientSummary(
    message: string,
    request: RequestContext,
    pendingRecipients: PendingRecipient[],
  ): void {
    this.logStatus("info", message, {
      requestId: request.id,
      requestNumber: request.request_number,
      pendingRecipientCount: pendingRecipients.length,
      pendingRecipients: pendingRecipients.map((recipient) => ({
        email: recipient.email,
        stepOrder: recipient.step_order,
        actionLabel: recipient.action_label || recipient.role_name,
      })),
    });
  }

  private async notifyPendingApprovers(args: {
    request: RequestContext;
    subject: string;
    event: Omit<EventSummary, "actionLabel">;
    emptyMessage: string;
  }): Promise<void> {
    const pendingRecipients = await this.getPendingRecipients(args.request.id);
    this.logPendingRecipientSummary(
      "resolved pending approval email recipients",
      args.request,
      pendingRecipients,
    );

    if (pendingRecipients.length === 0) {
      this.logStatus("warn", args.emptyMessage, {
        requestId: args.request.id,
        requestNumber: args.request.request_number,
        status: args.request.status,
        currentStep: args.request.current_step,
      });
      return;
    }

    for (const recipient of pendingRecipients) {
      await this.sendToRecipient({
        recipient,
        subject: args.subject,
        request: args.request,
        event: {
          ...args.event,
          actionLabel: recipient.action_label || recipient.role_name,
        },
        pendingRecipients: [recipient],
      });
    }
  }

  private async sendEmail(args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    requestNumber?: string;
  }): Promise<void> {
    if (!this.notificationsEnabled()) {
      this.logStatus("warn", "notifications disabled", {
        to: args.to,
        subject: args.subject,
        requestNumber: args.requestNumber,
      });
      return;
    }

    const transporter = this.getTransporter();
    if (!transporter) {
      const missing = [
        !process.env.SMTP_HOST ? "SMTP_HOST" : null,
        !process.env.SMTP_PORT ? "SMTP_PORT" : null,
        !process.env.SMTP_FROM ? "SMTP_FROM" : null,
      ].filter((value): value is string => value !== null);
      this.logStatus("warn", "smtp configuration incomplete", {
        to: args.to,
        subject: args.subject,
        requestNumber: args.requestNumber,
        missing,
      });
      return;
    }

    this.logStatus("info", "sending email", {
      to: args.to,
      subject: args.subject,
      requestNumber: args.requestNumber,
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    this.logStatus("info", "email sent", {
      to: args.to,
      subject: args.subject,
      requestNumber: args.requestNumber,
    });
  }

  private async sendToRecipient(args: {
    recipient: Recipient;
    subject: string;
    request: RequestContext;
    event: EventSummary;
    pendingRecipients?: PendingRecipient[];
  }): Promise<void> {
    if (!args.recipient.email) {
      this.logStatus("warn", "email recipient skipped because email is missing", {
        subject: args.subject,
        requestNumber: args.request.request_number,
      });
      return;
    }

    const requestUrl = buildRequestUrl(args.request.id);
    const fields = buildFieldRows(args.request.form_data);
    const recipientName =
      args.recipient.full_name?.trim() || args.recipient.email.trim();
    const hideRequesterDetails =
      Boolean(args.request.initiator_email) &&
      args.recipient.email.trim().toLowerCase() ===
        args.request.initiator_email?.trim().toLowerCase();

    await this.sendEmail({
      to: args.recipient.email,
      subject: args.subject,
      html: renderHtmlEmail({
        recipientName,
        request: args.request,
        event: args.event,
        fields,
        requestUrl,
        pendingRecipients: args.pendingRecipients,
        hideRequesterDetails,
      }),
      text: renderTextEmail({
        recipientName,
        request: args.request,
        event: args.event,
        fields,
        requestUrl,
        pendingRecipients: args.pendingRecipients,
        hideRequesterDetails,
      }),
      requestNumber: args.request.request_number,
    });
  }

  private async safeNotify(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      const smtpError = error as {
        code?: string;
        responseCode?: number;
        response?: string;
        message?: string;
      };

      if (
        smtpError.responseCode === 550 &&
        smtpError.response?.toLowerCase().includes("security check pending")
      ) {
        this.logStatus(
          "warn",
          "smtp provider is still reviewing the sender or domain",
          {
            responseCode: smtpError.responseCode,
            response: smtpError.response,
          },
        );
        return;
      }

      this.logStatus("error", "email notification failed", {
        code: smtpError.code,
        responseCode: smtpError.responseCode,
        response: smtpError.response,
        message: smtpError.message,
      });
    }
  }

  async notifyRequestSubmitted(requestId: string): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request) {
        this.logStatus("warn", "request submission notification skipped because request was not found", {
          requestId,
        });
        return;
      }

      this.logStatus("info", "processing request submitted notifications", {
        requestId,
        requestNumber: request.request_number,
      });

      await this.notifyPendingApprovers({
        request,
        subject: `Approval required: ${request.request_number}`,
        event: {
          heading: "A request is waiting for your approval",
          intro: "A new approval request has been assigned to you. Review the request details below and take action in the app.",
          highlightLabel: "Approval needed",
          highlightValue: request.request_number,
        },
        emptyMessage: "request submission notification skipped because no pending approver email recipients were found",
      });
    });
  }

  async notifyRequestApproved(
    requestId: string,
    actorName: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request) {
        this.logStatus("warn", "approval notification skipped because request was not found", {
          requestId,
        });
        return;
      }

      this.logStatus("info", "processing request approved notifications", {
        requestId,
        requestNumber: request.request_number,
        status: request.status,
      });

      if (request.status === "approved") {
        this.logStatus("info", "approval notification has no next approver because request is fully approved", {
          requestId,
          requestNumber: request.request_number,
        });
        return;
      }

      await this.notifyPendingApprovers({
        request,
        subject: `Approval required: ${request.request_number}`,
        event: {
          heading: "A request is waiting for your approval",
          intro: "The previous step was completed and this request is now assigned to you.",
          highlightLabel: "Next step ready",
          highlightValue: request.request_number,
          actorName,
          actorComment,
        },
        emptyMessage: "approval notification skipped because no next pending approver email recipients were found",
      });
    });
  }

  async notifyRequestRejected(
    requestId: string,
    actorName: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request || !request.initiator_email) {
        this.logStatus("warn", "rejection notification skipped because initiator email was not found", {
          requestId,
          hasRequest: Boolean(request),
        });
        return;
      }

      this.logStatus("info", "processing request rejected notification", {
        requestId,
        requestNumber: request.request_number,
        actorName,
      });

      await this.sendToRecipient({
        recipient: {
          email: request.initiator_email,
          full_name: request.initiator_name,
        },
        subject: `Request rejected: ${request.request_number}`,
        request,
        event: {
          heading: "Your request was rejected",
          intro: "An approver rejected your request. Review the latest activity and comments below.",
          highlightLabel: "Rejected request",
          highlightValue: request.request_number,
          actionLabel: "Review the rejection details",
          actorName,
          actorComment,
          occurredAt: request.updated_at,
          occurredAtLabel: "Rejection Date",
        },
      });
    });
  }

  async notifyWorkAssigned(
    requestId: string,
    actorName: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request || !request.work_assignee_email) {
        this.logStatus("warn", "work assignment notification skipped because assignee email was not found", {
          requestId,
          hasRequest: Boolean(request),
          workAssigneeId: request?.work_assignee_id,
        });
        return;
      }

      await this.sendToRecipient({
        recipient: {
          email: request.work_assignee_email,
          full_name: request.work_assignee_name,
        },
        subject: `Work assigned: ${request.request_number}`,
        request,
        event: {
          heading: "Approved request assigned to you",
          intro: "The request has been fully approved and the requested work has been assigned to you.",
          highlightLabel: "Assigned request",
          highlightValue: request.request_number,
          actionLabel: "Complete the requested work",
          actorName,
        },
      });
    });
  }

  async notifyRequestCompleted(
    requestId: string,
    actorName: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request || !request.initiator_email) {
        this.logStatus("warn", "work completion notification skipped because initiator email was not found", {
          requestId,
          hasRequest: Boolean(request),
        });
        return;
      }

      await this.sendToRecipient({
        recipient: {
          email: request.initiator_email,
          full_name: request.initiator_name,
        },
        subject: `Work completed: ${request.request_number}`,
        request,
        event: {
          heading: "Requested work has been completed",
          intro: "The assigned person marked this approved request as completed.",
          highlightLabel: "Completed request",
          highlightValue: request.request_number,
          actionLabel: request.work_assignee_name
            ? `Completed by ${request.work_assignee_name}`
            : "Completed",
          actorName,
          actorComment,
        },
      });
    });
  }

  async notifyWorkStatusUpdated(
    requestId: string,
    actorName: string,
    workStatus: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request || !request.initiator_email) {
        this.logStatus("warn", "work status notification skipped because initiator email was not found", {
          requestId,
          hasRequest: Boolean(request),
          workStatus,
        });
        return;
      }

      const statusLabel = formatStatusLabel(workStatus);
      const heading =
        workStatus === "done"
          ? "Requested work has been completed"
          : "Requested work status has been updated";
      const intro =
        workStatus === "done"
          ? "The assigned person marked this approved request as done."
          : `The assigned person updated the work status to ${statusLabel}.`;

      await this.sendToRecipient({
        recipient: {
          email: request.initiator_email,
          full_name: request.initiator_name,
        },
        subject: `Work update: ${request.request_number}`,
        request,
        event: {
          heading,
          intro,
          highlightLabel: "Work status",
          highlightValue: statusLabel,
          actionLabel: request.work_assignee_name
            ? `Updated by ${request.work_assignee_name}`
            : statusLabel,
          actorName,
          actorComment,
        },
      });
    });
  }

  async notifyChangesRequested(
    requestId: string,
    actorName: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request || !request.initiator_email) {
        this.logStatus("warn", "changes notification skipped because initiator email was not found", {
          requestId,
          hasRequest: Boolean(request),
        });
        return;
      }

      this.logStatus("info", "processing request changes notification", {
        requestId,
        requestNumber: request.request_number,
        actorName,
      });

      await this.sendToRecipient({
        recipient: {
          email: request.initiator_email,
          full_name: request.initiator_name,
        },
        subject: `Request updated by approver: ${request.request_number}`,
        request,
        event: {
          heading: "Your request was updated by an approver",
          intro: "An approver made changes to your request during review. Review the latest activity and request details below.",
          highlightLabel: "Request changes",
          highlightValue: request.request_number,
          actionLabel: "Review the updated request",
          actorName,
          actorComment,
          occurredAt: request.updated_at,
          occurredAtLabel: "Update Date",
        },
      });
    });
  }

  async notifyRequestResubmitted(requestId: string): Promise<void> {
    await this.safeNotify(async () => {
      const request = await this.getRequestContext(requestId);
      if (!request) {
        this.logStatus("warn", "resubmission notification skipped because request was not found", {
          requestId,
        });
        return;
      }

      this.logStatus("info", "processing request resubmitted notifications", {
        requestId,
        requestNumber: request.request_number,
      });

      await this.notifyPendingApprovers({
        request,
        subject: `Approval required: ${request.request_number}`,
        event: {
          heading: "A resubmitted request is waiting for your approval",
          intro: "The initiator updated the request and it is back in your queue for review.",
          highlightLabel: "Resubmitted approval",
          highlightValue: request.request_number,
        },
        emptyMessage: "resubmission notification skipped because no pending approver email recipients were found",
      });
    });
  }
}
