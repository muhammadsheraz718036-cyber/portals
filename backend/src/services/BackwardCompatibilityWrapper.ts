import { RefactoredApprovalService } from './RefactoredApprovalService.js';
import { DynamicApproverResolver } from './DynamicApproverResolver.js';
import { pool } from '../db.js';

export class BackwardCompatibilityWrapper {
  private refactoredService: RefactoredApprovalService;

  constructor() {
    const resolver = new DynamicApproverResolver();
    this.refactoredService = new RefactoredApprovalService(resolver);
  }

  /**
   * Get the refactored service (public accessor)
   */
  getRefactoredService(): RefactoredApprovalService {
    return this.refactoredService;
  }

  /**
   * Wrapper for existing create request API
   */
  async createRequestLegacy(userId: string, data: any): Promise<any> {
    // Convert legacy data format to new format
    const requestData = {
      title: data.title || data.name || 'Untitled Request',
      approval_type_id: data.approval_type_id,
      form_data: data.form_data || {},
      approval_chain_id: data.approval_chain_id,
      department_id: data.department_id
    };

    return await this.refactoredService.createRequest(userId, requestData);
  }

  /**
   * Wrapper for existing approve request API
   */
  async approveRequestLegacy(userId: string, requestId: string, comment?: string): Promise<any> {
    // Find the current pending step for this user
    const { rows } = await pool.query(
      `SELECT rs.id as step_id
       FROM request_steps rs
       JOIN approval_requests ar ON rs.request_id = ar.id
       WHERE rs.request_id = $1 
       AND rs.assigned_to = $2 
       AND rs.status IN ('PENDING', 'WAITING')
       ORDER BY rs.step_order ASC
       LIMIT 1`,
      [requestId, userId]
    );

    if (rows.length === 0) {
      throw new Error('No pending approval step found for this user');
    }

    return await this.refactoredService.processAction(userId, {
      request_id: requestId,
      step_id: rows[0].step_id,
      action: 'APPROVE',
      comment
    });
  }

  /**
   * Wrapper for existing reject request API
   */
  async rejectRequestLegacy(userId: string, requestId: string, comment?: string): Promise<any> {
    // Find the current pending step for this user
    const { rows } = await pool.query(
      `SELECT rs.id as step_id
       FROM request_steps rs
       JOIN approval_requests ar ON rs.request_id = ar.id
       WHERE rs.request_id = $1 
       AND rs.assigned_to = $2 
       AND rs.status IN ('PENDING', 'WAITING')
       ORDER BY rs.step_order ASC
       LIMIT 1`,
      [requestId, userId]
    );

    if (rows.length === 0) {
      throw new Error('No pending approval step found for this user');
    }

    return await this.refactoredService.processAction(userId, {
      request_id: requestId,
      step_id: rows[0].step_id,
      action: 'REJECT',
      comment
    });
  }

  /**
   * Wrapper for existing get requests API with department scoping
   */
  async getRequestsLegacy(userId: string, filters: any = {}): Promise<any> {
    return await this.refactoredService.getUserRequests(userId, {
      status: filters.status,
      department_id: filters.department_id,
      initiator_id: filters.initiator_id,
      page: filters.page,
      limit: filters.limit
    });
  }

  /**
   * Wrapper for existing get pending actions API
   */
  async getPendingActionsLegacy(userId: string): Promise<any[]> {
    const pendingActions = await this.refactoredService.getPendingActions(userId);
    
    // Convert to legacy format
    return pendingActions.map(action => ({
      id: action.step_id,
      request_id: action.request_id,
      step_order: action.step_order,
      role_name: 'Dynamic Approver', // This will be resolved dynamically
      action_label: action.action_label,
      status: 'pending',
      request: {
        id: action.request_id,
        request_number: action.request_number,
        title: action.title,
        initiator: {
          id: action.initiator_id,
          full_name: action.initiator_name
        },
        department: {
          id: action.request_department_id,
          name: action.department_name
        }
      },
      due_date: action.due_date
    }));
  }

  /**
   * Wrapper for existing get request details API
   */
  async getRequestDetailsLegacy(userId: string, requestId: string): Promise<any> {
    const request = await this.refactoredService.getRequestWithSteps(requestId);
    
    // Convert to legacy format
    return {
      ...request,
      actions: request.steps.map((step: any) => ({
        id: step.id,
        step_order: step.step_order,
        role_name: this.getLegacyRoleName(step),
        action_label: step.action_label,
        status: this.getLegacyStatus(step.status),
        acted_by: step.acted_by ? {
          id: step.acted_by,
          full_name: step.assigned_name
        } : null,
        comment: step.remarks,
        acted_at: step.completed_at,
        assigned_to: step.assigned_to ? {
          id: step.assigned_to,
          full_name: step.assigned_name,
          email: step.assigned_email
        } : null
      }))
    };
  }

