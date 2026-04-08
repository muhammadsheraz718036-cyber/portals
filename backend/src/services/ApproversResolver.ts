import { pool } from '../db.js';

export interface StepDefinition {
  id?: string;
  step_order: number;
  name: string;
  description?: string;
  actor_type: 'ROLE' | 'USER_MANAGER' | 'DEPARTMENT_MANAGER' | 'SPECIFIC_USER';
  actor_value?: string;
  role_id?: string; // DEPRECATED: for backward compatibility
  user_id?: string; // DEPRECATED: for backward compatibility
  action_label: string;
  due_days?: number;
}

export interface RequestDefinition {
  id: string;
  initiator_id: string;
  department_id?: string;
  approval_chain_id?: string;
  status: string;
  current_step: number;
}

export interface ApproverAssignment {
  user_id: string;
  full_name: string;
  email: string;
  department_id?: string;
  role_name?: string;
  assignment_type: 'ROLE' | 'USER_MANAGER' | 'DEPARTMENT_MANAGER' | 'SPECIFIC_USER';
  fallback_used?: boolean;
}

export interface ResolverResult {
  success: boolean;
  approvers: ApproverAssignment[];
  error?: string;
  warnings?: string[];
}

export class ApproversResolver {
  /**
   * Resolve approvers for a given step and request
   */
  async resolveApprovers(step: StepDefinition, request: RequestDefinition): Promise<ResolverResult> {
    const warnings: string[] = [];
    
    try {
      // Handle deprecated columns for backward compatibility
      const actorType = step.actor_type || this.inferActorTypeFromDeprecated(step);
      const actorValue = step.actor_value || this.getActorValueFromDeprecated(step);

      switch (actorType) {
        case 'USER_MANAGER':
          return await this.resolveUserManager(request, warnings);
          
        case 'DEPARTMENT_MANAGER':
          return await this.resolveDepartmentManager(request, warnings);
          
        case 'SPECIFIC_USER':
          return await this.resolveSpecificUser(actorValue, warnings);
          
        case 'ROLE':
        default:
          return await this.resolveByRole(actorValue, request.department_id, warnings);
      }
      
    } catch (error) {
      console.error('Error resolving approvers:', error);
      return {
        success: false,
        approvers: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers by role (department-scoped)
   */
  private async resolveByRole(
    roleName: string | undefined, 
    departmentId: string | undefined, 
    warnings: string[]
  ): Promise<ResolverResult> {
    if (!roleName) {
      return {
        success: false,
        approvers: [],
        error: 'Role name required for ROLE actor type'
      };
    }

    try {
      const { rows } = await pool.query(
        `SELECT 
           p.id as user_id,
           p.full_name,
           p.email,
           p.department_id,
           r.name as role_name
         FROM profiles p
         JOIN roles r ON p.role_id = r.id
         WHERE r.name = $1
         AND p.is_active = true
         AND (p.department_id = $2 OR p.department_id IS NULL OR $2 IS NULL)
         ORDER BY 
           CASE WHEN p.department_id = $2 THEN 1 ELSE 2 END,
           p.full_name`,
        [roleName, departmentId]
      );

      if (rows.length === 0) {
        // Try fallback to any user with the role (cross-department)
        const { rows: fallbackRows } = await pool.query(
          `SELECT 
             p.id as user_id,
             p.full_name,
             p.email,
             p.department_id,
             r.name as role_name
           FROM profiles p
           JOIN roles r ON p.role_id = r.id
           WHERE r.name = $1
           AND p.is_active = true
           ORDER BY p.full_name`,
          [roleName]
        );

        if (fallbackRows.length > 0) {
          warnings.push(`No ${roleName} found in department, using cross-department approvers`);
          return {
            success: true,
            approvers: fallbackRows.map(row => ({
              user_id: row.user_id,
              full_name: row.full_name,
              email: row.email,
              department_id: row.department_id,
              role_name: row.role_name,
              assignment_type: 'ROLE' as const,
              fallback_used: true
            })),
            warnings
          };
        }

        return {
          success: false,
          approvers: [],
          error: `No active users found with role: ${roleName}`
        };
      }

      const approvers: ApproverAssignment[] = rows.map(row => ({
        user_id: row.user_id,
        full_name: row.full_name,
        email: row.email,
        department_id: row.department_id,
        role_name: row.role_name,
        assignment_type: 'ROLE' as const
      }));

      return { success: true, approvers };

    } catch (error) {
      console.error('Error resolving by role:', error);
      return {
        success: false,
        approvers: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve user manager (direct manager of request initiator)
   */
  private async resolveUserManager(request: RequestDefinition, warnings: string[]): Promise<ResolverResult> {
    if (!request.initiator_id) {
      return {
        success: false,
        approvers: [],
        error: 'Initiator ID required for USER_MANAGER actor type'
      };
    }

    try {
      // First try the users.manager_id column (new approach)
      const { rows } = await pool.query(
        `SELECT 
           m.id as user_id,
           m.full_name,
           m.email,
           m.department_id,
           r.name as role_name
         FROM users u
         JOIN profiles m ON u.manager_id = m.id
         LEFT JOIN roles r ON m.role_id = r.id
         WHERE u.id = $1 AND m.is_active = true`,
        [request.initiator_id]
      );

      if (rows.length > 0) {
        const approvers: ApproverAssignment[] = rows.map(row => ({
          user_id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          department_id: row.department_id,
          role_name: row.role_name,
          assignment_type: 'USER_MANAGER' as const
        }));

        return { success: true, approvers };
      }

      // Fallback: Try department manager
      warnings.push('No direct manager found, falling back to department manager');
      return await this.resolveDepartmentManager(request, warnings);

    } catch (error) {
      console.error('Error resolving user manager:', error);
      return {
        success: false,
        approvers: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve department manager
   */
  private async resolveDepartmentManager(request: RequestDefinition, warnings: string[]): Promise<ResolverResult> {
    if (!request.department_id) {
      return {
        success: false,
        approvers: [],
        error: 'Department ID required for DEPARTMENT_MANAGER actor type'
      };
    }

    try {
      // First try the departments.manager_user_id column (new approach)
      const { rows } = await pool.query(
        `SELECT 
           u.id as user_id,
           p.full_name,
           p.email,
           p.department_id,
           r.name as role_name
         FROM departments d
         JOIN users u ON d.manager_user_id = u.id
         JOIN profiles p ON u.id = p.id
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE d.id = $1 AND p.is_active = true`,
        [request.department_id]
      );

      if (rows.length > 0) {
        const approvers: ApproverAssignment[] = rows.map(row => ({
          user_id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          department_id: row.department_id,
          role_name: row.role_name,
          assignment_type: 'DEPARTMENT_MANAGER' as const
        }));

        return { success: true, approvers };
      }

      // Fallback: Try to find by department head_name (legacy approach)
      const { rows: fallbackRows } = await pool.query(
        `SELECT 
           u.id as user_id,
           p.full_name,
           p.email,
           p.department_id,
           r.name as role_name
         FROM departments d
         JOIN profiles p ON p.full_name = d.head_name
         JOIN users u ON p.id = u.id
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE d.id = $1 AND p.is_active = true`,
        [request.department_id]
      );

      if (fallbackRows.length > 0) {
        warnings.push('Using department head_name fallback (should migrate to manager_user_id)');
        const approvers: ApproverAssignment[] = fallbackRows.map(row => ({
          user_id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          department_id: row.department_id,
          role_name: row.role_name,
          assignment_type: 'DEPARTMENT_MANAGER' as const,
          fallback_used: true
        }));

        return { success: true, approvers, warnings };
      }

      // Final fallback: Try to find any admin or user with manage permissions
      const { rows: adminRows } = await pool.query(
        `SELECT 
           u.id as user_id,
           p.full_name,
           p.email,
           p.department_id,
           r.name as role_name
         FROM profiles p
         JOIN users u ON p.id = u.id
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE (p.is_admin = true 
                OR r.permissions @> ARRAY['manage_approvals'] 
                OR r.permissions @> ARRAY['all'])
         AND p.is_active = true
         AND (p.department_id = $1 OR p.department_id IS NULL)
         LIMIT 1`,
        [request.department_id]
      );

      if (adminRows.length > 0) {
        warnings.push('No department manager found, using admin fallback');
        const approvers: ApproverAssignment[] = adminRows.map(row => ({
          user_id: row.user_id,
          full_name: row.full_name,
          email: row.email,
          department_id: row.department_id,
          role_name: row.role_name,
          assignment_type: 'DEPARTMENT_MANAGER' as const,
          fallback_used: true
        }));

        return { success: true, approvers, warnings };
      }

      return {
        success: false,
        approvers: [],
        error: `No department manager found for department: ${request.department_id}`
      };

    } catch (error) {
      console.error('Error resolving department manager:', error);
      return {
        success: false,
        approvers: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve specific user
   */
  private async resolveSpecificUser(userId: string | undefined, warnings: string[]): Promise<ResolverResult> {
    if (!userId) {
      return {
        success: false,
        approvers: [],
        error: 'User ID required for SPECIFIC_USER actor type'
      };
    }

    try {
      const { rows } = await pool.query(
        `SELECT 
           u.id as user_id,
           p.full_name,
           p.email,
           p.department_id,
           r.name as role_name
         FROM users u
         JOIN profiles p ON u.id = p.id
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE u.id = $1 AND p.is_active = true`,
        [userId]
      );

      if (rows.length === 0) {
        return {
          success: false,
          approvers: [],
          error: `User not found or inactive: ${userId}`
        };
      }

      const approver: ApproverAssignment = {
        user_id: rows[0].user_id,
        full_name: rows[0].full_name,
        email: rows[0].email,
        department_id: rows[0].department_id,
        role_name: rows[0].role_name,
        assignment_type: 'SPECIFIC_USER' as const
      };

      return { success: true, approvers: [approver] };

    } catch (error) {
      console.error('Error resolving specific user:', error);
      return {
        success: false,
        approvers: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Infer actor type from deprecated columns (backward compatibility)
   */
  private inferActorTypeFromDeprecated(step: StepDefinition): 'ROLE' | 'USER_MANAGER' | 'DEPARTMENT_MANAGER' | 'SPECIFIC_USER' {
    if (step.user_id) {
      return 'SPECIFIC_USER';
    }
    // Default to ROLE for backward compatibility
    return 'ROLE';
  }

  /**
   * Get actor value from deprecated columns (backward compatibility)
   */
  private getActorValueFromDeprecated(step: StepDefinition): string | undefined {
    if (step.user_id) {
      return step.user_id;
    }
    if (step.role_id) {
      // Need to look up role name from role_id
      return undefined; // Will be handled by the calling function
    }
    return undefined;
  }

  /**
   * Legacy method for backward compatibility - get users by role
   * @deprecated Use resolveApprovers instead
   */
  async getUsersByRole(roleName: string, departmentId?: string): Promise<ApproverAssignment[]> {
    const result = await this.resolveByRole(roleName, departmentId, []);
    return result.approvers;
  }

  /**
   * Get step definition from database
   */
  async getStepDefinition(stepId: string): Promise<StepDefinition | null> {
    try {
      const { rows } = await pool.query(
        `SELECT 
           id,
           step_order,
           name,
           description,
           actor_type,
           actor_value,
           role_id,
           user_id,
           action_label,
           due_days
         FROM approval_steps 
         WHERE id = $1`,
        [stepId]
      );

      return rows.length > 0 ? rows[0] : null;

    } catch (error) {
      console.error('Error getting step definition:', error);
      return null;
    }
  }

  /**
   * Get request definition from database
   */
  async getRequestDefinition(requestId: string): Promise<RequestDefinition | null> {
    try {
      const { rows } = await pool.query(
        `SELECT 
           id,
           initiator_id,
           department_id,
           approval_chain_id,
           status,
           current_step
         FROM approval_requests 
         WHERE id = $1`,
        [requestId]
      );

      return rows.length > 0 ? rows[0] : null;

    } catch (error) {
      console.error('Error getting request definition:', error);
      return null;
    }
  }

  /**
   * Batch resolve approvers for multiple steps
   */
  async resolveApproversForBatch(
    steps: StepDefinition[], 
    request: RequestDefinition
  ): Promise<Map<number, ResolverResult>> {
    const results = new Map<number, ResolverResult>();

    for (const step of steps) {
      const result = await this.resolveApprovers(step, request);
      results.set(step.step_order, result);
    }

    return results;
  }

  /**
   * Validate that a user can act on a step
   */
  async canUserActOnStep(userId: string, stepId: string): Promise<boolean> {
    try {
      // Get request_id from request_steps table (not approval_steps)
      const { rows: requestSteps } = await pool.query(
        'SELECT request_id FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (requestSteps.length === 0) {
        return false;
      }

      const requestId = requestSteps[0].request_id;
      const request = await this.getRequestDefinition(requestId);

      if (!request) {
        return false;
      }

      // Get step definition from approval_steps
      const step = await this.getStepDefinition(stepId);
      if (!step) {
        return false;
      }

      const result = await this.resolveApprovers(step, request);
      
      return result.success && result.approvers.some(approver => approver.user_id === userId);

    } catch (error) {
      console.error('Error checking user step access:', error);
      return false;
    }
  }
}
