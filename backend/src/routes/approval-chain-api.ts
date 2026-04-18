import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../httpError.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  requireAuth,
  requireAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import { ApprovalChainService, ChainStepDefinition } from "../services/ApprovalChainService.js";
import { pool } from "../db.js";

export const createApprovalChainAPIRouter = () => {
  const router = Router();
  const chainService = new ApprovalChainService();

  // Helper function to log audit events
  async function logAudit(
    userId: string,
    userName: string,
    action: string,
    target: string,
    details?: string | null,
  ) {
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, user_name, action, target, details) VALUES ($1, $2, $3, $4, $5)`,
        [userId, userName, action, target, details ?? null],
      );
    } catch (err) {
      console.error("Failed to log audit event:", err);
    }
  }

  // Validation schemas
  const chainStepSchema: z.ZodType<ChainStepDefinition> = z.object({
    step_order: z.number().int().positive(),
    name: z.string().min(1),
    role: z.string().min(1),
    scope_type: z.enum(['initiator_department', 'fixed_department', 'static', 'expression']),
    scope_value: z.string().optional(),
    action_label: z.string().min(1),
    due_days: z.number().int().min(0).max(365).optional(),
    is_parallel: z.boolean().optional(),
    parallel_group: z.string().optional(),
  });

  const createChainSchema = z.object({
    name: z.string().min(1).max(255),
    approval_type_id: z.string().uuid(),
    steps: z.array(chainStepSchema).min(1),
  });

  const updateChainSchema = z.object({
    name: z.string().min(1).max(255),
    approval_type_id: z.string().uuid(),
    steps: z.array(chainStepSchema).min(1),
  });

  // ===============================
  // GET CHAIN OPTIONS FOR UI
  // ===============================

  router.get(
    "/options",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      // Check if user can manage chains
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to manage approval chains");
      }

      const options = await chainService.getChainOptions();

      res.json({
        success: true,
        data: options
      });
    }),
  );

  // ===============================
  // GET ALL APPROVAL CHAINS
  // ===============================

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      // Check if user can manage chains or view them
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("initiate_request") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to view approval chains");
      }

      const chains = await chainService.getAllChains();

      res.json({
        success: true,
        data: chains
      });
    }),
  );

  // ===============================
  // GET SPECIFIC APPROVAL CHAIN
  // ===============================

  router.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;

      // Check permissions
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("initiate_request") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to view approval chains");
      }

      const chain = await chainService.getChainWithSteps(id);

      if (!chain) {
        throw new HttpError(404, "Approval chain not found");
      }

      res.json({
        success: true,
        data: chain
      });
    }),
  );

  // ===============================
  // CREATE APPROVAL CHAIN
  // ===============================

  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      // Check if user has admin access or manage_chains permission
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to create approval chains");
      }

      const body = createChainSchema.parse(req.body);

      const result = await chainService.createApprovalChain(body, req.auth!.userId);

      if (!result.success) {
        if (result.validation) {
          throw new HttpError(400, `Validation failed: ${result.validation.errors.join(', ')}`);
        }
        throw new HttpError(400, result.error || "Failed to create approval chain");
      }

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "CREATE",
        "Approval Chain",
        `Created approval chain: ${body.name} with ${body.steps.length} steps`
      );

      res.status(201).json({
        success: true,
        data: result.chain,
        validation: result.validation
      });
    }),
  );

  // ===============================
  // UPDATE APPROVAL CHAIN
  // ===============================

  router.put(
    "/:id",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;

      // Check if user has admin access or manage_chains permission
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to update approval chains");
      }

      const body = updateChainSchema.parse(req.body);

      const result = await chainService.updateApprovalChain(id, body, req.auth!.userId);

      if (!result.success) {
        if (result.validation) {
          throw new HttpError(400, `Validation failed: ${result.validation.errors.join(', ')}`);
        }
        throw new HttpError(400, result.error || "Failed to update approval chain");
      }

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "UPDATE",
        "Approval Chain",
        `Updated approval chain: ${body.name} with ${body.steps.length} steps`
      );

      res.json({
        success: true,
        data: result.chain,
        validation: result.validation
      });
    }),
  );

  // ===============================
  // DELETE APPROVAL CHAIN
  // ===============================

  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;

      // Check if user has admin access or manage_chains permission
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to delete approval chains");
      }

      // Get chain details for audit log
      const chain = await chainService.getChainWithSteps(id);
      if (!chain) {
        throw new HttpError(404, "Approval chain not found");
      }

      const result = await chainService.deleteApprovalChain(id);

      if (!result.success) {
        throw new HttpError(400, result.error || "Failed to delete approval chain");
      }

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "DELETE",
        "Approval Chain",
        `Deleted approval chain: ${chain.name}`
      );

      res.json({
        success: true,
        message: "Approval chain deleted successfully"
      });
    }),
  );

  // ===============================
  // MIGRATE OLD CHAIN (Backward Compatibility)
  // ===============================

  router.post(
    "/:id/migrate",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;

      // Check if user has admin access or manage_chains permission
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to migrate approval chains");
      }

      const result = await chainService.migrateChainFromJson(id);

      if (!result.success) {
        throw new HttpError(400, result.error || "Failed to migrate approval chain");
      }

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "MIGRATE",
        "Approval Chain",
        `Migrated approval chain: ${id}, migrated ${result.migrated_steps} steps`
      );

      res.json({
        success: true,
        message: `Successfully migrated ${result.migrated_steps} steps`,
        migrated_steps: result.migrated_steps
      });
    }),
  );

  // ===============================
  // VALIDATE CHAIN DEFINITION (Dry Run)
  // ===============================

  router.post(
    "/validate",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      // Check if user can manage chains
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to validate approval chains");
      }

      const body = createChainSchema.parse(req.body);

      const validation = await chainService.validateChainDefinition(body);

      res.json({
        success: true,
        data: validation
      });
    }),
  );

  // ===============================
  // GET CHAIN USAGE STATISTICS
  // ===============================

  router.get(
    "/:id/usage",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;

      // Check permissions
      const isAdmin = req.profile?.is_admin;
      const hasPermission =
        req.profile?.permissions?.includes("manage_chains") ||
        req.profile?.permissions?.includes("all");

      if (!isAdmin && !hasPermission) {
        throw new HttpError(403, "You don't have permission to view chain usage statistics");
      }

      // Get usage statistics
      const { rows: usageStats } = await pool.query(
        `SELECT 
           COUNT(*) as total_requests,
           COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_requests,
           COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_requests,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_requests,
           COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_requests,
           AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_completion_hours
         FROM approval_requests 
         WHERE approval_chain_id = $1`,
        [id]
      );

      // Get step usage statistics
      const { rows: stepStats } = await pool.query(
        `SELECT 
           as_.step_order,
           as_.name,
           as_.actor_type,
           COUNT(rs.id) as total_assignments,
           COUNT(CASE WHEN rs.status = 'APPROVED' THEN 1 END) as approved_count,
           COUNT(CASE WHEN rs.status = 'REJECTED' THEN 1 END) as rejected_count,
           COUNT(CASE WHEN rs.status = 'CHANGES_REQUESTED' THEN 1 END) as changes_requested_count,
           AVG(EXTRACT(EPOCH FROM (rs.completed_at - rs.started_at))/3600) as avg_step_hours
         FROM approval_steps as_
         LEFT JOIN request_steps rs ON as_.id = rs.step_id
         WHERE as_.chain_id = $1
         GROUP BY as_.step_order, as_.name, as_.actor_type
         ORDER BY as_.step_order`,
        [id]
      );

      res.json({
        success: true,
        data: {
          chain_usage: usageStats[0],
          step_usage: stepStats
        }
      });
    }),
  );

  return router;
};
