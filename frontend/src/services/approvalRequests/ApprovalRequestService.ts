import { BaseService } from '../base/BaseService';
import { 
  ApprovalRequest, 
  ApprovalRequestAction,
  CreateApprovalRequestRequest, 
  UpdateApprovalRequestRequest,
  ApprovalActionRequest
} from '../types';
import { api } from '../../lib/api';

export class ApprovalRequestService extends BaseService {
  async list(): Promise<ApprovalRequest[]> {
    return this.handleRequest(() => 
      api.approvalRequests.list() as Promise<ApprovalRequest[]>
    );
  }

  async get(id: string): Promise<{
    request: ApprovalRequest;
    actions: ApprovalRequestAction[];
    actorNames: Record<string, string>;
  }> {
    return this.handleRequest(() => 
      api.approvalRequests.get(id) as unknown as Promise<{
        request: ApprovalRequest;
        actions: ApprovalRequestAction[];
        actorNames: Record<string, string>;
      }>
    );
  }

  async create(data: CreateApprovalRequestRequest): Promise<ApprovalRequest> {
    return this.handleRequest(() => 
      api.approvalRequests.create(data) as Promise<ApprovalRequest>
    );
  }

  async update(id: string, data: UpdateApprovalRequestRequest): Promise<ApprovalRequest> {
    return this.handleRequest(() => 
      api.approvalRequests.update(id, data) as Promise<ApprovalRequest>
    );
  }

  async delete(id: string): Promise<{ success: boolean }> {
    return this.handleRequest(() =>
      api.approvalRequests.delete(id)
    );
  }

  async approve(id: string, data: ApprovalActionRequest): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalRequests.approve(id, data);
    });
  }

  async reject(id: string, data: ApprovalActionRequest): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalRequests.reject(id, data);
    });
  }

  async requestChanges(id: string, data: ApprovalActionRequest): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalRequests.requestChanges(id, data);
    });
  }

  async resolveNumber(requestNumber: string): Promise<{ id: string }> {
    return this.handleRequest(() => 
      api.approvalRequests.resolveNumber(requestNumber) as Promise<{ id: string }>
    );
  }
}
