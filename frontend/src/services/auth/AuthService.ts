import { BaseService } from '../base/BaseService';
import { 
  LoginRequest, 
  LoginResponse, 
  SetupRequest, 
  AuthUser, 
  Profile, 
  UpdatePasswordRequest,
  UpdateProfileRequest 
} from '../types';
import { api } from '../../lib/api';

export class AuthService extends BaseService {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    return this.handleRequest(() => 
      api.auth.login(credentials)
    );
  }

  async getMe(): Promise<{ user: AuthUser; profile: Profile }> {
    return this.handleRequest(() => 
      api.auth.me()
    );
  }

  async updatePassword(data: UpdatePasswordRequest): Promise<{ success: boolean }> {
    return this.handleRequest(() => 
      api.auth.updatePassword(data)
    );
  }

  async updateProfile(data: UpdateProfileRequest): Promise<{ profile: Profile }> {
    return this.handleRequest(() => 
      api.auth.updateProfile(data)
    );
  }

  async setup(data: SetupRequest): Promise<LoginResponse> {
    return this.handleRequest(() => 
      api.setup.complete(data)
    );
  }

  async getSetupStatus(): Promise<{ hasUsers: boolean }> {
    return this.handleRequest(() => 
      api.setup.status()
    );
  }
}
