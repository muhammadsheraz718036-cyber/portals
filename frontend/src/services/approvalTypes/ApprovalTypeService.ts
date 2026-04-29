import { BaseService } from "../base/BaseService";
import {
  ApprovalType,
  CreateApprovalTypeRequest,
  UpdateApprovalTypeRequest,
  ApprovalTypeAttachment,
  CreateApprovalTypeAttachmentRequest,
  UpdateApprovalTypeAttachmentRequest,
} from "../types";
import { api, request } from "../../lib/api";

export class ApprovalTypeService extends BaseService {
  async list(departmentId?: string): Promise<ApprovalType[]> {
    return this.handleRequest(
      () => api.approvalTypes.list(departmentId) as Promise<ApprovalType[]>,
    );
  }

  async get(id: string): Promise<ApprovalType> {
    return this.handleRequest(() =>
      api.approvalTypes
        .list()
        .then((types) =>
          (types as ApprovalType[]).find(
            (type: ApprovalType) => type.id === id,
          ),
        )
        .then((type) => {
          if (!type) throw new Error("Approval type not found");
          return type;
        }),
    );
  }

  async create(data: CreateApprovalTypeRequest): Promise<ApprovalType> {
    return this.handleRequest(
      () => api.approvalTypes.create(data) as Promise<ApprovalType>,
    );
  }

  async update(
    id: string,
    data: UpdateApprovalTypeRequest,
  ): Promise<ApprovalType> {
    return this.handleRequest(
      () => api.approvalTypes.update(id, data) as Promise<ApprovalType>,
    );
  }

  async delete(id: string): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalTypes.delete(id);
    });
  }

  // File attachment methods
  async getAttachments(
    approvalTypeId: string,
  ): Promise<ApprovalTypeAttachment[]> {
    return this.handleRequest(() =>
      request<ApprovalTypeAttachment[]>(
        `/api/approval-types/${approvalTypeId}/attachments`,
      ),
    );
  }

  async createAttachment(
    approvalTypeId: string,
    data: CreateApprovalTypeAttachmentRequest,
  ): Promise<ApprovalTypeAttachment> {
    return this.handleRequest(() =>
      request<ApprovalTypeAttachment>(
        `/api/approval-types/${approvalTypeId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    );
  }

  async updateAttachment(
    approvalTypeId: string,
    attachmentId: string,
    data: UpdateApprovalTypeAttachmentRequest,
  ): Promise<ApprovalTypeAttachment> {
    return this.handleRequest(() =>
      request<ApprovalTypeAttachment>(
        `/api/approval-types/${approvalTypeId}/attachments/${attachmentId}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        },
      ),
    );
  }

  async deleteAttachment(
    approvalTypeId: string,
    attachmentId: string,
  ): Promise<void> {
    return this.handleRequest(() =>
      request(
        `/api/approval-types/${approvalTypeId}/attachments/${attachmentId}`,
        {
          method: "DELETE",
        },
      ),
    );
  }

  async uploadTemplateFile(
    approvalTypeId: string,
    attachmentId: string,
    file: File,
  ): Promise<ApprovalTypeAttachment> {
    const formData = new FormData();
    formData.append("file", file);

    return this.handleRequest(() =>
      fetch(
        `/api/approval-types/${approvalTypeId}/attachments/${attachmentId}/template`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("ac_token")}`,
          },
          body: formData,
        },
      ).then(async (res) => {
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) {
          throw new Error(data?.error || data?.message || "Template upload failed");
        }
        return data as ApprovalTypeAttachment;
      }),
    );
  }

  async deleteTemplateFile(
    approvalTypeId: string,
    attachmentId: string,
  ): Promise<void> {
    return this.handleRequest(() =>
      request(
        `/api/approval-types/${approvalTypeId}/attachments/${attachmentId}/template`,
        { method: "DELETE" },
      ),
    );
  }

  async downloadTemplateFile(attachmentId: string): Promise<Blob> {
    return this.handleRequest(() =>
      fetch(`/api/approval-type-attachments/${attachmentId}/template/download`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("ac_token")}`,
        },
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          const data = text ? JSON.parse(text) : null;
          throw new Error(data?.error || data?.message || "Template download failed");
        }
        return res.blob();
      }),
    );
  }

  async previewTemplateFile(attachmentId: string): Promise<Blob> {
    return this.handleRequest(() =>
      fetch(`/api/approval-type-attachments/${attachmentId}/template/preview`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("ac_token")}`,
        },
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          const data = text ? JSON.parse(text) : null;
          throw new Error(data?.error || data?.message || "Template preview failed");
        }
        return res.blob();
      }),
    );
  }

  getTemplateDownloadUrl(attachmentId: string): string {
    return `/api/approval-type-attachments/${attachmentId}/template/download`;
  }
}
