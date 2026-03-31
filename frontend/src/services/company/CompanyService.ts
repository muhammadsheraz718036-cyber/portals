import { BaseService } from '../base/BaseService';
import { 
  CompanySettings, 
  UpdateCompanySettingsRequest 
} from '../types';
import { api } from '../../lib/api';

export class CompanyService extends BaseService {
  async get(): Promise<CompanySettings | null> {
    return this.handleRequest(() => 
      api.companySettings.get()
    );
  }

  async update(data: UpdateCompanySettingsRequest): Promise<CompanySettings> {
    return this.handleRequest(() => 
      api.companySettings.update(data) as Promise<CompanySettings>
    );
  }
}
