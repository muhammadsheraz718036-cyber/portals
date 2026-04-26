import { BaseService } from '../base/BaseService';
import { 
  Profile, 
  CreateUserRequest, 
  UpdateUserRequest 
} from '../types';
import { api } from '../../lib/api';

export class AdminService extends BaseService {
  async createUser(data: CreateUserRequest): Promise<{
    id: string;
    email: string;
    profile: Profile;
  }> {
    return this.handleRequest(() => 
      api.admin.createUser(data)
    );
  }

  async updateUser(userId: string, data: UpdateUserRequest): Promise<{
    profile: Profile;
  }> {
    return this.handleRequest(() => 
      api.admin.updateUser(userId, data)
    );
  }

  async deleteUser(userId: string): Promise<{ success: boolean }> {
    return this.handleRequest(() => 
      api.admin.deleteUser(userId)
    );
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<{ success: boolean }> {
    return this.handleRequest(() => 
      api.admin.resetUserPassword(userId, newPassword)
    );
  }

  async uploadUserSignature(userId: string, file: File): Promise<{
    profile: Profile;
  }> {
    return this.handleRequest(() => api.admin.uploadUserSignature(userId, file));
  }
}
