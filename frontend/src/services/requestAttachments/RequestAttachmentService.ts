import { BaseService } from '../base/BaseService';
import { RequestAttachment } from '../types';
import { request } from '../../lib/api';

export class RequestAttachmentService extends BaseService {
  async getAttachments(requestId: string): Promise<RequestAttachment[]> {
    return this.handleRequest(() => 
      request<RequestAttachment[]>(`/api/requests/${requestId}/attachments`)
    );
  }

  async uploadFiles(requestId: string, fieldName: string, files: File[]): Promise<RequestAttachment[]> {
    const formData = new FormData();
    formData.append('field_name', fieldName);
    
    files.forEach(file => {
      formData.append('files', file);
    });

    return this.handleRequest(() => 
      fetch(`/api/requests/${requestId}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('ac_token')}`,
        },
        body: formData
      }).then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(text || 'Upload failed');
          });
        }
        return res.json() as Promise<RequestAttachment[]>;
      })
    );
  }

  async downloadFile(attachmentId: string): Promise<Blob> {
    return this.handleRequest(() => 
      fetch(`/api/attachments/${attachmentId}/download`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('ac_token')}`,
        }
      }).then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(text || 'Download failed');
          });
        }
        return res.blob();
      })
    );
  }

  async previewFile(attachmentId: string): Promise<Blob> {
    return this.handleRequest(() =>
      fetch(`/api/attachments/${attachmentId}/preview`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('ac_token')}`,
        }
      }).then(res => {
        if (!res.ok) {
          return res.text().then(text => {
            throw new Error(text || 'Preview failed');
          });
        }
        return res.blob();
      })
    );
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    return this.handleRequest(() => 
      request(`/api/attachments/${attachmentId}`, {
        method: 'DELETE'
      })
    );
  }

  getDownloadUrl(attachmentId: string): string {
    return `/api/attachments/${attachmentId}/download`;
  }
}
