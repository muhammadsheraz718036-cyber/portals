import { BaseService } from '../base/BaseService';
import { AuditLog } from '../types';
import { api } from '../../lib/api';

export class AuditService extends BaseService {
  async list(): Promise<AuditLog[]> {
    return this.handleRequest(() => 
      api.auditLogs.list() as Promise<AuditLog[]>
    );
  }
}
