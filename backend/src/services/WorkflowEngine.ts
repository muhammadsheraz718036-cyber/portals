import { pool } from '../db.js';
import { ApproversResolver, StepDefinition, RequestDefinition, ApproverAssignment } from './ApproversResolver.js';

export interface WorkflowStep {
  id: string;
  request_id: string;
  step_order: number;
  name: string;
  status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'SKIPPED';
  assigned_to?: string;
  acted_by?: string;
  remarks?: string;
  due_date?: string;
  actor_type?: string;
  actor_value?: string;
}

export interface WorkflowRequest {
  id: string;
  request_number: string;
  approval_type_id: string;
  approval_chain_id?: string;
  initiator_id: string;
  department_id?: string;
  status: string;
  current_step: number;
  total_steps: number;
  form_data: any;
  created_at: string;
  updated_at: string;
}

export interface AssignmentResult {
  success: boolean;
  assigned_steps: number;
  failed_steps: number;
  errors: string[];
  warnings: string[];
}

export class WorkflowEngine {
  private resolver: ApproversResolver;

  constructor() {
    this.resolver = new ApproversResolver();
  }

  /**
   * Initialize workflow for a new request
   */
  async initializeWorkflow(requestId: string): Promise<AssignmentResult> {
    const result: AssignmentResult = {
      success: true,
      assigned_steps: 0,
      failed_steps: 0,
      errors: [],
      warnings: []
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get request details
      const { rows: requests } = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      if (requests.length === 0) {
        throw new Error('Request not found');
      }

      const request = requests[0];

      // Get approval steps for the request's chain
      const { rows: steps } = await client.query(
        `SELECT * FROM approval_steps 
         WHERE chain_id = $1 
         ORDER BY step_order`,
        [request.approval_chain_id]
      );

      if (steps.length === 0) {
        result.warnings.push('No approval steps found for this request');
        await client.query('COMMIT');
        return result;
      }

      // Create workflow steps and assign approvers
      for (const step of steps) {
        try {
          // Create workflow step
          const { rows: workflowSteps } = await client.query(
            `INSERT INTO request_steps 
             (request_id, step_id, step_order, name, description, actor_type, actor_value, action_label, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'WAITING')
             RETURNING *`,
            [
              requestId,
              step.id,
              step.step_order,
              step.name,
              step.description,
              step.actor_type,
              step.actor_value,
              step.action_label
            ]
          );

          const workflowStep = workflowSteps[0];

          // Resolve approvers for this step
          const stepDefinition: StepDefinition = {
            step_order: step.step_order,
            name: step.name,
            description: step.description,
            actor_type: step.actor_type,
            actor_value: step.actor_value,
            role_id: step.role_id, // Deprecated but included for compatibility
            user_id: step.user_id, // Deprecated but included for compatibility
            action_label: step.action_label,
            due_days: step.due_days
          };

          const requestDefinition: RequestDefinition = {
            id: request.id,
            initiator_id: request.initiator_id,
            department_id: request.department_id,
            approval_chain_id: request.approval_chain_id,
            status: request.status,
            current_step: request.current_step
          };

          const resolverResult = await this.resolver.resolveApprovers(stepDefinition, requestDefinition);

          if (resolverResult.success && resolverResult.approvers.length > 0) {
            // Assign the first approver (can be enhanced for parallel approvals)
            const approver = resolverResult.approvers[0];
            
            await client.query(
              `UPDATE request_steps 
               SET assigned_to = $1, status = 'PENDING', due_date = NOW() + INTERVAL '${step.due_days || 3} days'
               WHERE id = $2`,
              [approver.user_id, workflowStep.id]
            );

            result.assigned_steps++;
            
            if (resolverResult.warnings && resolverResult.warnings.length > 0) {
              result.warnings.push(...resolverResult.warnings);
            }
          } else {
            result.failed_steps++;
            result.errors.push(`Step ${step.step_order}: ${resolverResult.error || 'No approvers found'}`);
          }

        } catch (stepError) {
          result.failed_steps++;
          result.errors.push(`Step ${step.step_order}: ${stepError instanceof Error ? stepError.message : 'Unknown error'}`);
        }
      }

      // Update request total_steps
      await client.query(
        'UPDATE approval_requests SET total_steps = $1 WHERE id = $2',
        [steps.length, requestId]
      );

      await client.query('COMMIT');

      if (result.failed_steps > 0) {
        result.success = false;
      }

      return result;

    } catch (error) {
      await client.query('ROLLBACK');
      result.success = false;
      result.errors.push(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Process an approval action
   */
  async processApprovalAction(
    requestId: string,
    stepId: string,
    userId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES',
    remarks?: string
  ): Promise<{ success: boolean; nextSteps?: WorkflowStep[]; error?: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Validate user can act on this step
      const canAct = await this.resolver.canUserActOnStep(userId, stepId);
      if (!canAct) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User is not authorized to act on this step' };
      }

      // Get current step
      const { rows: steps } = await client.query(
        'SELECT * FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (steps.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Step not found' };
      }

      const currentStep = steps[0];

      // Update the step
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 
                       action === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';

      await client.query(
        `UPDATE request_steps 
         SET status = $1, acted_by = $2, remarks = $3, completed_at = NOW()
         WHERE id = $4`,
        [newStatus, userId, remarks, stepId]
      );

      // Update request status
      await this.updateRequestStatus(client, requestId);

      // Get next steps if approved
      let nextSteps: WorkflowStep[] = [];
      if (action === 'APPROVE') {
        nextSteps = await this.assignNextSteps(client, requestId, currentStep.step_order);
      }

      await client.query('COMMIT');

      return { success: true, nextSteps };

    } catch (error) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      client.release();
    }
  }

  /**
   * Resume a request after changes
   */
  async resumeRequest(requestId: string, updatedFormData: any): Promise<{ success: boolean; steps?: WorkflowStep[]; error?: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the last step that requested changes
      const { rows: changeSteps } = await client.query(
        `SELECT * FROM request_steps 
         WHERE request_id = $1 AND status = 'CHANGES_REQUESTED'
         ORDER BY step_order DESC
         LIMIT 1`,
        [requestId]
      );

      if (changeSteps.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No changes requested step found' };
      }

      const changeStep = changeSteps[0];

      // Update request form data
      await client.query(
        `UPDATE approval_requests 
         SET form_data = $1, status = 'in_progress', updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedFormData), requestId]
      );

      // Reset the step
      await client.query(
        `UPDATE request_steps 
         SET status = 'PENDING', assigned_to = NULL, acted_by = NULL, remarks = NULL, completed_at = NULL
         WHERE id = $1`,
        [changeStep.id]
      );

      // Re-assign approvers to this step and subsequent steps
      await this.assignStepsFrom(client, requestId, changeStep.step_order);

      // Get updated steps
      const { rows: updatedSteps } = await client.query(
        'SELECT * FROM request_steps WHERE request_id = $1 ORDER BY step_order',
        [requestId]
      );

      await client.query('COMMIT');

      return { success: true, steps: updatedSteps };

    } catch (error) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get pending steps for a user
   */
  async getPendingSteps(userId: string): Promise<WorkflowStep[]> {
    try {
      const { rows } = await pool.query(
        `SELECT rs.*, ar.request_number, ar.title, p.full_name as initiator_name
         FROM request_steps rs
         JOIN approval_requests ar ON rs.request_id = ar.id
         JOIN profiles p ON ar.initiator_id = p.id
         WHERE rs.assigned_to = $1 
         AND rs.status IN ('PENDING', 'WAITING')
         ORDER BY rs.due_date ASC NULLS LAST, rs.created_at DESC`,
        [userId]
      );

      return rows;

    } catch (error) {
      console.error('Error getting pending steps:', error);
      return [];
    }
  }

  /**
   * Get user's requests with visibility rules
   */
  async getUserRequests(userId: string, filters: {
    status?: string;
    department_id?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ requests: WorkflowRequest[]; total: number }> {
    const { status, department_id, page = 1, limit = 10 } = filters;
    const offset = (page - 1) * limit;

    try {
      // Get user's permissions
      const { rows: userRows } = await pool.query(
        `SELECT p.department_id, p.is_admin, r.permissions
         FROM profiles p
         LEFT JOIN roles r ON p.role_id = r.id
         WHERE p.id = $1`,
        [userId]
      );

      if (userRows.length === 0) {
        return { requests: [], total: 0 };
      }

      const user = userRows[0];
      const hasManageApprovals = user.permissions?.includes('manage_approvals') || 
                                user.permissions?.includes('all') || 
                                user.is_admin;

      // Build visibility query
      let whereClause = 'WHERE 1=1';
      let queryParams: any[] = [];
      let paramIndex = 1;

      if (!hasManageApprovals) {
        // Non-admin users only see their department's requests
        whereClause += ` AND (ar.department_id = $${paramIndex++} OR ar.initiator_id = $${paramIndex++})`;
        queryParams.push(user.department_id, userId);
      }

      if (status) {
        whereClause += ` AND ar.status = $${paramIndex++}`;
        queryParams.push(status);
      }

      if (department_id && hasManageApprovals) {
        whereClause += ` AND ar.department_id = $${paramIndex++}`;
        queryParams.push(department_id);
      }

      // Get total count
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) as total FROM approval_requests ar ${whereClause}`,
        queryParams
      );

      // Get requests
      const { rows } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         ${whereClause}
         ORDER BY ar.created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...queryParams, limit, offset]
      );

      return {
        requests: rows,
        total: parseInt(countRows[0].total)
      };

    } catch (error) {
      console.error('Error getting user requests:', error);
      return { requests: [], total: 0 };
    }
  }

  /**
   * Update request status based on step statuses
   */
  private async updateRequestStatus(client: any, requestId: string): Promise<void> {
    const { rows: steps } = await client.query(
      `SELECT status FROM request_steps WHERE request_id = $1`,
      [requestId]
    );

    const allApproved = steps.every(s => s.status === 'APPROVED');
    const anyRejected = steps.some(s => s.status === 'REJECTED');
    const anyChangesRequested = steps.some(s => s.status === 'CHANGES_REQUESTED');

    let newStatus = 'in_progress';
    if (anyRejected) {
      newStatus = 'rejected';
    } else if (anyChangesRequested) {
      newStatus = 'changes_requested';
    } else if (allApproved) {
      newStatus = 'approved';
    }

    await client.query(
      'UPDATE approval_requests SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, requestId]
    );
  }

  /**
   * Assign approvers to next steps
   */
  private async assignNextSteps(client: any, requestId: string, currentStepOrder: number): Promise<WorkflowStep[]> {
    const { rows: nextSteps } = await client.query(
      `SELECT rs.*, as_.actor_type, as_.actor_value, as_.role_id, as_.user_id, as_.due_days
       FROM request_steps rs
       JOIN approval_steps as_ ON rs.step_id = as_.id
       WHERE rs.request_id = $1 AND rs.step_order > $2 AND rs.status = 'WAITING'
       ORDER BY rs.step_order
       LIMIT 1`,
      [requestId, currentStepOrder]
    );

    const assignedSteps: WorkflowStep[] = [];

    for (const step of nextSteps) {
      const stepDefinition: StepDefinition = {
        step_order: step.step_order,
        name: step.name,
        description: step.description,
        actor_type: step.actor_type,
        actor_value: step.actor_value,
        role_id: step.role_id,
        user_id: step.user_id,
        action_label: step.action_label,
        due_days: step.due_days
      };

      const requestDefinition: RequestDefinition = await this.getRequestDefinition(requestId);

      if (requestDefinition) {
        const resolverResult = await this.resolver.resolveApprovers(stepDefinition, requestDefinition);

        if (resolverResult.success && resolverResult.approvers.length > 0) {
          const approver = resolverResult.approvers[0];
          
          await client.query(
            `UPDATE request_steps 
             SET assigned_to = $1, status = 'PENDING', due_date = NOW() + INTERVAL '${step.due_days || 3} days'
             WHERE id = $2`,
            [approver.user_id, step.id]
          );

          assignedSteps.push({
            ...step,
            assigned_to: approver.user_id,
            status: 'PENDING'
          });
        }
      }
    }

    return assignedSteps;
  }

  /**
   * Assign approvers to steps from a specific step onwards
   */
  private async assignStepsFrom(client: any, requestId: string, fromStepOrder: number): Promise<void> {
    const { rows: steps } = await client.query(
      `SELECT rs.*, as_.actor_type, as_.actor_value, as_.role_id, as_.user_id, as_.due_days
       FROM request_steps rs
       JOIN approval_steps as_ ON rs.step_id = as_.id
       WHERE rs.request_id = $1 AND rs.step_order >= $2
       ORDER BY rs.step_order`,
      [requestId, fromStepOrder]
    );

    const requestDefinition = await this.getRequestDefinition(requestId);

    if (!requestDefinition) {
      return;
    }

    for (const step of steps) {
      const stepDefinition: StepDefinition = {
        step_order: step.step_order,
        name: step.name,
        description: step.description,
        actor_type: step.actor_type,
        actor_value: step.actor_value,
        role_id: step.role_id,
        user_id: step.user_id,
        action_label: step.action_label,
        due_days: step.due_days
      };

      const resolverResult = await this.resolver.resolveApprovers(stepDefinition, requestDefinition);

      if (resolverResult.success && resolverResult.approvers.length > 0) {
        const approver = resolverResult.approvers[0];
        
        await client.query(
          `UPDATE request_steps 
           SET assigned_to = $1, status = 'PENDING', due_date = NOW() + INTERVAL '${step.due_days || 3} days'
           WHERE id = $2`,
          [approver.user_id, step.id]
        );
      }
    }
  }

  /**
   * Get request definition
   */
  private async getRequestDefinition(requestId: string): Promise<RequestDefinition | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      return rows.length > 0 ? rows[0] : null;

    } catch (error) {
      console.error('Error getting request definition:', error);
      return null;
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use initializeWorkflow instead
   */
  async assignApproversToRequest(requestId: string): Promise<AssignmentResult> {
    return await this.initializeWorkflow(requestId);
  }
}
