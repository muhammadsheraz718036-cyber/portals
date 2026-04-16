import { pool } from '../db.js';
import { ApproversResolver, StepDefinition, RequestDefinition, ApproverAssignment } from './ApproversResolver.js';

export interface LazyWorkflowStep {
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
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface LazyWorkflowRequest {
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

export interface LazyAssignmentResult {
  success: boolean;
  step_created: boolean;
  approver_assigned: boolean;
  error?: string;
  warnings?: string[];
}

export class LazyWorkflowEngine {
  private resolver: ApproversResolver;

  constructor() {
    this.resolver = new ApproversResolver();
  }

  /**
   * Initialize workflow - ONLY create the first step, do not pre-assign all approvers
   */
  async initializeWorkflow(requestId: string): Promise<LazyAssignmentResult> {
    const result: LazyAssignmentResult = {
      success: true,
      step_created: false,
      approver_assigned: false,
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
        result.warnings = result.warnings || [];
        result.warnings.push('No approval steps found for this request');
        await client.query('COMMIT');
        return result;
      }

      // Update total_steps
      await client.query(
        'UPDATE approval_requests SET total_steps = $1 WHERE id = $2',
        [steps.length, requestId]
      );

      // ONLY create the FIRST step - do not pre-assign all steps
      const firstStep = steps[0];
      const workflowStep = await this.createSingleStep(client, requestId, firstStep, 1);

      if (workflowStep) {
        result.step_created = true;

        // Resolve and assign approver for the first step only
        const assignmentResult = await this.resolveAndAssignApprover(
          client, 
          workflowStep.id, 
          firstStep, 
          request
        );

        if (assignmentResult.success) {
          result.approver_assigned = true;
          if (assignmentResult.warnings) {
            result.warnings = result.warnings || [];
            result.warnings.push(...assignmentResult.warnings);
          }
        } else {
          result.error = assignmentResult.error;
        }
      }

      await client.query('COMMIT');
      return result;

    } catch (error) {
      await client.query('ROLLBACK');
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Process an approval action and create the NEXT step dynamically
   */
  async processApprovalAction(
    requestId: string,
    stepId: string,
    userId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES',
    remarks?: string
  ): Promise<{ 
    success: boolean; 
    nextStep?: LazyWorkflowStep; 
    workflowComplete?: boolean;
    error?: string; 
  }> {
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

      // Update the current step
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

      // Only create next step if approved and not rejected/changes requested
      let nextStep: LazyWorkflowStep | undefined;
      let workflowComplete = false;

      if (action === 'APPROVE') {
        const nextStepResult = await this.createNextStepDynamically(client, requestId, currentStep.step_order);
        
        if (nextStepResult.stepCreated) {
          nextStep = nextStepResult.step;
        } else {
          workflowComplete = nextStepResult.workflowComplete || false;
        }
      }

      await client.query('COMMIT');

      return { 
        success: true, 
        nextStep,
        workflowComplete
      };

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
   * Create the next step dynamically (only when needed)
   */
  private async createNextStepDynamically(
    client: any, 
    requestId: string, 
    currentStepOrder: number
  ): Promise<{ 
    stepCreated: boolean; 
    step?: LazyWorkflowStep; 
    workflowComplete?: boolean; 
  }> {
    try {
      // Get the next approval step definition
      const { rows: nextStepDefs } = await client.query(
        `SELECT as_.* FROM approval_steps as_
         JOIN approval_requests ar ON ar.approval_chain_id = as_.chain_id
         WHERE ar.id = $1 AND as_.step_order = $2`,
        [requestId, currentStepOrder + 1]
      );

      if (nextStepDefs.length === 0) {
        // No more steps - workflow complete
        await client.query(
          'UPDATE approval_requests SET status = $2, updated_at = NOW() WHERE id = $1',
          [requestId, 'approved']
        );
        return { stepCreated: false, workflowComplete: true };
      }

      const nextStepDef = nextStepDefs[0];

      // Create the next request step
      const workflowStep = await this.createSingleStep(
        client, 
        requestId, 
        nextStepDef, 
        currentStepOrder + 1
      );

      if (!workflowStep) {
        return { stepCreated: false };
      }

      // Get request details for resolver
      const { rows: requests } = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      const request = requests[0];

      // Resolve and assign approver for the next step
      const assignmentResult = await this.resolveAndAssignApprover(
        client, 
        workflowStep.id, 
        nextStepDef, 
        request
      );

      if (assignmentResult.success) {
        // Update request current_step
        await client.query(
          'UPDATE approval_requests SET current_step = $1, updated_at = NOW() WHERE id = $2',
          [currentStepOrder + 1, requestId]
        );

        return { 
          stepCreated: true, 
          step: {
            ...workflowStep,
            assigned_to: assignmentResult.assigned_to
          }
        };
      } else {
        // Step created but no approver assigned - keep as WAITING
        return { 
          stepCreated: true, 
          step: workflowStep
        };
      }

    } catch (error) {
      console.error('Error creating next step:', error);
      return { stepCreated: false };
    }
  }

  /**
   * Create a single request step
   */
  private async createSingleStep(
    client: any, 
    requestId: string, 
    stepDef: any, 
    stepOrder: number
  ): Promise<LazyWorkflowStep | null> {
    try {
      const { rows: workflowSteps } = await client.query(
        `INSERT INTO request_steps 
         (request_id, step_id, step_order, name, description, actor_type, actor_value, action_label, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'WAITING')
         RETURNING *`,
        [
          requestId,
          stepDef.id,
          stepOrder,
          stepDef.name,
          stepDef.description,
          stepDef.actor_type,
          stepDef.actor_value,
          stepDef.action_label
        ]
      );

      return workflowSteps[0];

    } catch (error) {
      console.error('Error creating single step:', error);
      return null;
    }
  }

  /**
   * Resolve and assign approver for a single step
   */
  private async resolveAndAssignApprover(
    client: any,
    requestStepId: string,
    stepDef: any,
    request: any
  ): Promise<{ 
    success: boolean; 
    assigned_to?: string; 
    error?: string; 
    warnings?: string[] 
  }> {
    try {
      const stepDefinition: StepDefinition = {
        step_order: stepDef.step_order,
        name: stepDef.name,
        description: stepDef.description,
        actor_type: stepDef.actor_type,
        actor_value: stepDef.actor_value,
        role_id: stepDef.role_id,
        user_id: stepDef.user_id,
        action_label: stepDef.action_label,
        due_days: stepDef.due_days
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
        const approver = resolverResult.approvers[0];
        
        await client.query(
          `UPDATE request_steps 
           SET assigned_to = $1, status = 'PENDING', started_at = NOW(), 
               due_date = NOW() + INTERVAL '${stepDef.due_days || 3} days'
           WHERE id = $2`,
          [approver.user_id, requestStepId]
        );

        return { 
          success: true, 
          assigned_to: approver.user_id,
          warnings: resolverResult.warnings
        };
      } else {
        return { 
          success: false, 
          error: resolverResult.error || 'No approvers found' 
        };
      }

    } catch (error) {
      console.error('Error resolving and assigning approver:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Resume a request after changes (recreate the current step)
   */
  async resumeRequest(requestId: string, updatedFormData: any): Promise<{ 
    success: boolean; 
    step?: LazyWorkflowStep; 
    error?: string; 
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the last step that requested changes
      const { rows: changeSteps } = await client.query(
        `SELECT rs.*, as_.step_order, as_.name, as_.description, as_.actor_type, as_.actor_value, 
                as_.action_label, as_.due_days
         FROM request_steps rs
         JOIN approval_steps as_ ON rs.step_id = as_.id
         WHERE rs.request_id = $1 AND rs.status = 'CHANGES_REQUESTED'
         ORDER BY rs.step_order DESC
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

      // Reset the step (keep same request_step record)
      await client.query(
        `UPDATE request_steps 
         SET status = 'WAITING', assigned_to = NULL, acted_by = NULL, remarks = NULL, 
             completed_at = NULL, started_at = NULL
         WHERE id = $1`,
        [changeStep.id]
      );

      // Get request details
      const { rows: requests } = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      const request = requests[0];

      // Re-resolve and assign approver for this step
      const assignmentResult = await this.resolveAndAssignApprover(
        client, 
        changeStep.id, 
        changeStep, 
        request
      );

      await client.query('COMMIT');

      if (assignmentResult.success) {
        const { rows: updatedSteps } = await client.query(
          'SELECT * FROM request_steps WHERE id = $1',
          [changeStep.id]
        );

        return { 
          success: true, 
          step: updatedSteps[0]
        };
      } else {
        return { 
          success: false, 
          error: assignmentResult.error 
        };
      }

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
   * Get pending steps for a user (only currently active steps)
   */
  async getPendingSteps(userId: string): Promise<LazyWorkflowStep[]> {
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
   * Users can see requests where they:
   * 1. Are the initiator
   * 2. Are assigned to the current step
   * 3. Are a department manager for the request's department
   * 4. Have manage_approvals permission (admins)
   */
  async getUserRequests(userId: string, filters: {
    status?: string;
    department_id?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ requests: LazyWorkflowRequest[]; total: number }> {
    const { status, department_id, page = 1, limit = 10 } = filters;
    const offset = (page - 1) * limit;

    try {
      // Get user's permissions and department
      const { rows: userRows } = await pool.query(
        `SELECT p.id, p.department_id, p.is_admin, r.permissions
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
        // Non-admin users can only see requests where they are:
        // 1. The initiator OR
        // 2. Assigned to the current step OR
        // 3. A department manager for the request's department
        whereClause += `
          AND (
            ar.initiator_id = $${paramIndex++}
            OR EXISTS (
              SELECT 1 FROM request_steps rs 
              WHERE rs.request_id = ar.id 
              AND rs.assigned_to = $${paramIndex++}
              AND rs.status IN ('PENDING', 'WAITING')
            )
            OR (
              ar.department_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM department_managers dm 
                WHERE dm.department_id = ar.department_id 
                AND dm.user_id = $${paramIndex++}
                AND dm.is_active = true
              )
            )
          )
        `;
        queryParams.push(userId, userId, userId);
      }

      if (status) {
        whereClause += ` AND ar.status = $${paramIndex++}`;
        queryParams.push(status);
      }

      if (department_id && hasManageApprovals) {
        whereClause += ` AND ar.department_id = $${paramIndex++}`;
        queryParams.push(department_id);
      }

      // Get total count with DISTINCT to avoid duplicates from multiple visibility conditions
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(DISTINCT ar.id) as total FROM approval_requests ar ${whereClause}`,
        queryParams
      );

      // Get requests with DISTINCT
      const { rows } = await pool.query(
        `SELECT DISTINCT ar.*, p.full_name as initiator_name, d.name as department_name
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

    const allApproved = steps.every((s: any) => s.status === 'APPROVED');
    const anyRejected = steps.some((s: any) => s.status === 'REJECTED');
    const anyChangesRequested = steps.some((s: any) => s.status === 'CHANGES_REQUESTED');

    let newStatus = 'in_progress';
    if (anyRejected) {
      newStatus = 'rejected';
    } else if (anyChangesRequested) {
      newStatus = 'changes_requested';
    } else if (allApproved && steps.length > 0) {
      // Check if this was the last step
      const { rows: totalSteps } = await client.query(
        `SELECT COUNT(*) as count FROM request_steps WHERE request_id = $1`,
        [requestId]
      );
      
      if (totalSteps[0].count === steps.length) {
        newStatus = 'approved';
      }
    }

    await client.query(
      'UPDATE approval_requests SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, requestId]
    );
  }

  /**
   * Get workflow statistics
   */
  async getWorkflowStatistics(requestId: string): Promise<{
    totalSteps: number;
    createdSteps: number;
    activeSteps: number;
    completedSteps: number;
  }> {
    try {
      const { rows: totalSteps } = await pool.query(
        `SELECT COUNT(*) as count FROM approval_steps as_
         JOIN approval_requests ar ON ar.approval_chain_id = as_.chain_id
         WHERE ar.id = $1`,
        [requestId]
      );

      const { rows: createdSteps } = await pool.query(
        `SELECT COUNT(*) as count FROM request_steps WHERE request_id = $1`,
        [requestId]
      );

      const { rows: activeSteps } = await pool.query(
        `SELECT COUNT(*) as count FROM request_steps 
         WHERE request_id = $1 AND status IN ('PENDING', 'WAITING')`,
        [requestId]
      );

      const { rows: completedSteps } = await pool.query(
        `SELECT COUNT(*) as count FROM request_steps 
         WHERE request_id = $1 AND status IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')`,
        [requestId]
      );

      return {
        totalSteps: parseInt(totalSteps[0].count),
        createdSteps: parseInt(createdSteps[0].count),
        activeSteps: parseInt(activeSteps[0].count),
        completedSteps: parseInt(completedSteps[0].count)
      };

    } catch (error) {
      console.error('Error getting workflow statistics:', error);
      return {
        totalSteps: 0,
        createdSteps: 0,
        activeSteps: 0,
        completedSteps: 0
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use initializeWorkflow instead
   */
  async assignApproversToRequest(requestId: string): Promise<LazyAssignmentResult> {
    return await this.initializeWorkflow(requestId);
  }
}
