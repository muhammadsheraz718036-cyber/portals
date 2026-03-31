import { BaseService } from '../base/BaseService';
import { 
  ApprovalChain, 
  CreateApprovalChainRequest, 
  UpdateApprovalChainRequest 
} from '../types';
import { api } from '../../lib/api';

export class ApprovalChainService extends BaseService {
  async list(): Promise<ApprovalChain[]> {
    return this.handleRequest(() => 
      api.approvalChains.list() as Promise<ApprovalChain[]>
    );
  }

  async get(id: string): Promise<ApprovalChain> {
    return this.handleRequest(() => 
      api.approvalChains.list().then(chains => 
        (chains as ApprovalChain[]).find((chain: ApprovalChain) => chain.id === id)
      ).then(chain => {
        if (!chain) throw new Error('Approval chain not found');
        return chain;
      })
    );
  }

  async create(data: CreateApprovalChainRequest): Promise<ApprovalChain> {
    return this.handleRequest(() => 
      api.approvalChains.create(data) as Promise<ApprovalChain>
    );
  }

  async update(id: string, data: UpdateApprovalChainRequest): Promise<ApprovalChain> {
    return this.handleRequest(() => 
      api.approvalChains.update(id, data) as Promise<ApprovalChain>
    );
  }

  async delete(id: string): Promise<void> {
    return this.handleRequest(async () => {
      await api.approvalChains.delete(id);
    });
  }
}
