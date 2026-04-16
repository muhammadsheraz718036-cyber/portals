import { pool } from '../db.js';
import { ApproversResolver, StepDefinition, RequestDefinition } from './ApproversResolver.js';

export interface LegacyStepDefinition {
  step_order: number;
  name: string;
  description?: string;
  role_id?: string;  // DEPRECATED
  user_id?: string;  // DEPRECATED
  actor_type?: string;  // NEW
  actor_value?: string;  // NEW
  action_label: string;
  due_days?: number;
}

export interface AdapterResult {
  success: boolean;
  approvers: any[];
  warnings: string[];
  usedLegacyLogic: boolean;
  error?: string;
}

export class BackwardCompatibilityAdapter {
  private resolver: ApproversResolver;
  private enableWarnings: boolean;

  constructor(enableWarnings: boolean = true) {
    this.resolver = new ApproversResolver();
    this.enableWarnings = enableWarnings;
  }

  /**
   * Resolve approvers with backward compatibility
   * Falls back to old role-based logic if actor_type is NULL
   */
  async resolveApproversWithCompatibility(
    step: LegacyStepDefinition,
    request: RequestDefinition
  ): Promise<AdapterResult> {
    const warnings: string[] = [];
    let usedLegacyLogic = false;

    try {
      // Check if this is a legacy step (actor_type is NULL/undefined)
      if (!step.actor_type) {
        usedLegacyLogic = true;
        
        if (this.enableWarnings) {
          const warning = `Deprecated role-based step detected: "${step.name}" (step_order: ${step.step_order}). Please migrate to actor_type system.`;
          warnings.push(warning);
          await this.logDeprecationWarning(step, request, warning);
        }

        // Use legacy resolution logic
        return await this.resolveLegacyApprovers(step, request, warnings, usedLegacyLogic);
      }

      // Use new resolution logic
      const newStep: StepDefinition = {
        step_order: step.step_order,
        name: step.name,
        description: step.description,
        actor_type: (step.actor_type || 'ROLE') as 'ROLE' | 'USER_MANAGER' | 'DEPARTMENT_MANAGER' | 'SPECIFIC_USER',
        actor_value: step.actor_value,
        role_id: step.role_id,  // Include for compatibility
        user_id: step.user_id,   // Include for compatibility
        action_label: step.action_label,
        due_days: step.due_days
      };

      const result = await this.resolver.resolveApprovers(newStep, request);

      return {
        success: result.success,
        approvers: result.approvers,
        warnings: [...warnings, ...(result.warnings || [])],
        usedLegacyLogic: false,
        error: result.error
      };

    } catch (error) {
      return {
        success: false,
        approvers: [],
        warnings,
        usedLegacyLogic,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Legacy approver resolution for old role-based steps
   */
  private async resolveLegacyApprovers(
    step: LegacyStepDefinition,
    request: RequestDefinition,
    warnings: string[],
    usedLegacyLogic: boolean
  ): Promise<AdapterResult> {
    try {
      let approvers: any[] = [];

      // Legacy logic: Check role_id first (most common)
      if (step.role_id) {
        approvers = await this.resolveByRoleId(step.role_id, request);
        
        if (approvers.length === 0) {
          warnings.push(`No users found for role_id: ${step.role_id}`);
        }
      }
      // Legacy logic: Fall back to user_id
      else if (step.user_id) {
        approvers = await this.resolveByUserId(step.user_id);
        
        if (approvers.length === 0) {
          warnings.push(`User not found for user_id: ${step.user_id}`);
        }
      }
      // Legacy logic: Try to infer from old JSON structure
      else {
        const inferredApprovers = await this.resolveFromLegacyInference(step, request);
        approvers = inferredApprovers.approvers;
        warnings.push(...inferredApprovers.warnings);
      }

      // Convert to approver assignment format
      const assignments = approvers.map(approver => ({
        user_id: approver.id,
        full_name: approver.full_name,
        email: approver.email,
        assignment_type: 'LEGACY_ROLE_BASED',
        department_id: approver.department_id,
        role_id: approver.role_id,
        warnings: warnings.length > 0 ? warnings : undefined
      }));

      return {
        success: assignments.length > 0,
        approvers: assignments,
        warnings,
        usedLegacyLogic
      };

    } catch (error) {
      return {
        success: false,
        approvers: [],
        warnings,
        usedLegacyLogic,
        error: error instanceof Error ? error.message : 'Legacy resolution failed'
      };
    }
  }

  /**
   * Resolve approvers by role_id (legacy method)
   */
  private async resolveByRoleId(roleId: string, request: RequestDefinition): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT p.*, r.name as role_name, r.id as role_id
       FROM profiles p
       JOIN roles r ON p.role_id = r.id
       WHERE p.role_id = $1 
       AND p.is_active = true
       AND ($2::uuid IS NULL OR p.department_id = $2)
       ORDER BY p.full_name`,
      [roleId, request.department_id]
    );

    return rows;
  }

  /**
   * Resolve approvers by user_id (legacy method)
   */
  private async resolveByUserId(userId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT p.*, r.name as role_name, r.id as role_id
       FROM profiles p
       LEFT JOIN roles r ON p.role_id = r.id
       WHERE p.id = $1 
       AND p.is_active = true`,
      [userId]
    );

    return rows;
  }

  /**
   * Try to infer approvers from legacy JSON or other old patterns
   */
  private async resolveFromLegacyInference(
    step: LegacyStepDefinition,
    request: RequestDefinition
  ): Promise<{ approvers: any[]; warnings: string[] }> {
    const warnings: string[] = [];
    let approvers: any[] = [];

    // Try to get step information from approval_steps table
    const { rows: stepInfo } = await pool.query(
      `SELECT * FROM approval_steps WHERE name = $1 AND step_order = $2 LIMIT 1`,
      [step.name, step.step_order]
    );

    if (stepInfo.length > 0) {
      const legacyStep = stepInfo[0];
      
      // Check if there's legacy JSON data
      if (legacyStep.description && legacyStep.description.includes('roleName')) {
        try {
          // Try to extract role from description (legacy pattern)
          const roleMatch = legacyStep.description.match(/roleName['":\s]*['"]([^'"]+)['"]/);
          if (roleMatch) {
            const roleName = roleMatch[1];
            const { rows: roleUsers } = await pool.query(
              `SELECT p.*, r.name as role_name, r.id as role_id
               FROM profiles p
               JOIN roles r ON p.role_id = r.id
               WHERE r.name = $1 AND p.is_active = true
               ORDER BY p.full_name`,
              [roleName]
            );
            approvers = roleUsers;
            warnings.push(`Inferred role "${roleName}" from legacy step description`);
          }
        } catch (error) {
          warnings.push('Failed to infer approvers from legacy step description');
        }
      }
    }

    // Last resort: Try to find manager as fallback
    if (approvers.length === 0) {
      try {
        const { rows: managers } = await pool.query(
          `SELECT DISTINCT p.*, r.name as role_name, r.id as role_id
           FROM profiles p
           JOIN roles r ON p.role_id = r.id
           WHERE r.name ILIKE '%manager%' AND p.is_active = true
           ORDER BY p.full_name
           LIMIT 5`
        );
        
        if (managers.length > 0) {
          approvers = managers;
          warnings.push('Using fallback: assigned to available managers (please configure properly)');
        }
      } catch (error) {
        warnings.push('Failed to find fallback approvers');
      }
    }

    return { approvers, warnings };
  }

  /**
   * Log deprecation warnings for monitoring
   */
  private async logDeprecationWarning(
    step: LegacyStepDefinition,
    request: RequestDefinition,
    warning: string
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO deprecation_logs 
         (component, warning_message, step_name, step_order, request_id, user_id, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          'approval_chain',
          warning,
          step.name,
          step.step_order,
          request.id,
          request.initiator_id
        ]
      );
    } catch (error) {
      console.error('Failed to log deprecation warning:', error);
    }
  }

