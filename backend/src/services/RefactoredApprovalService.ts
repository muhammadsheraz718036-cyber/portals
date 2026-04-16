import { pool } from '../db.js';
import { DynamicApproverResolver } from './DynamicApproverResolver.js';
import { HttpError } from '../httpError.js';

export interface ApprovalAction {
  request_id: string;
  step_id: string;
  action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  comment?: string;
}

export interface RequestCreationData {
  title: string;
  approval_type_id: string;
  form_data: Record<string, any>;
  approval_chain_id?: string;
  department_id?: string;
}

export interface RequestStep {
  id: string;
  request_id: string;
  step_order: number;
  name: string;
  status: string;
  assigned_to?: string;
  acted_by?: string;
  remarks?: string;
  due_date?: string;
}

export class RefactoredApprovalService {
  constructor(private approverResolver: DynamicApproverResolver) {}

  /**
   * Get the approver resolver (public accessor)
   */
  getApproverResolver(): DynamicApproverResolver {
    return this.approverResolver;
  }

  /**
   * Create a new approval request with dynamic approver resolution
   */
  async createRequest(userId: string, data: RequestCreationData): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get user's department if not provided
      let departmentId = data.department_id;
      if (!departmentId) {
        const { rows } = await client.query(
          'SELECT department_id FROM profiles WHERE id = $1',
          [userId]
        );
        departmentId = rows[0]?.department_id;
      }

      // Get approval chain
      let chainId = data.approval_chain_id;
      if (!chainId) {
        const { rows } = await client.query(
          'SELECT id FROM approval_chains WHERE approval_type_id = $1 ORDER BY is_default DESC, name LIMIT 1',
          [data.approval_type_id]
        );
        if (rows.length === 0) {
          throw new HttpError(400, 'No approval chain found for this approval type');
        }
        chainId = rows[0].id;
      }

      // Create the request
      const { rows: requests } = await client.query(
        `INSERT INTO approval_requests 
         (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status, current_step, total_steps)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1, 
           (SELECT COUNT(*) FROM approval_steps WHERE chain_id = $2))
         RETURNING *`,
        [data.approval_type_id, chainId, userId, departmentId, data.title, JSON.stringify(data.form_data)]
      );

      const request = requests[0];

      // Create request steps from approval steps
      const { rows: approvalSteps } = await client.query(
        'SELECT * FROM approval_steps WHERE chain_id = $1 ORDER BY step_order',
        [chainId]
      );

      for (const step of approvalSteps) {
        await client.query(
          `INSERT INTO request_steps 
           (request_id, step_id, step_order, name, description, actor_type, actor_value, action_label, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'WAITING')`,
          [request.id, step.id, step.step_order, step.name, step.description, step.actor_type, step.actor_value, step.action_label]
        );
      }

      // Assign approvers to steps
      await this.assignApproversToRequest(request.id, client);

      await client.query('COMMIT');

      // Get the created request with steps
      return await this.getRequestWithSteps(request.id);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Process an approval action with dynamic resolution
   */
  async processAction(userId: string, action: ApprovalAction): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify user can act on this step
      const { rows: steps } = await client.query(
        `SELECT rs.*, ar.initiator_id, ar.status as request_status
         FROM request_steps rs
         JOIN approval_requests ar ON rs.request_id = ar.id
         WHERE rs.id = $1 AND rs.assigned_to = $2`,
        [action.step_id, userId]
      );

      if (steps.length === 0) {
        throw new HttpError(403, 'You are not assigned to this step or step not found');
      }

      const step = steps[0];

      // Prevent initiator from approving their own request
      if (step.initiator_id === userId) {
        throw new HttpError(403, 'You cannot approve your own request');
      }

      // Update the step
      const newStatus = action.action === 'APPROVE' ? 'APPROVED' : 
                       action.action === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';

      await client.query(
        `UPDATE request_steps 
         SET status = $1, acted_by = $2, remarks = $3, completed_at = now()
         WHERE id = $4`,
        [newStatus, userId, action.comment, action.step_id]
      );

      // Update request status based on action
      let newRequestStatus = step.request_status;
      if (action.action === 'REJECT') {
        newRequestStatus = 'rejected';
      } else if (action.action === 'REQUEST_CHANGES') {
        newRequestStatus = 'changes_requested';
      } else {
        // Check if all steps are approved
        const { rows: allSteps } = await client.query(
          `SELECT status FROM request_steps WHERE request_id = $1`,
          [step.request_id]
        );

        const allApproved = allSteps.every(s => s.status === 'APPROVED');
        const anyRejected = allSteps.some(s => s.status === 'REJECTED');
        const anyChangesRequested = allSteps.some(s => s.status === 'CHANGES_REQUESTED');

        if (anyRejected) {
          newRequestStatus = 'rejected';
        } else if (anyChangesRequested) {
          newRequestStatus = 'changes_requested';
        } else if (allApproved) {
          newRequestStatus = 'approved';
        } else {
          newRequestStatus = 'in_progress';
        }
      }