  /**
   * Legacy compatibility for approval_actions table
   */
  async getApprovalActionsLegacy(requestId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT * FROM approval_actions_view WHERE request_id = $1 ORDER BY step_order ASC`,
      [requestId]
    );

    return rows;
  }

  /**
   * Check if user can approve a request (legacy compatibility)
   */
  async canUserApproveRequest(userId: string, requestId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1
       FROM request_steps rs
       WHERE rs.request_id = $1 
       AND rs.assigned_to = $2 
       AND rs.status IN ('PENDING', 'WAITING')
       LIMIT 1`,
      [requestId, userId]
    );

    return rows.length > 0;
  }

  /**
   * Get user's role-based permissions (enhanced with department scoping)
   */
  async getUserRolePermissions(userId: string): Promise<any> {
    const { rows } = await pool.query(
      `SELECT p.id, p.full_name, p.email, p.department_id, p.is_admin, 
              r.name as role_name, r.permissions
       FROM profiles p
       LEFT JOIN roles r ON p.role_id = r.id
       WHERE p.id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const user = rows[0];
    
    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      department_id: user.department_id,
      is_admin: user.is_admin,
      role_name: user.role_name,
      permissions: user.permissions || [],
      // Enhanced: Add department-specific permissions
      can_approve_department_requests: user.department_id ? true : false,
      is_department_manager: await this.isDepartmentManager(userId, user.department_id)
    };
  }

  /**
   * Helper method to check if user is department manager
   */
  private async isDepartmentManager(userId: string, departmentId: string | null): Promise<boolean> {
    if (!departmentId) return false;

    const { rows } = await pool.query(
      `SELECT 1 FROM department_managers 
       WHERE user_id = $1 AND department_id = $2 AND is_active = true`,
      [userId, departmentId]
    );

    return rows.length > 0;
  }

  /**
   * Convert new status format to legacy format
   */
  private getLegacyStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'WAITING': 'waiting',
      'PENDING': 'pending',
      'APPROVED': 'approved',
      'REJECTED': 'rejected',
      'CHANGES_REQUESTED': 'changes_requested',
      'SKIPPED': 'skipped'
    };

    return statusMap[status] || status.toLowerCase();
  }

  /**
   * Get legacy role name from step
   */
  private getLegacyRoleName(step: any): string {
    switch (step.actor_type) {
      case 'ROLE':
        return step.actor_value || 'Unknown Role';
      case 'DEPARTMENT_MANAGER':
        return 'Department Manager';
      case 'USER_MANAGER':
        return 'User Manager';
      case 'SPECIFIC_USER':
        return 'Specific User';
      default:
        return 'Unknown Role';
    }
  }

  /**
   * Migrate existing data to new format (can be called manually)
   */
  async migrateExistingData(): Promise<void> {
    console.log('Starting data migration...');
    
    try {
      // This would call the migration functions from the SQL file
      await pool.query('SELECT migrate_approval_chains()');
      await pool.query('SELECT migrate_approval_actions()');
      
      console.log('Data migration completed successfully');
    } catch (error) {
      console.error('Data migration failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<any> {
    const { rows: chainCount } = await pool.query(
      'SELECT COUNT(*) as count FROM approval_chains WHERE jsonb_array_length(steps) > 0'
    );
    
    const { rows: stepCount } = await pool.query(
      'SELECT COUNT(*) as count FROM approval_steps'
    );
    
    const { rows: actionCount } = await pool.query(
      'SELECT COUNT(*) as count FROM approval_actions'
    );
    
    const { rows: requestStepCount } = await pool.query(
      'SELECT COUNT(*) as count FROM request_steps'
    );

    return {
      legacy_chains_with_steps: parseInt(chainCount[0].count),
      migrated_steps: parseInt(stepCount[0].count),
      legacy_actions: parseInt(actionCount[0].count),
      migrated_request_steps: parseInt(requestStepCount[0].count),
      migration_complete: parseInt(stepCount[0].count) > 0 && parseInt(requestStepCount[0].count) > 0
    };
  }
}
