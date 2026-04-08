import { pool } from '../db.js';
import { ApproversResolver, StepDefinition, RequestDefinition } from './ApproversResolver.js';
import { BackwardCompatibilityAdapter, LegacyStepDefinition } from './BackwardCompatibilityAdapter.js';

export interface CompatibleStepDefinition {
  step_order: number;
  name: string;
  description?: string;
  actor_type?: string;  // NULL for legacy steps
  actor_value?: string;  // NULL for legacy steps
  role_id?: string;     // DEPRECATED - for legacy steps
  user_id?: string;     // DEPRECATED - for legacy steps
  action_label: string;
  due_days?: number;
}

export interface CompatibleResolverResult {
  success: boolean;
  approvers: any[];
  warnings: string[];
  used_legacy_logic: boolean;
  error?: string;
}

export class CompatibleApproversResolver {
  private resolver: ApproversResolver;
  private adapter: BackwardCompatibilityAdapter;

  constructor(enableWarnings: boolean = true) {
    this.resolver = new ApproversResolver();
    this.adapter = new BackwardCompatibilityAdapter(enableWarnings);
  }

  /**
   * Resolve approvers with full backward compatibility
   * Automatically detects legacy steps and falls back to old logic
   */
  async resolveApprovers(
    step: CompatibleStepDefinition,
    request: RequestDefinition
  ): Promise<CompatibleResolverResult> {
    try {
      // Use the adapter which handles both new and legacy logic
      const result = await this.adapter.resolveApproversWithCompatibility(step, request);

      return {
        success: result.success,
        approvers: result.approvers,
        warnings: result.warnings,
        used_legacy_logic: result.used_legacy_logic,
        error: result.error
      };

    } catch (error) {
      return {
        success: false,
        approvers: [],
        warnings: [],
        used_legacy_logic: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Batch resolve approvers for multiple steps
   */
  async resolveApproversBatch(
    steps: CompatibleStepDefinition[],
    request: RequestDefinition
  ): Promise<{
    success: boolean;
    results: CompatibleResolverResult[];
    summary: {
      total_steps: number;
      successful_resolutions: number;
      legacy_steps_used: number;
      total_warnings: number;
    };
    error?: string;
  }> {
    const results: CompatibleResolverResult[] = [];
    let successfulResolutions = 0;
    let legacyStepsUsed = 0;
    let totalWarnings = 0;

    try {
      for (const step of steps) {
        const result = await this.resolveApprovers(step, request);
        results.push(result);

        if (result.success) {
          successfulResolutions++;
        }

        if (result.used_legacy_logic) {
          legacyStepsUsed++;
        }

        totalWarnings += result.warnings.length;
      }

      return {
        success: true,
        results,
        summary: {
          total_steps: steps.length,
          successful_resolutions: successfulResolutions,
          legacy_steps_used: legacyStepsUsed,
          total_warnings: totalWarnings
        }
      };

    } catch (error) {
      return {
        success: false,
        results,
        summary: {
          total_steps: steps.length,
          successful_resolutions: successfulResolutions,
          legacy_steps_used: legacyStepsUsed,
          total_warnings: totalWarnings
        },
        error: error instanceof Error ? error.message : 'Batch resolution failed'
      };
    }
  }

  /**
   * Check if a user can act on a step with backward compatibility
   */
  async canUserActOnStep(userId: string, stepId: string): Promise<boolean> {
    try {
      // Get request_steps record to find the request_id
      const { rows: requestSteps } = await pool.query(
        'SELECT request_id FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (requestSteps.length === 0) {
        return false;
      }

      const requestId = requestSteps[0].request_id;

      // Get request definition
      const request = await this.getRequestDefinition(requestId);
      if (!request) {
        return false;
      }

      // Get step definition (could be legacy or new)
      const step = await this.getStepDefinition(stepId);
      if (!step) {
        return false;
      }

      // Resolve approvers using compatible resolver
      const result = await this.resolveApprovers(step, request);

      if (!result.success) {
        return false;
      }

      // Check if user is in the approvers list
      return result.approvers.some(approver => approver.user_id === userId);

    } catch (error) {
      console.error('Error checking user step access:', error);
      return false;
    }
  }

  /**
   * Get step definition with backward compatibility
   */
  async getStepDefinition(stepId: string): Promise<CompatibleStepDefinition | null> {
    try {
      const { rows } = await pool.query(
        `SELECT 
           rs.step_order,
           rs.name,
           rs.description,
           rs.actor_type,
           rs.actor_value,
           as_.role_id,    -- DEPRECATED
           as_.user_id,    -- DEPRECATED
           rs.action_label,
           rs.due_days
         FROM request_steps rs
         JOIN approval_steps as_ ON rs.step_id = as_.id
         WHERE rs.id = $1`,
        [stepId]
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      return {
        step_order: row.step_order,
        name: row.name,
        description: row.description,
        actor_type: row.actor_type,
        actor_value: row.actor_value,
        role_id: row.role_id,      // Keep for legacy compatibility
        user_id: row.user_id,      // Keep for legacy compatibility
        action_label: row.action_label,
        due_days: row.due_days
      };

    } catch (error) {
      console.error('Error getting step definition:', error);
      return null;
    }
  }

  /**
   * Get request definition
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

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      return {
        id: row.id,
        initiator_id: row.initiator_id,
        department_id: row.department_id,
        approval_chain_id: row.approval_chain_id,
        status: row.status,
        current_step: row.current_step
      };

    } catch (error) {
      console.error('Error getting request definition:', error);
      return null;
    }
  }

  /**
   * Get legacy steps that need migration
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
    return await this.adapter.getLegacySteps();
  }

  /**
   * Migrate a specific step
   */
  async migrateStep(
    stepId: string,
    newActorType: string,
    newActorValue?: string
  ): Promise<{ success: boolean; error?: string }> {
    return await this.adapter.migrateStep(stepId, newActorType, newActorValue);
  }

  /**
   * Get deprecation statistics
   */
  async getDeprecationStats(days: number = 30): Promise<{
    total_warnings: number;
    unique_steps: number;
    unique_requests: number;
    most_common_warnings: Array<{ warning: string; count: number }>;
  }> {
    return await this.adapter.getDeprecationStats(days);
  }

  /**
   * Enable/disable deprecation warnings
   */
  setWarningsEnabled(enabled: boolean): void {
    this.adapter.setWarningsEnabled(enabled);
  }

  /**
   * Check if warnings are enabled
   */
  isWarningsEnabled(): boolean {
    return this.adapter.isWarningsEnabled();
  }

  /**
   * Get migration progress report
   */
  async getMigrationProgress(): Promise<{
    total_legacy_steps: number;
    migrated_steps: number;
    remaining_steps: number;
    migration_percentage: number;
    recent_migrations: Array<{
      step_id: string;
      step_name: string;
      migrated_at: string;
      old_value: string;
      new_value: string;
    }>;
  }> {
    try {
      // Get legacy steps count
      const legacySteps = await this.getLegacySteps();
      const totalLegacySteps = legacySteps.length;

      // Get migrated steps count from migration logs
      const { rows: migratedCount } = await pool.query(
        `SELECT COUNT(*) as count 
         FROM migration_logs 
         WHERE component = 'approval_step' 
         AND migration_status = 'success'
         AND migrated_at >= now() - interval '30 days'`
      );

      const migratedSteps = parseInt(migratedCount[0].count);
      const remainingSteps = Math.max(0, totalLegacySteps - migratedSteps);
      const migrationPercentage = totalLegacySteps > 0 ? (migratedSteps / totalLegacySteps) * 100 : 100;

      // Get recent migrations
      const { rows: recentMigrations } = await pool.query(
        `SELECT 
           item_id as step_id,
           old_value,
           new_value,
           migrated_at,
           as_.name as step_name
         FROM migration_logs ml
         JOIN approval_steps as_ ON ml.item_id = as_.id
         WHERE ml.component = 'approval_step' 
         AND ml.migration_status = 'success'
         ORDER BY ml.migrated_at DESC
         LIMIT 10`
      );

      return {
        total_legacy_steps: totalLegacySteps,
        migrated_steps: migratedSteps,
        remaining_steps: remainingSteps,
        migration_percentage: Math.round(migrationPercentage * 100) / 100,
        recent_migrations: recentMigrations
      };

    } catch (error) {
      console.error('Error getting migration progress:', error);
      return {
        total_legacy_steps: 0,
        migrated_steps: 0,
        remaining_steps: 0,
        migration_percentage: 0,
        recent_migrations: []
      };
    }
  }

  /**
   * Generate migration recommendations
   */
  async generateMigrationRecommendations(): Promise<{
    high_priority: Array<{
      step_id: string;
      step_name: string;
      chain_name: string;
      usage_count: number;
      recommended_actor_type: string;
      recommended_actor_value?: string;
      reason: string;
    }>;
    medium_priority: Array<{
      step_id: string;
      step_name: string;
      chain_name: string;
      usage_count: number;
      recommended_actor_type: string;
      recommended_actor_value?: string;
      reason: string;
    }>;
    low_priority: Array<{
      step_id: string;
      step_name: string;
      chain_name: string;
      usage_count: number;
      recommended_actor_type: string;
      recommended_actor_value?: string;
      reason: string;
    }>;
  }> {
    try {
      const legacySteps = await this.getLegacySteps();
      const highPriority = [];
      const mediumPriority = [];
      const lowPriority = [];

      for (const step of legacySteps) {
        let recommendation = {
          step_id: step.id,
          step_name: step.name,
          chain_name: step.chain_name,
          usage_count: step.usage_count,
          recommended_actor_type: '',
          recommended_actor_value: undefined as string | undefined,
          reason: ''
        };

        // Analyze step to determine best migration path
        if (step.role_id) {
          // Role-based step
          const { rows: roleInfo } = await pool.query(
            'SELECT name FROM roles WHERE id = $1',
            [step.role_id]
          );

          if (roleInfo.length > 0) {
            const roleName = roleInfo[0].name;
            
            if (roleName.toLowerCase().includes('manager')) {
              recommendation.recommended_actor_type = 'USER_MANAGER';
              recommendation.reason = 'Role-based manager assignment - migrate to dynamic USER_MANAGER';
            } else {
              recommendation.recommended_actor_type = 'ROLE';
              recommendation.recommended_actor_value = roleName;
              recommendation.reason = 'Standard role-based assignment - convert to new ROLE format';
            }
          }
        } else if (step.user_id) {
          // User-specific step
          recommendation.recommended_actor_type = 'SPECIFIC_USER';
          recommendation.recommended_actor_value = step.user_id;
          recommendation.reason = 'User-specific assignment - convert to SPECIFIC_USER';
        } else {
          // Unspecified - recommend USER_MANAGER as default
          recommendation.recommended_actor_type = 'USER_MANAGER';
          recommendation.reason = 'Unspecified assignment - default to USER_MANAGER';
        }

        // Prioritize based on usage
        if (step.usage_count > 100) {
          highPriority.push(recommendation);
        } else if (step.usage_count > 10) {
          mediumPriority.push(recommendation);
        } else {
          lowPriority.push(recommendation);
        }
      }

      return {
        high_priority: highPriority,
        medium_priority: mediumPriority,
        low_priority: lowPriority
      };

    } catch (error) {
      console.error('Error generating migration recommendations:', error);
      return {
        high_priority: [],
        medium_priority: [],
        low_priority: []
      };
    }
  }
}
