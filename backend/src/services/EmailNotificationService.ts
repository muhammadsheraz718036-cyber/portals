import nodemailer, { type Transporter } from "nodemailer";
import { pool } from "../db.js";

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
};

type EventSummary = {
  heading: string;
  intro: string;
  highlightLabel: string;
  highlightValue: string;
  actionLabel?: string | null;
  actorName?: string | null;
  actorComment?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function isGroupedItems(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

function buildGroupedItemRows(items: Array<Record<string, unknown>>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  for (const item of items) {
    const group = String(item.__group || "General");
    for (const [key, value] of Object.entries(item)) {
      if (key === "id" || key === "__group") {
        continue;
      }
      rows.push({
        label: `${group} - ${startCase(key)}`,
        value: formatFieldValue(value),
      });
    }
  }

  return rows;
}

function formatStatusLabel(status: string): string {
  return startCase(status);
}

function buildRequestUrl(requestId: string): string {
  const baseUrl = (
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_APP_URL ||
    `http://localhost:${process.env.PORT || "4000"}`
  ).replace(/\/+$/, "");

  return `${baseUrl}/approvals/${requestId}`;
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

function buildFieldRows(formData: Record<string, unknown> | null): Array<{ label: string; value: string }> {
  if (!formData || typeof formData !== "object") {
    return [];
  }

  return Object.entries(formData).flatMap(([key, value]) => {
    if (value === undefined) {
      return [];
    }

    if (key === "items" && isGroupedItems(value)) {
      return buildGroupedItemRows(value);
    }

    return [{
      label: startCase(key),
      value: formatFieldValue(value),
    }];
  });
}

function renderHtmlEmail(args: {
  recipientName: string;
  request: RequestContext;
  event: EventSummary;
  fields: Array<{ label: string; value: string }>;
  requestUrl: string;
  pendingRecipients?: PendingRecipient[];
}): string {
  const { recipientName, request, event, fields, requestUrl, pendingRecipients = [] } = args;
  const companyName = request.company_name?.trim() || "Approval Central";

  const detailRows = [
    ["Request Number", request.request_number],
    ["Approval Type", request.approval_type_name],
    ["Current Status", formatStatusLabel(request.status)],
    ["Department", request.department_name || "Not assigned"],
    ["Initiated By", request.initiator_name || request.initiator_email || "Unknown"],
    ["Submitted On", formatDateTime(request.created_at)],
    ["Current Step", `${request.current_step} of ${request.total_steps}`],
  ];

  const pendingHtml =
    pendingRecipients.length > 0
      ? `
        <div style="margin-top:24px;">
          <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a;">Current approvers</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th align="left" style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;">Step</th>
                <th align="left" style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;">Reviewer</th>
                <th align="left" style="padding:10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;text-transform:uppercase;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${pendingRecipients
                .map(
                  (recipient) => `
                    <tr>
                      <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${recipient.step_order}</td>
                      <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(recipient.full_name || recipient.email)}</td>
                      <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(recipient.action_label || recipient.role_name)}</td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`
      : "";

  const fieldsHtml =
    fields.length > 0
      ? `
        <div style="margin-top:24px;">
          <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a;">Request details</h3>
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tbody>
              ${fields
                .map(
                  (field) => `
                    <tr>
                      <td valign="top" style="width:35%;padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#334155;">${escapeHtml(field.label)}</td>
                      <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#0f172a;white-space:pre-wrap;">${escapeHtml(field.value)}</td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`
      : "";

  const actorHtml =
    event.actorName || event.actorComment
      ? `
        <div style="margin-top:24px;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="font-size:13px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.04em;">Latest activity</div>
          ${event.actorName ? `<div style="margin-top:8px;color:#0f172a;"><strong>By:</strong> ${escapeHtml(event.actorName)}</div>` : ""}
          ${event.actorComment ? `<div style="margin-top:8px;color:#0f172a;white-space:pre-wrap;"><strong>Comment:</strong> ${escapeHtml(event.actorComment)}</div>` : ""}
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:760px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#0f172a,#1d4ed8);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">${escapeHtml(companyName)}</div>
          <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.2;">${escapeHtml(event.heading)}</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;opacity:0.92;">${escapeHtml(event.intro)}</p>
        </div>

        <div style="padding:28px 32px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Hello ${escapeHtml(recipientName)},</p>

          <div style="padding:18px 20px;border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;">
            <div style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(event.highlightLabel)}</div>
            <div style="margin-top:6px;font-size:20px;font-weight:700;color:#0f172a;">${escapeHtml(event.highlightValue)}</div>
            ${event.actionLabel ? `<div style="margin-top:6px;font-size:14px;color:#334155;">Required action: ${escapeHtml(event.actionLabel)}</div>` : ""}
          </div>

          <div style="margin-top:24px;">
            <h3 style="margin:0 0 12px;font-size:16px;color:#0f172a;">Request summary</h3>
            <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tbody>
                ${detailRows
                  .map(
                    ([label, value]) => `
                      <tr>
                        <td valign="top" style="width:35%;padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#334155;">${escapeHtml(label)}</td>
                        <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(value)}</td>
                      </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>

          ${actorHtml}
          ${pendingHtml}
          ${fieldsHtml}

          <div style="margin-top:28px;">
            <a href="${escapeHtml(requestUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;">
              Open Request
            </a>
          </div>

          <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
            This message was sent because this approval item is linked to the email address on your account.
          </p>
        </div>
      </div>
    </div>
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
}): string {
  const { recipientName, request, event, fields, requestUrl, pendingRecipients = [] } = args;

  const lines = [
    `${event.heading}`,
    "",
    `Hello ${recipientName},`,
    "",
    event.intro,
    "",
    `${event.highlightLabel}: ${event.highlightValue}`,
    event.actionLabel ? `Required action: ${event.actionLabel}` : null,
    "",
    `Request Number: ${request.request_number}`,
    `Approval Type: ${request.approval_type_name}`,
    `Current Status: ${formatStatusLabel(request.status)}`,
    `Department: ${request.department_name || "Not assigned"}`,
    `Initiated By: ${request.initiator_name || request.initiator_email || "Unknown"}`,
    `Submitted On: ${formatDateTime(request.created_at)}`,
    `Current Step: ${request.current_step} of ${request.total_steps}`,
    event.actorName ? `Latest activity by: ${event.actorName}` : null,
    event.actorComment ? `Comment: ${event.actorComment}` : null,
    pendingRecipients.length > 0 ? "" : null,
    pendingRecipients.length > 0 ? "Current approvers:" : null,
    ...pendingRecipients.map(
      (recipient) =>
        `- Step ${recipient.step_order}: ${recipient.full_name || recipient.email} (${recipient.action_label || recipient.role_name})`,
    ),
    fields.length > 0 ? "" : null,
    fields.length > 0 ? "Request details:" : null,
    ...fields.map((field) => `- ${field.label}: ${field.value}`),
    "",
    `Open request: ${requestUrl}`,
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
         cs.company_name
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
      this.logStatus("warn", "smtp configuration incomplete", {
        to: args.to,
        subject: args.subject,
        requestNumber: args.requestNumber,
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
      return;
    }

    const requestUrl = buildRequestUrl(args.request.id);
    const fields = buildFieldRows(args.request.form_data);
    const recipientName =
      args.recipient.full_name?.trim() || args.recipient.email.trim();

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
      }),
      text: renderTextEmail({
        recipientName,
        request: args.request,
        event: args.event,
        fields,
        requestUrl,
        pendingRecipients: args.pendingRecipients,
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

      const pendingRecipients = await this.getPendingRecipients(requestId);

      for (const recipient of pendingRecipients) {
        await this.sendToRecipient({
          recipient,
          subject: `Approval required: ${request.request_number}`,
          request,
          event: {
            heading: "A request is waiting for your approval",
            intro: "A new approval item has been assigned to you. Review the request details below and take action in the app.",
            highlightLabel: "Approval needed",
            highlightValue: request.request_number,
            actionLabel: recipient.action_label || recipient.role_name,
          },
          pendingRecipients: [recipient],
        });
      }
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

      const pendingRecipients = await this.getPendingRecipients(requestId);

      if (pendingRecipients.length > 0) {
        for (const recipient of pendingRecipients) {
          await this.sendToRecipient({
            recipient,
            subject: `Approval required: ${request.request_number}`,
            request,
            event: {
              heading: "A request is waiting for your approval",
              intro: "The previous step was completed and this request is now assigned to you.",
              highlightLabel: "Next step ready",
              highlightValue: request.request_number,
              actionLabel: recipient.action_label || recipient.role_name,
              actorName,
              actorComment,
            },
            pendingRecipients: [recipient],
          });
        }
      }
    });
  }

  async notifyRequestRejected(
    requestId: string,
    actorName: string,
    actorComment?: string,
  ): Promise<void> {
    await this.safeNotify(async () => {
      this.logStatus("info", "request rejected notification skipped for initiator", {
        requestId,
        actorName,
        actorComment,
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
      this.logStatus("info", "changes-requested notification skipped for initiator", {
        requestId,
        actorName,
        actorComment,
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

      const pendingRecipients = await this.getPendingRecipients(requestId);

      for (const recipient of pendingRecipients) {
        await this.sendToRecipient({
          recipient,
          subject: `Approval required: ${request.request_number}`,
          request,
          event: {
            heading: "A resubmitted request is waiting for your approval",
            intro: "The initiator updated the request and it is back in your queue for review.",
            highlightLabel: "Resubmitted approval",
            highlightValue: request.request_number,
            actionLabel: recipient.action_label || recipient.role_name,
          },
          pendingRecipients: [recipient],
        });
      }
    });
  }
}
