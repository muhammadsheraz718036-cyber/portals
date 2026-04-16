import { BaseService } from '../base/BaseService';
import { 
  Department, 
  CreateDepartmentRequest, 
  UpdateDepartmentRequest 
} from '../types';
import { api } from '../../lib/api';

export class DepartmentService extends BaseService {
  async list(): Promise<Department[]> {
    return this.handleRequest(() => 
      api.departments.list() as Promise<Department[]>
    );
  }

  async get(id: string): Promise<Department> {
    return this.handleRequest(() => 
      api.departments.list().then(departments => 
        (departments as Department[]).find((dept: Department) => dept.id === id)
      ).then(dept => {
        if (!dept) throw new Error('Department not found');
        return dept;
      })
    );
  }

  async create(data: CreateDepartmentRequest): Promise<Department> {
    return this.handleRequest(() => 
      api.departments.create(data) as Promise<Department>
    );
  }

  async update(id: string, data: UpdateDepartmentRequest): Promise<Department> {
    return this.handleRequest(() => 
      api.departments.update(id, data) as Promise<Department>
    );
  }

  async delete(id: string): Promise<void> {
    return this.handleRequest(async () => {
      await api.departments.delete(id);
    });
  }

  async getManagers(departmentId: string): Promise<any[]> {
    return this.handleRequest(() => 
      api.departments.getManagers(departmentId) as Promise<any[]>
    );
  }

  async addManager(departmentId: string, userId: string): Promise<{ success: boolean }> {
    return this.handleRequest(() => 
      api.departments.addManager(departmentId, userId) as Promise<{ success: boolean }>
    );
  }

  async removeManager(departmentId: string, userId: string): Promise<{ success: boolean }> {
    return this.handleRequest(() => 
      api.departments.removeManager(departmentId, userId) as Promise<{ success: boolean }>
    );
  }
}
