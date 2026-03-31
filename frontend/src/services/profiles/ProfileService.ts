import { BaseService } from '../base/BaseService';
import { Profile } from '../types';
import { api } from '../../lib/api';

export class ProfileService extends BaseService {
  async list(): Promise<Profile[]> {
    return this.handleRequest(() => 
      api.profiles.list() as Promise<Profile[]>
    );
  }

  async get(id: string): Promise<{
    id: string;
    full_name: string;
    email: string;
    department_id: string | null;
    role_id: string | null;
    department_name: string | null;
    role_name: string | null;
  }> {
    return this.handleRequest(() => 
      api.profiles.get(id)
    );
  }

  async lookupNames(ids: string[]): Promise<Record<string, string>> {
    return this.handleRequest(() => 
      api.profiles.lookupNames(ids)
    );
  }
}
