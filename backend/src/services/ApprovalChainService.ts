import { pool } from '../db.js';

export interface ChainStepDefinition {
  step_order: number;
  name: string;
  role: string;
  scope_type: 'initiator_department' | 'fixed_department' | 'static' | 'expression';
  scope_value?: string;
  action_label: string;
  due_days?: number;
  is_parallel?: boolean;
  parallel_group?: string;
}

export interface ApprovalChainDefinition {
  name: string;
  approval_type_id: string;
  steps: ChainStepDefinition[];
}

export interface ApprovalChainValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ApprovalChainService {

  /**
   * Create a new approval chain with actor_type + actor_value system
   */
  async createApprovalChain(
    chainDefinition: ApprovalChainDefinition,
    createdBy: string
  ): Promise<{ success: boolean; chain?: any; error?: string; validation?: ApprovalChainValidationResult }> {
    
    // Validate the chain definition first
    const validation = await this.validateChainDefinition(chainDefinition);
    
    if (!validation.is_valid) {
      return {
        success: false,
        error: 'Chain definition validation failed',
        validation
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create the approval chain
      const { rows: chains } = await client.query(
        `INSERT INTO approval_chains (name, approval_type_id, steps, created_by, updated_at) 
         VALUES ($1, $2, $3::jsonb, $4, NOW()) 
         RETURNING *`,
        [
          chainDefinition.name.trim(),
          chainDefinition.approval_type_id,
          JSON.stringify(chainDefinition.steps),
          createdBy
        ]
      );

      const chain = chains[0];

      // Create approval_steps records for the new chain
      for (const step of chainDefinition.steps) {
        await this.createChainStep(client, chain.id, step);
      }

      await client.query('COMMIT');

      // Get the complete chain with steps
      const completeChain = await this.getChainWithSteps(chain.id);

      return {
        success: true,
        chain: completeChain,
        validation
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
   * Update an existing approval chain
   */
  async updateApprovalChain(
    chainId: string,
    chainDefinition: ApprovalChainDefinition,
    updatedBy: string
  ): Promise<{ success: boolean; chain?: any; error?: string; validation?: ApprovalChainValidationResult }> {
    
    // Validate the chain definition first
    const validation = await this.validateChainDefinition(chainDefinition);
    
    if (!validation.is_valid) {
      return {
        success: false,
        error: 'Chain definition validation failed',
        validation
      };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update the approval chain
      const { rows: chains } = await client.query(
        `UPDATE approval_chains 
         SET name = $1, approval_type_id = $2, steps = $3::jsonb, updated_at = NOW() 
         WHERE id = $4 
         RETURNING *`,
        [
          chainDefinition.name.trim(),
          chainDefinition.approval_type_id,
          JSON.stringify(chainDefinition.steps),
          chainId
        ]
      );

      if (chains.length === 0) {
        throw new Error('Approval chain not found');
      }

      // Delete existing steps and create new ones
      await client.query('DELETE FROM approval_steps WHERE chain_id = $1', [chainId]);

      for (const step of chainDefinition.steps) {
        await this.createChainStep(client, chainId, step);
      }

      await client.query('COMMIT');

      // Get the complete chain with steps
      const completeChain = await this.getChainWithSteps(chainId);

      return {
        success: true,
        chain: completeChain,
        validation
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
   * Create a single chain step
   */
  private async createChainStep(client: any, chainId: string, step: ChainStepDefinition): Promise<void> {
    await client.query(
      `INSERT INTO approval_steps 
       (chain_id, step_order, name, role, scope_type, scope_value, actor_type, actor_value, action_label, due_days, is_parallel, parallel_group)
       VALUES ($1, $2, $3, $4, $5, $6, 'ROLE', $4, $7, $8, $9, $10)`,
      [
        chainId,
        step.step_order,
        step.name,
        step.role,
        step.scope_type,
        step.scope_value || null,
        step.action_label,
        step.due_days || 3,
        step.is_parallel || false,
        step.parallel_group || null
      ]
    );
  }

  /**
   * Validate chain definition
   */
  async validateChainDefinition(chainDefinition: ApprovalChainDefinition): Promise<ApprovalChainValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!chainDefinition.name || chainDefinition.name.trim().length === 0) {
      errors.push('Chain name is required');
    }

    if (!chainDefinition.approval_type_id) {
      errors.push('Approval type ID is required');
    }

    if (!chainDefinition.steps || chainDefinition.steps.length === 0) {
      errors.push('At least one step is required');
    }

    // Step validation
    if (chainDefinition.steps) {
      const stepOrders = new Set<number>();
      
      for (let i = 0; i < chainDefinition.steps.length; i++) {
        const step = chainDefinition.steps[i];
        const stepNumber = i + 1;

        // Step order validation
        if (!step.step_order || step.step_order <= 0) {
          errors.push(`Step ${stepNumber}: step_order must be a positive integer`);
        } else if (stepOrders.has(step.step_order)) {
          errors.push(`Step ${stepNumber}: duplicate step_order ${step.step_order}`);
        } else {
          stepOrders.add(step.step_order);
        }

        // Name validation
        if (!step.name || step.name.trim().length === 0) {
          errors.push(`Step ${stepNumber}: name is required`);
        }

        if (!step.role || step.role.trim().length === 0) {
          errors.push(`Step ${stepNumber}: role is required`);
        }

        if (!['initiator_department', 'fixed_department', 'static', 'expression'].includes(step.scope_type)) {
          errors.push(`Step ${stepNumber}: invalid scope_type ${step.scope_type}`);
        }

        if (step.scope_type === 'fixed_department' && !step.scope_value) {
          errors.push(`Step ${stepNumber}: scope_value is required for fixed_department`);
        }

        if (step.scope_type === 'expression' && !step.scope_value) {
          errors.push(`Step ${stepNumber}: scope_value is required for expression`);
        }

        // Action label validation
        if (!step.action_label || step.action_label.trim().length === 0) {
          errors.push(`Step ${stepNumber}: action_label is required`);
        }

        // Due days validation
        if (step.due_days !== undefined && (step.due_days < 0 || step.due_days > 365)) {
          warnings.push(`Step ${stepNumber}: due_days should be between 0 and 365`);
        }

        // Parallel validation
        if (step.is_parallel && !step.parallel_group) {
          warnings.push(`Step ${stepNumber}: parallel step should have a parallel_group`);
        }
      }
    }

    // Check for logical flow issues
    if (chainDefinition.steps && chainDefinition.steps.length > 0) {
      const hasExpressionManager = chainDefinition.steps.some(
        step => step.scope_type === 'expression' && step.scope_value === 'initiator_manager'
      );
      const hasInitiatorDepartment = chainDefinition.steps.some(
        step => step.scope_type === 'initiator_department'
      );
      
      if (hasExpressionManager && hasInitiatorDepartment) {
        warnings.push('Chain mixes initiator manager and initiator department scopes - verify this sequence is intentional');
      }

      // Check if all steps are parallel (might be a configuration error)
      const allParallel = chainDefinition.steps.every(step => step.is_parallel);
      if (allParallel && chainDefinition.steps.length > 1) {
        warnings.push('All steps are marked as parallel - ensure this is intentional');
      }
    }

    return {
      is_valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get chain with steps
   */
  async getChainWithSteps(chainId: string): Promise<any> {
    const { rows: chains } = await pool.query(
      'SELECT * FROM approval_chains WHERE id = $1',
      [chainId]
    );

    if (chains.length === 0) {
      return null;
    }

    const chain = chains[0];

    const { rows: steps } = await pool.query(
      `SELECT * FROM approval_steps 
       WHERE chain_id = $1 
       ORDER BY step_order`,
      [chainId]
    );

    return {
      ...chain,
      steps: steps,
      steps_json: typeof chain.steps === 'string' ? JSON.parse(chain.steps) : chain.steps
    };
  }

  /**
   * Get all chains with their steps
   */
  async getAllChains(): Promise<any[]> {
    const { rows: chains } = await pool.query(
      `SELECT ac.*, at.name as approval_type_name 
       FROM approval_chains ac
       LEFT JOIN approval_types at ON ac.approval_type_id = at.id
       ORDER BY ac.name`
    );

    // Get steps for each chain
    for (const chain of chains) {
      const { rows: steps } = await pool.query(
        `SELECT * FROM approval_steps 
         WHERE chain_id = $1 
         ORDER BY step_order`,
        [chain.id]
      );
      chain.steps = steps;
    }

    return chains;
  }

  /**
   * Migrate old JSON-based chains to new actor_type system
   */
  async migrateChainFromJson(chainId: string): Promise<{ success: boolean; migrated_steps: number; error?: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the chain with JSON steps
      const { rows: chains } = await client.query(
        'SELECT * FROM approval_chains WHERE id = $1',
        [chainId]
      );

      if (chains.length === 0) {
        throw new Error('Chain not found');
      }

      const chain = chains[0];
      const jsonSteps = typeof chain.steps === 'string' ? JSON.parse(chain.steps) : chain.steps;

      if (!Array.isArray(jsonSteps) || jsonSteps.length === 0) {
        return { success: true, migrated_steps: 0 };
      }

      // Delete existing steps
      await client.query('DELETE FROM approval_steps WHERE chain_id = $1', [chainId]);

      let migratedSteps = 0;

      // Convert JSON steps to new format
      for (let i = 0; i < jsonSteps.length; i++) {
        const jsonStep = jsonSteps[i];
        
        const newStep: ChainStepDefinition = {
          step_order: jsonStep.step_order || jsonStep.order || (i + 1),
          name: jsonStep.name || `Step ${i + 1}`,
          role: this.getRoleFromJson(jsonStep),
          scope_type: this.inferScopeTypeFromJson(jsonStep),
          scope_value: this.getScopeValueFromJson(jsonStep),
          action_label: jsonStep.action_label || jsonStep.action || 'Review',
          due_days: jsonStep.due_days,
          is_parallel: jsonStep.is_parallel,
          parallel_group: jsonStep.parallel_group
        };

        await this.createChainStep(client, chainId, newStep);
        migratedSteps++;
      }

      await client.query('COMMIT');

      return { success: true, migrated_steps: migratedSteps };

    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        migrated_steps: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      client.release();
    }
  }

  /**
   * Infer actor type from JSON step (backward compatibility)
   */
  private inferScopeTypeFromJson(jsonStep: any): 'initiator_department' | 'fixed_department' | 'static' | 'expression' {
    if (jsonStep.scope_type) {
      return jsonStep.scope_type;
    }
    if (jsonStep.type === 'manager') {
      return 'expression';
    }
    if (jsonStep.type === 'department_manager') {
      return jsonStep.actor_value || jsonStep.scope_value ? 'fixed_department' : 'initiator_department';
    }
    if (jsonStep.type === 'user') {
      return 'expression';
    }
    return 'static';
  }

  /**
   * Get role from JSON step (backward compatibility)
   */
  private getRoleFromJson(jsonStep: any): string {
    return jsonStep.role || jsonStep.roleName || jsonStep.role_name || (
      jsonStep.type === 'department_manager' ? 'Department Manager' :
      jsonStep.type === 'manager' ? 'Line Manager' :
      jsonStep.type === 'user' ? 'Specific User' :
      'Approver'
    );
  }

  /**
   * Get scope value from JSON step (backward compatibility)
   */
  private getScopeValueFromJson(jsonStep: any): string | undefined {
    if (jsonStep.scope_value) {
      return jsonStep.scope_value;
    }
    if (jsonStep.type === 'user') {
      return jsonStep.userId ? `user:${jsonStep.userId}` : undefined;
    } else if (jsonStep.type === 'manager') {
      return 'initiator_manager';
    } else if (jsonStep.type === 'department_manager') {
      return jsonStep.departmentId || jsonStep.actor_value;
    }
    return undefined;
  }

  /**
   * Get available options for UI
   */
  async getChainOptions(): Promise<{
    scope_types: { value: string; label: string; description: string }[];
    departments: { value: string; label: string }[];
    users: { value: string; label: string; email: string }[];
    roles: { value: string; label: string }[];
  }> {
    // Get departments
    const { rows: departments } = await pool.query(
      'SELECT id, name FROM departments ORDER BY name'
    );

    // Get users with profiles
    const { rows: users } = await pool.query(
      `SELECT u.id, p.full_name, p.email 
       FROM users u 
       JOIN profiles p ON u.id = p.id 
       WHERE p.is_active = true 
       ORDER BY p.full_name`
    );

    // Get roles
    const { rows: roles } = await pool.query(
      'SELECT id, name FROM roles ORDER BY name'
    );

    return {
      scope_types: [
        {
          value: 'initiator_department',
          label: 'Initiator Department',
          description: 'Resolve the approver in the request initiator department'
        },
        {
          value: 'fixed_department',
          label: 'Fixed Department',
          description: 'Resolve the approver in a specific department'
        },
        {
          value: 'static',
          label: 'Global Static',
          description: 'Resolve the approver by role without department scoping'
        },
        {
          value: 'expression',
          label: 'Expression',
          description: 'Resolve the approver from a supported expression such as initiator_manager'
        }
      ],
      departments: departments.map(d => ({ value: d.id, label: d.name })),
      users: users.map(u => ({ value: u.id, label: u.full_name, email: u.email })),
      roles: roles.map(r => ({ value: r.name, label: r.name }))
    };
  }

  /**
   * Delete an approval chain
   */
  async deleteApprovalChain(chainId: string): Promise<{ success: boolean; error?: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if chain is being used by any requests
      const { rows: requests } = await client.query(
        'SELECT COUNT(*) as count FROM approval_requests WHERE approval_chain_id = $1',
        [chainId]
      );

      if (parseInt(requests[0].count) > 0) {
        return {
          success: false,
          error: 'Cannot delete chain that is being used by requests'
        };
      }

      // Delete steps first (foreign key constraint)
      await client.query('DELETE FROM approval_steps WHERE chain_id = $1', [chainId]);

      // Delete the chain
      await client.query('DELETE FROM approval_chains WHERE id = $1', [chainId]);

      await client.query('COMMIT');

      return { success: true };

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
}
