import { BaseService } from '../base/BaseService';
import { 
  Role, 
  CreateRoleRequest, 
  UpdateRoleRequest 
} from '../types';
import { api } from '../../lib/api';

export class RoleService extends BaseService {
  async list(): Promise<Role[]> {
    return this.handleRequest(() => 
      api.roles.list() as Promise<Role[]>
    );
  }

  async get(id: string): Promise<Role> {
    return this.handleRequest(() => 
      api.roles.list().then(roles => 
        (roles as Role[]).find((role: Role) => role.id === id)
      ).then(role => {
        if (!role) throw new Error('Role not found');
        return role;
      })
    );
  }

  async create(data: CreateRoleRequest): Promise<Role> {
    return this.handleRequest(() => 
      api.roles.create(data) as Promise<Role>
    );
  }

  async update(id: string, data: UpdateRoleRequest): Promise<Role> {
    return this.handleRequest(() => 
      api.roles.update(id, data) as Promise<Role>
    );
  }

  async delete(id: string): Promise<void> {
    return this.handleRequest(async () => {
      await api.roles.delete(id);
    });
  }
}
