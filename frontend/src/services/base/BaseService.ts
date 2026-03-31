import { QueryKey } from '@tanstack/react-query';

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export abstract class BaseService {
  protected getQueryKey(...args: unknown[]): QueryKey {
    return [this.constructor.name.replace('Service', '').toLowerCase(), ...args];
  }

  protected getDetailQueryKey(id: string, ...args: unknown[]): QueryKey {
    return [this.constructor.name.replace('Service', '').toLowerCase(), id, ...args];
  }

  protected handleApiError(error: unknown): never {
    const message = (error as { message?: string; error?: string })?.message || 
                   (error as { message?: string; error?: string })?.error || 
                   'An unexpected error occurred';
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }

  protected async handleRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      this.handleApiError(error);
    }
  }
}
