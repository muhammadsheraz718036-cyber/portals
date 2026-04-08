import { pool } from '../db.js';
import { User, RequestStep, WorkflowRequest } from '../types.js';

export interface ApproverResolution {
  success: boolean;
  users: User[];
  error?: string;
  warnings?: string[];
}

export interface ResolutionContext {
  request_id: string;
  step_id?: string;
  step_definition?: {
    actor_type: 'ROLE' | 'USER_MANAGER' | 'DEPARTMENT_MANAGER' | 'SPECIFIC_USER';
    actor_value?: string;
  };
  department_id?: string;
  initiator_id?: string;
}

export class DynamicApproverResolver {
  /**
   * Resolve approvers for a given step and request context
   */
  async resolveApprovers(context: ResolutionContext): Promise<ApproverResolution> {
    try {
      const { request_id, step_id, step_definition, department_id, initiator_id } = context;
      
      // Get request details if not provided
      let requestDetails = { department_id, initiator_id };
      if (!department_id || !initiator_id) {
        const { rows } = await pool.query(
          'SELECT department_id, initiator_id FROM approval_requests WHERE id = $1',
          [request_id]
        );
        if (rows.length === 0) {
          return { success: false, users: [], error: 'Request not found' };
        }
        requestDetails = rows[0];
      }

      // Get step details if not provided
      let stepDetails = step_definition;
      if (!stepDetails && step_id) {
        const { rows } = await pool.query(
          'SELECT actor_type, actor_value FROM approval_steps WHERE id = $1',
          [step_id]
        );
        if (rows.length === 0) {
          return { success: false, users: [], error: 'Step not found' };
        }
        stepDetails = rows[0];
      }

      if (!stepDetails) {
        return { success: false, users: [], error: 'Step definition required' };
      }

      // Resolve approvers based on actor type
      const result = await this.resolveByActorType(
        stepDetails.actor_type,
        stepDetails.actor_value,
        requestDetails.department_id,
        requestDetails.initiator_id
      );

      return result;

    } catch (error) {
      console.error('Error resolving approvers:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers based on actor type
   */
  private async resolveByActorType(
    actorType: string,
    actorValue: string | null,
    departmentId: string | null,
    initiatorId: string | null
  ): Promise<ApproverResolution> {
    const warnings: string[] = [];

    try {
      let query: string;
      let params: any[];

      switch (actorType) {
        case 'ROLE':
          return await this.resolveByRole(actorValue, departmentId);

        case 'USER_MANAGER':
          return await this.resolveByUserManager(initiatorId);

        case 'DEPARTMENT_MANAGER':
          return await this.resolveByDepartmentManager(departmentId);

        case 'SPECIFIC_USER':
          return await this.resolveBySpecificUser(actorValue);

        default:
          return { success: false, users: [], error: `Unknown actor type: ${actorType}` };
      }

    } catch (error) {
      console.error('Error resolving by actor type:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers by role (department-scoped)
   */
  private async resolveByRole(
    roleName: string | null,
    departmentId: string | null
  ): Promise<ApproverResolution> {
    if (!roleName) {
      return { success: false, users: [], error: 'Role name required for ROLE actor type' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.full_name, p.email, p.department_id, r.name as role_name
         FROM profiles p
         JOIN roles r ON p.role_id = r.id
         WHERE r.name = $1
         AND p.is_active = true
         AND (p.department_id = $2 OR p.department_id IS NULL OR $2 IS NULL)
         ORDER BY p.department_id = $2 DESC, p.full_name`,
        [roleName, departmentId]
      );

      if (rows.length === 0) {
        return {
          success: false,
          users: [],
          error: `No active users found with role: ${roleName}`
        };
      }

      const users: User[] = rows.map(row => ({
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        department_id: row.department_id,
        role_id: row.role_name,
        manager_id: null,
        is_active: true
      }));

      return { success: true, users };

    } catch (error) {
      console.error('Error resolving by role:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers by user manager relationship
   */
  private async resolveByUserManager(initiatorId: string | null): Promise<ApproverResolution> {
    if (!initiatorId) {
      return { success: false, users: [], error: 'Initiator ID required for USER_MANAGER actor type' };
    }

    try {
      // First try the user_managers table
      const { rows } = await pool.query(
        `SELECT p.id, p.full_name, p.email, p.department_id
         FROM profiles p
         JOIN user_managers um ON p.id = um.manager_id
         WHERE um.user_id = $1
         AND um.is_active = true
         AND p.is_active = true`,
        [initiatorId]
      );

      if (rows.length === 0) {
        // Fallback: try to find department manager
        const initiatorDept = await pool.query(
          'SELECT department_id FROM profiles WHERE id = $1',
          [initiatorId]
        );

        if (initiatorDept.rows.length > 0 && initiatorDept.rows[0].department_id) {
          return await this.resolveByDepartmentManager(initiatorDept.rows[0].department_id);
        }

        return {
          success: false,
          users: [],
          error: `No manager found for user: ${initiatorId}`
        };
      }

      const users: User[] = rows.map(row => ({
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        department_id: row.department_id,
        role_id: null,
        manager_id: null,
        is_active: true
      }));

      return { success: true, users };

    } catch (error) {
      console.error('Error resolving by user manager:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers by department manager
   */
  private async resolveByDepartmentManager(departmentId: string | null): Promise<ApproverResolution> {
    if (!departmentId) {
      return { success: false, users: [], error: 'Department ID required for DEPARTMENT_MANAGER actor type' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.full_name, p.email, p.department_id
         FROM profiles p
         JOIN department_managers dm ON p.id = dm.user_id
         WHERE dm.department_id = $1
         AND dm.is_active = true
         AND p.is_active = true`,
        [departmentId]
      );

      if (rows.length === 0) {
        // Fallback: try to find any admin or user with manage permissions
        const { rows: fallbackRows } = await pool.query(
          `SELECT p.id, p.full_name, p.email, p.department_id
           FROM profiles p
           JOIN roles r ON p.role_id = r.id
           WHERE (p.is_admin = true OR r.permissions @> ARRAY['manage_approvals'] OR r.permissions @> ARRAY['all'])
           AND p.is_active = true
           AND (p.department_id = $1 OR p.department_id IS NULL)
           LIMIT 1`,
          [departmentId]
        );

        if (fallbackRows.length === 0) {
          return {
            success: false,
            users: [],
            error: `No department manager found for department: ${departmentId}`
          };
        }

        const users: User[] = fallbackRows.map(row => ({
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          department_id: row.department_id,
          role_id: null,
          manager_id: null,
          is_active: true
        }));

        return {
          success: true,
          users,
          warnings: ['Using fallback approver - no department manager assigned']
        };
      }

      const users: User[] = rows.map(row => ({
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        department_id: row.department_id,
        role_id: null,
        manager_id: null,
        is_active: true
      }));

      return { success: true, users };

    } catch (error) {
      console.error('Error resolving by department manager:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve approvers by specific user
   */
  private async resolveBySpecificUser(userId: string | null): Promise<ApproverResolution> {
    if (!userId) {
      return { success: false, users: [], error: 'User ID required for SPECIFIC_USER actor type' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.full_name, p.email, p.department_id
         FROM profiles p
         WHERE p.id = $1
         AND p.is_active = true`,
        [userId]
      );

      if (rows.length === 0) {
        return {
          success: false,
          users: [],
          error: `User not found or inactive: ${userId}`
        };
      }

      const user: User = {
        id: rows[0].id,
        email: rows[0].email,
        full_name: rows[0].full_name,
        department_id: rows[0].department_id,
        role_id: null,
        manager_id: null,
        is_active: true
      };

      return { success: true, users: [user] };

    } catch (error) {
      console.error('Error resolving by specific user:', error);
      return {
        success: false,
        users: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all pending actions for a user (department-scoped)
   */
  async getPendingActions(userId: string): Promise<any[]> {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT
           rs.id as step_id,
           rs.request_id,
           rs.step_order,
           rs.name as step_name,
           rs.action_label,
           rs.due_date,
           ar.request_number,
           ar.title,
           ar.status as request_status,
           ar.initiator_id,
           p.full_name as initiator_name,
           p.department_id as request_department_id,
           d.name as department_name
         FROM request_steps rs
         JOIN approval_requests ar ON rs.request_id = ar.id
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         WHERE rs.assigned_to = $1
         AND rs.status IN ('PENDING', 'WAITING')
         ORDER BY rs.due_date ASC NULLS LAST, rs.created_at DESC`,
        [userId]
      );

      return rows;

    } catch (error) {
      console.error('Error getting pending actions:', error);
      return [];
    }
  }

  /**
   * Check if user can act on a specific step
   */
  async canUserActOnStep(userId: string, stepId: string): Promise<boolean> {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM request_steps WHERE id = $1 AND assigned_to = $2 AND status IN ($3, $4)',
        [stepId, userId, 'PENDING', 'WAITING']
      );

      return rows.length > 0;

    } catch (error) {
      console.error('Error checking user step access:', error);
      return false;
    }
  }

  /**
   * Assign approvers to request steps
   */
  async assignApproversToSteps(requestId: string): Promise<void> {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get all steps for the request
        const { rows: steps } = await client.query(
          `SELECT rs.id, rs.step_id, rs.actor_type, rs.actor_value
           FROM request_steps rs
           WHERE rs.request_id = $1
           AND rs.status = 'WAITING'
           ORDER BY rs.step_order`,
          [requestId]
        );

        for (const step of steps) {
          const resolution = await this.resolveApprovers({
            request_id: requestId,
            step_id: step.step_id
          });

          if (resolution.success && resolution.users.length > 0) {
            // Assign the first approver (can be enhanced for parallel approvals)
            await client.query(
              'UPDATE request_steps SET assigned_to = $1, status = $2 WHERE id = $3',
              [resolution.users[0].id, 'PENDING', step.id]
            );
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error assigning approvers:', error);
      throw error;
    }
  }

  /**
   * Get department managers for a department
   */
  async getDepartmentManagers(departmentId: string): Promise<User[]> {
    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.full_name, p.email, p.department_id
         FROM profiles p
         JOIN department_managers dm ON p.id = dm.user_id
         WHERE dm.department_id = $1
         AND dm.is_active = true
         AND p.is_active = true`,
        [departmentId]
      );

      return rows.map(row => ({
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        department_id: row.department_id,
        role_id: null,
        manager_id: null,
        is_active: true
      }));

    } catch (error) {
      console.error('Error getting department managers:', error);
      return [];
    }
  }

  /**
   * Set up manager relationships
   */
  async setupManagerRelationship(
    userId: string,
    managerId: string,
    assignedBy: string
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO user_managers (user_id, manager_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, manager_id) 
         DO UPDATE SET is_active = true, assigned_at = now(), assigned_by = $3`,
        [userId, managerId, assignedBy]
      );

    } catch (error) {
      console.error('Error setting up manager relationship:', error);
      throw error;
    }
  }

  /**
   * Set up department manager
   */
  async setupDepartmentManager(
    departmentId: string,
    userId: string,
    assignedBy: string
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO department_managers (department_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (department_id, user_id) 
         DO UPDATE SET is_active = true, assigned_at = now(), assigned_by = $3`,
        [departmentId, userId, assignedBy]
      );

    } catch (error) {
      console.error('Error setting up department manager:', error);
      throw error;
    }
  }
}
