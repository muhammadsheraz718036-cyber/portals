import { BaseService } from '../base/BaseService';
import { 
  ApprovalType, 
  CreateApprovalTypeRequest, 
  UpdateApprovalTypeRequest 
} from '../types';
import { api } from '../../lib/api';

export class ApprovalTypeService extends BaseService {
  async list(): Promise<ApprovalType[]> {
    return this.handleRequest(() => 
      api.approvalTypes.list() as Promise<ApprovalType[]>
    );
  }

  async get(id: string): Promise<ApprovalType> {
    return this.handleRequest(() => 
      api.approvalTypes.list().then(types => 
        (types as ApprovalType[]).find((type: ApprovalType) => type.id === id)
      ).then(type => {
        if (!type) throw new Error('Approval type not found');
        return type;
      })
    );
  }

  async create(data: CreateApprovalTypeRequest): Promise<ApprovalType> {
    return this.handleRequest(() => 
      api.approvalTypes.create(data) as Promise<ApprovalType>
    );
  }

  async update(id: string, data: UpdateApprovalTypeRequest): Promise<ApprovalType> {
    return this.handleRequest(() => 
      api.approvalTypes.update(id, data) as Promise<ApprovalType>
    );
  }

  async delete(id: string): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalTypes.delete(id);
    });
  }
}