  /**
   * Get deprecation statistics for monitoring
   */
  async getDeprecationStats(days: number = 30): Promise<{
    total_warnings: number;
    unique_steps: number;
    unique_requests: number;
    most_common_warnings: Array<{ warning: string; count: number }>;
  }> {
    try {
      const { rows: stats } = await pool.query(
        `SELECT 
           COUNT(*) as total_warnings,
           COUNT(DISTINCT step_name || '|' || step_order) as unique_steps,
           COUNT(DISTINCT request_id) as unique_requests
         FROM deprecation_logs 
         WHERE component = 'approval_chain' 
         AND logged_at >= NOW() - INTERVAL '${days} days'`
      );

      const { rows: warnings } = await pool.query(
        `SELECT warning_message, COUNT(*) as count
         FROM deprecation_logs 
         WHERE component = 'approval_chain' 
         AND logged_at >= NOW() - INTERVAL '${days} days'
         GROUP BY warning_message
         ORDER BY count DESC
         LIMIT 10`
      );

      return {
        total_warnings: parseInt(stats[0].total_warnings),
        unique_steps: parseInt(stats[0].unique_steps),
        unique_requests: parseInt(stats[0].unique_requests),
        most_common_warnings: warnings
      };

    } catch (error) {
      console.error('Failed to get deprecation stats:', error);
      return {
        total_warnings: 0,
        unique_steps: 0,
        unique_requests: 0,
        most_common_warnings: []
      };
    }
  }