      await client.query(
        'UPDATE approval_requests SET status = $1, updated_at = now() WHERE id = $2',
        [newRequestStatus, step.request_id]
      );

      // If approved, assign approvers to next steps
      if (action.action === 'APPROVE') {
        await this.assignNextStepApprovers(step.request_id, step.step_order, client);
      }

      await client.query('COMMIT');

      return await this.getRequestWithSteps(step.request_id);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get requests visible to a user (department-scoped)
   */
  async getUserRequests(userId: string, filters: {
    status?: string;
    department_id?: string;
    initiator_id?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<any> {
    const { status, department_id, initiator_id, page = 1, limit = 10 } = filters;
    const offset = (page - 1) * limit;

    try {
      // Get user's department and permissions
      const { rows: userRows } = await pool.query(
        `SELECT p.department_id, p.is_admin, r.permissions
         FROM profiles p
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE p.id = $1`,
        [userId]
      );

      if (userRows.length === 0) {
        throw new HttpError(404, 'User not found');
      }

      const user = userRows[0];
      const hasManageApprovals = user.permissions?.includes('manage_approvals') || user.permissions?.includes('all') || user.is_admin;

      let whereClause = 'WHERE 1=1';
      let queryParams: any[] = [];
      let paramIndex = 1;

      // Apply visibility rules
      if (!hasManageApprovals) {
        // Non-admin users can see:
        // 1. Requests assigned to their department
        // 2. Requests they initiated
        // 3. Requests initiated by someone in their department (for department managers)
        whereClause += ` AND (
          ar.department_id = $${paramIndex} 
          OR ar.initiator_id = $${paramIndex + 1}
          OR EXISTS (
            SELECT 1 FROM profiles p 
            WHERE p.id = ar.initiator_id 
            AND p.department_id = $${paramIndex}
          )
        )`;
        queryParams.push(user.department_id, userId);
        paramIndex += 2;
      }

      // Apply filters
      if (status) {
        whereClause += ` AND ar.status = $${paramIndex++}`;
        queryParams.push(status);
      }

      if (department_id && hasManageApprovals) {
        whereClause += ` AND ar.department_id = $${paramIndex++}`;
        queryParams.push(department_id);
      }

      if (initiator_id) {
        whereClause += ` AND ar.initiator_id = $${paramIndex++}`;
        queryParams.push(initiator_id);
      }

      // Get total count
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) as total FROM approval_requests ar ${whereClause}`,
        queryParams
      );

      // Get requests
      const { rows } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name, at.name as approval_type_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         LEFT JOIN approval_types at ON ar.approval_type_id = at.id
         ${whereClause}
         ORDER BY ar.created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...queryParams, limit, offset]
      );

      return {
        requests: rows,
        pagination: {
          page,
          limit,
          total: parseInt(countRows[0].total),
          totalPages: Math.ceil(countRows[0].total / limit)
        }
      };

    } catch (error) {
      console.error('Error getting user requests:', error);
      throw error;
    }
  }

  /**
   * Get pending actions for a user (department-scoped)
   */
  async getPendingActions(userId: string): Promise<any[]> {
    return await this.approverResolver.getPendingActions(userId);
  }

  /**
   * Resume a request after changes
   */
  async resumeRequest(userId: string, requestId: string, updateData: any): Promise<any> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify user is the initiator
      const { rows: requests } = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1 AND initiator_id = $2',
        [requestId, userId]
      );

      if (requests.length === 0) {
        throw new HttpError(403, 'You can only resume your own requests');
      }

      const request = requests[0];

      if (request.status !== 'changes_requested') {
        throw new HttpError(400, 'Only requests with changes_requested status can be resumed');
      }

      // Update request data
      await client.query(
        `UPDATE approval_requests 
         SET title = COALESCE($1, title), 
             form_data = COALESCE($2::jsonb, form_data),
             status = 'in_progress',
             updated_at = now()
         WHERE id = $3`,
        [updateData.title, JSON.stringify(updateData.form_data), requestId]
      );

      // Find the last step that requested changes
      const { rows: changeSteps } = await client.query(
        `SELECT * FROM request_steps 
         WHERE request_id = $1 AND status = 'CHANGES_REQUESTED'
         ORDER BY step_order DESC
         LIMIT 1`,
        [requestId]
      );

      if (changeSteps.length === 0) {
        throw new HttpError(400, 'No changes requested step found');
      }

      const changeStep = changeSteps[0];

      // Reset the step to pending
      await client.query(
        `UPDATE request_steps 
         SET status = 'PENDING', 
             assigned_to = NULL,
             acted_by = NULL,
             remarks = NULL,
             completed_at = NULL
         WHERE id = $1`,
        [changeStep.id]
      );

      // Re-assign approvers to this step and subsequent steps
      await this.assignApproversToRequestFromStep(requestId, changeStep.step_order, client);

      await client.query('COMMIT');

      return await this.getRequestWithSteps(requestId);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Helper method to get request with steps
   */
  public async getRequestWithSteps(requestId: string): Promise<any> {
    const { rows: requests } = await pool.query(
      `SELECT ar.*, p.full_name as initiator_name, d.name as department_name, at.name as approval_type_name
       FROM approval_requests ar
       JOIN profiles p ON ar.initiator_id = p.id
       LEFT JOIN departments d ON ar.department_id = d.id
       LEFT JOIN approval_types at ON ar.approval_type_id = at.id
       WHERE ar.id = $1`,
      [requestId]
    );

    if (requests.length === 0) {
      throw new HttpError(404, 'Request not found');
    }

    const request = requests[0];

    const { rows: steps } = await pool.query(
      `SELECT rs.*, p.full_name as assigned_name, p.email as assigned_email
       FROM request_steps rs
       LEFT JOIN profiles p ON rs.assigned_to = p.id
       WHERE rs.request_id = $1
       ORDER BY rs.step_order`,
      [requestId]
    );

    return {
      ...request,
      form_data: typeof request.form_data === 'string' ? JSON.parse(request.form_data) : request.form_data,
      steps
    };
  }

  /**
   * Assign approvers to all steps in a request
   */
  private async assignApproversToRequest(requestId: string, client: any): Promise<void> {
    const { rows: steps } = await client.query(
      `SELECT rs.id, rs.step_id, rs.actor_type, rs.actor_value
       FROM request_steps rs
       WHERE rs.request_id = $1 AND rs.status = 'WAITING'
       ORDER BY rs.step_order`,
      [requestId]
    );

    for (const step of steps) {
      const resolution = await this.approverResolver.resolveApprovers({
        request_id: requestId,
        step_id: step.step_id
      });

      if (resolution.success && resolution.users.length > 0) {
        await client.query(
          'UPDATE request_steps SET assigned_to = $1, status = $2 WHERE id = $3',
          [resolution.users[0].id, 'PENDING', step.id]
        );
      }
    }
  }

  /**
   * Assign approvers to steps from a specific step onwards
   */
  private async assignApproversToRequestFromStep(requestId: string, fromStepOrder: number, client: any): Promise<void> {
    const { rows: steps } = await client.query(
      `SELECT rs.id, rs.step_id, rs.actor_type, rs.actor_value
       FROM request_steps rs
       WHERE rs.request_id = $1 AND rs.step_order >= $2
       ORDER BY rs.step_order`,
      [requestId, fromStepOrder]
    );

    for (const step of steps) {
      const resolution = await this.approverResolver.resolveApprovers({
        request_id: requestId,
        step_id: step.step_id
      });

      if (resolution.success && resolution.users.length > 0) {
        await client.query(
          'UPDATE request_steps SET assigned_to = $1, status = $2 WHERE id = $3',
          [resolution.users[0].id, 'PENDING', step.id]
        );
      }
    }
  }

  /**
   * Assign approvers to next steps after approval
   */
  private async assignNextStepApprovers(requestId: string, currentStepOrder: number, client: any): Promise<void> {
    const { rows: nextSteps } = await client.query(
      `SELECT rs.id, rs.step_id, rs.actor_type, rs.actor_value
       FROM request_steps rs
       WHERE rs.request_id = $1 AND rs.step_order > $2 AND rs.status = 'WAITING'
       ORDER BY rs.step_order
       LIMIT 1`,
      [requestId, currentStepOrder]
    );

    for (const step of nextSteps) {
      const resolution = await this.approverResolver.resolveApprovers({
        request_id: requestId,
        step_id: step.step_id
      });

      if (resolution.success && resolution.users.length > 0) {
        await client.query(
          'UPDATE request_steps SET assigned_to = $1, status = $2 WHERE id = $3',
          [resolution.users[0].id, 'PENDING', step.id]
        );
      }
    }
  }
}
