import { pool } from '../db.js';
import { ApproversResolver, StepDefinition, RequestDefinition, ApproverAssignment } from './ApproversResolver.js';

export interface FixedLazyWorkflowStep {
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
  resumed_from_step_id?: string; // NEW: Track which step this was resumed from
}

export interface FixedLazyWorkflowRequest {
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
  changes_requested_by?: string; // NEW: Track who requested changes
  changes_requested_at?: string; // NEW: Track when changes were requested
}

export interface FixedLazyAssignmentResult {
  success: boolean;
  step_created: boolean;
  approver_assigned: boolean;
  error?: string;
  warnings?: string[];
}

export class FixedLazyWorkflowEngine {
  private resolver: ApproversResolver;

  constructor() {
    this.resolver = new ApproversResolver();
  }

  /**
   * Initialize workflow - ONLY create the first step, do not pre-assign all approvers
   */
  async initializeWorkflow(requestId: string): Promise<FixedLazyAssignmentResult> {
    const result: FixedLazyAssignmentResult = {
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
   * Process an approval action with FIXED request changes logic
   */
  async processApprovalAction(
    requestId: string,
    stepId: string,
    userId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES',
    remarks?: string
  ): Promise<{ 
    success: boolean; 
    nextStep?: FixedLazyWorkflowStep; 
    workflowComplete?: boolean;
    changesRequested?: boolean;
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

      // FIXED: Handle REQUEST_CHANGES differently
      if (action === 'REQUEST_CHANGES') {
        return await this.handleRequestChanges(client, requestId, stepId, userId, remarks);
      }

      // Update the current step for APPROVE/REJECT
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      await client.query(
        `UPDATE request_steps 
         SET status = $1, acted_by = $2, remarks = $3, completed_at = NOW()
         WHERE id = $4`,
        [newStatus, userId, remarks, stepId]
      );

      // Update request status
      await this.updateRequestStatus(client, requestId);

      // Only create next step if approved and not rejected/changes requested
      let nextStep: FixedLazyWorkflowStep | undefined;
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
   * FIXED: Handle request changes - assign back to initiator and stop workflow
   */
  private async handleRequestChanges(
    client: any,
    requestId: string,
    stepId: string,
    userId: string,
    remarks?: string
  ): Promise<{ 
    success: boolean; 
    changesRequested?: boolean;
    error?: string; 
  }> {
    try {
      // Get request details
      const { rows: requests } = await client.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      if (requests.length === 0) {
        return { success: false, error: 'Request not found' };
      }

      const request = requests[0];

      // Mark current step as CHANGES_REQUESTED
      await client.query(
        `UPDATE request_steps 
         SET status = 'CHANGES_REQUESTED', acted_by = $1, remarks = $2, completed_at = NOW()
         WHERE id = $3`,
        [userId, remarks, stepId]
      );

      // FIXED: Update request to track changes requested
      await client.query(
        `UPDATE approval_requests 
         SET status = 'changes_requested', 
             changes_requested_by = $1,
             changes_requested_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [userId, requestId]
      );

      // FIXED: Create a new step assigned to the initiator for resubmission
      const initiatorStep = await this.createInitiatorResubmissionStep(client, requestId, stepId, request.initiator_id);

      if (!initiatorStep) {
        return { success: false, error: 'Failed to create initiator resubmission step' };
      }

      await client.query('COMMIT');

      return { 
        success: true, 
        changesRequested: true
      };

    } catch (error) {
      console.error('Error handling request changes:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * FIXED: Create a step for initiator to resubmit changes
   */
  private async createInitiatorResubmissionStep(
    client: any,
    requestId: string,
    originalStepId: string,
    initiatorId: string
  ): Promise<FixedLazyWorkflowStep | null> {
    try {
      // Get the original step details
      const { rows: originalSteps } = await client.query(
        'SELECT * FROM request_steps WHERE id = $1',
        [originalStepId]
      );

      if (originalSteps.length === 0) {
        return null;
      }

      const originalStep = originalSteps[0];

      // Create a new step for initiator resubmission
      const { rows: newSteps } = await client.query(
        `INSERT INTO request_steps 
         (request_id, step_id, step_order, name, description, actor_type, actor_value, 
          action_label, status, assigned_to, resumed_from_step_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10)
         RETURNING *`,
        [
          requestId,
          originalStep.step_id,
          originalStep.step_order,
          `Resubmit: ${originalStep.name}`,
          `Please address the requested changes and resubmit for review`,
          'SPECIFIC_USER',
          initiatorId,
          'Resubmit',
          initiatorId,
          originalStepId // FIXED: Track which step this was resumed from
        ]
      );

      return newSteps[0];

    } catch (error) {
      console.error('Error creating initiator resubmission step:', error);
      return null;
    }
  }

  /**
   * FIXED: Resume a request after changes - reassign to SAME approver
   */
  async resumeRequest(requestId: string, updatedFormData: any): Promise<{ 
    success: boolean; 
    step?: FixedLazyWorkflowStep; 
    error?: string; 
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // FIXED: Find the initiator's resubmission step (not the changes requested step)
      const { rows: resubmitSteps } = await client.query(
        `SELECT rs.*, as_.step_order, as_.name, as_.description, as_.actor_type, as_.actor_value, 
                as_.action_label, as_.due_days, rs.resumed_from_step_id
         FROM request_steps rs
         JOIN approval_steps as_ ON rs.step_id = as_.id
         WHERE rs.request_id = $1 
         AND rs.status = 'PENDING' 
         AND rs.actor_type = 'SPECIFIC_USER'
         AND rs.resumed_from_step_id IS NOT NULL
         ORDER BY rs.created_at DESC
         LIMIT 1`,
        [requestId]
      );

      if (resubmitSteps.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No pending resubmission step found' };
      }

      const resubmitStep = resubmitSteps[0];

      // Get the original step that requested changes
      const { rows: originalSteps } = await client.query(
        'SELECT * FROM request_steps WHERE id = $1',
        [resubmitStep.resumed_from_step_id]
      );

      if (originalSteps.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Original step not found' };
      }

      const originalStep = originalSteps[0];

      // Update request form data and clear changes tracking
      await client.query(
        `UPDATE approval_requests 
         SET form_data = $1, status = 'in_progress', 
             changes_requested_by = NULL, changes_requested_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedFormData), requestId]
      );

      // FIXED: Mark resubmission step as completed
      await client.query(
        `UPDATE request_steps 
         SET status = 'APPROVED', acted_by = $1, remarks = 'Changes resubmitted by initiator', 
             completed_at = NOW()
         WHERE id = $2`,
        [resubmitStep.assigned_to, resubmitStep.id]
      );

      // FIXED: Reset the original step and reassign to SAME approver
      await client.query(
        `UPDATE request_steps 
         SET status = 'PENDING', assigned_to = $2, acted_by = NULL, remarks = NULL, 
             completed_at = NULL, started_at = NOW()
         WHERE id = $1`,
        [originalStep.id, originalStep.acted_by] // FIXED: Reassign to same approver who requested changes
      );

      // Update due date for the original step
      await client.query(
        `UPDATE request_steps 
         SET due_date = NOW() + INTERVAL '${originalStep.due_days || 3} days'
         WHERE id = $1`,
        [originalStep.id]
      );

      await client.query('COMMIT');

      // Get the updated original step
      const { rows: updatedSteps } = await client.query(
        'SELECT * FROM request_steps WHERE id = $1',
        [originalStep.id]
      );

      return { 
        success: true, 
        step: updatedSteps[0]
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
    step?: FixedLazyWorkflowStep; 
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
  ): Promise<FixedLazyWorkflowStep | null> {
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
   * Get pending steps for a user (only currently active steps)
   */
  async getPendingSteps(userId: string): Promise<FixedLazyWorkflowStep[]> {
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
  } = {}): Promise<{ requests: FixedLazyWorkflowRequest[]; total: number }> {
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
    changesRequestedSteps: number;
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

      const { rows: changesRequestedSteps } = await pool.query(
        `SELECT COUNT(*) as count FROM request_steps 
         WHERE request_id = $1 AND status = 'CHANGES_REQUESTED'`,
        [requestId]
      );

      return {
        totalSteps: parseInt(totalSteps[0].count),
        createdSteps: parseInt(createdSteps[0].count),
        activeSteps: parseInt(activeSteps[0].count),
        completedSteps: parseInt(completedSteps[0].count),
        changesRequestedSteps: parseInt(changesRequestedSteps[0].count)
      };

    } catch (error) {
      console.error('Error getting workflow statistics:', error);
      return {
        totalSteps: 0,
        createdSteps: 0,
        activeSteps: 0,
        completedSteps: 0,
        changesRequestedSteps: 0
      };
    }
  }

  /**
   * Get change request history
   */
  async getChangeRequestHistory(requestId: string): Promise<{
    step_id: string;
    step_name: string;
    requested_by: string;
    requested_at: string;
    remarks: string;
    resumed_at?: string;
  }[]> {
    try {
      const { rows } = await pool.query(
        `SELECT 
           rs.id as step_id,
           rs.name as step_name,
           p.full_name as requested_by,
           rs.completed_at as requested_at,
           rs.remarks,
           rs_resubmitted.completed_at as resumed_at
         FROM request_steps rs
         JOIN profiles p ON rs.acted_by = p.id
         LEFT JOIN request_steps rs_resubmitted ON rs_resubmitted.resumed_from_step_id = rs.id
         WHERE rs.request_id = $1 AND rs.status = 'CHANGES_REQUESTED'
         ORDER BY rs.completed_at DESC`,
        [requestId]
      );

      return rows;

    } catch (error) {
      console.error('Error getting change request history:', error);
      return [];
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use initializeWorkflow instead
   */
  async assignApproversToRequest(requestId: string): Promise<FixedLazyAssignmentResult> {
    return await this.initializeWorkflow(requestId);
  }
}