  /**
   * Migrate a specific step to new actor_type system
   */
  async migrateStep(
    stepId: string,
    newActorType: string,
    newActorValue?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { rows: currentStep } = await pool.query(
        'SELECT * FROM approval_steps WHERE id = $1',
        [stepId]
      );

      if (currentStep.length === 0) {
        return { success: false, error: 'Step not found' };
      }

      const step = currentStep[0];

      // Validate the migration
      if (!newActorType || !['ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER'].includes(newActorType)) {
        return { success: false, error: 'Invalid actor_type' };
      }

      if ((newActorType === 'ROLE' || newActorType === 'DEPARTMENT_MANAGER' || newActorType === 'SPECIFIC_USER') && !newActorValue) {
        return { success: false, error: 'actor_value is required for this actor_type' };
      }

      // Update the step
      await pool.query(
        `UPDATE approval_steps 
         SET actor_type = $1, actor_value = $2, updated_at = NOW()
         WHERE id = $3`,
        [newActorType, newActorValue || null, stepId]
      );

      // Log the migration
      await pool.query(
        `INSERT INTO migration_logs 
         (component, item_id, old_value, new_value, migrated_by, migrated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          'approval_step',
          stepId,
          `actor_type=NULL, role_id=${step.role_id}, user_id=${step.user_id}`,
          `actor_type=${newActorType}, actor_value=${newActorValue}`,
          'system_migration'
        ]
      );

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Migration failed'
      };
    }
  }

  /**
   * Get all legacy steps that need migration
   */
  async getLegacySteps(): Promise<Array<{
    id: string;
    name: string;
    step_order: number;
    role_id?: string;
    user_id?: string;
    chain_name: string;
    usage_count: number;
  }>> {
    try {
      const { rows } = await pool.query(
        `SELECT 
           as_.id,
           as_.name,
           as_.step_order,
           as_.role_id,
           as_.user_id,
           ac.name as chain_name,
           COUNT(rs.id) as usage_count
         FROM approval_steps as_
         JOIN approval_chains ac ON as_.chain_id = ac.id
         LEFT JOIN request_steps rs ON as_.id = rs.step_id
         WHERE as_.actor_type IS NULL
         GROUP BY as_.id, as_.name, as_.step_order, as_.role_id, as_.user_id, ac.name
         ORDER BY usage_count DESC, ac.name, as_.step_order`
      );

      return rows;

    } catch (error) {
      console.error('Failed to get legacy steps:', error);
      return [];
    }
  }

  /**
   * Batch migrate legacy steps
   */
  async batchMigrateSteps(
    migrations: Array<{
      stepId: string;
      actorType: string;
      actorValue?: string;
    }>
  ): Promise<{ 
    success: boolean; 
    migrated: number; 
    failed: number; 
    errors: string[] 
  }> {
    const results = {
      success: true,
      migrated: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const migration of migrations) {
      const result = await this.migrateStep(migration.stepId, migration.actorType, migration.actorValue);
      
      if (result.success) {
        results.migrated++;
      } else {
        results.failed++;
        results.success = false;
        results.errors.push(`Step ${migration.stepId}: ${result.error}`);
      }
    }

    return results;
  }

  /**
   * Enable/disable deprecation warnings
   */
  setWarningsEnabled(enabled: boolean): void {
    this.enableWarnings = enabled;
  }

  /**
   * Check if warnings are enabled
   */
  isWarningsEnabled(): boolean {
    return this.enableWarnings;
  }
}
