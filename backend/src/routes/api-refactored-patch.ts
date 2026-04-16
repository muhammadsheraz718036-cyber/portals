// This file contains patches to integrate the refactored approval system
// with existing API routes while maintaining backward compatibility

import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../httpError.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  requireAuth,
  requireAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import { BackwardCompatibilityWrapper } from "../services/BackwardCompatibilityWrapper.js";

export const createRefactoredApiRouter = () => {
  const apiRouter = Router();
  const legacyWrapper = new BackwardCompatibilityWrapper();

  // Helper function to log audit events (unchanged)
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

  // ===============================
  // REFACTORED APPROVAL REQUEST ENDPOINTS
  // ===============================

  // Create approval request (refactored with dynamic resolution)
  const createRequestBody = z.object({
    title: z.string().min(1),
    approval_type_id: z.string().uuid(),
    form_data: z.record(z.any()),
    approval_chain_id: z.string().uuid().optional(),
    department_id: z.string().uuid().optional(),
  });

  apiRouter.post(
    "/approval-requests",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = createRequestBody.parse(req.body);
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canInitiate = 
        userPermissions.includes("initiate_request") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canInitiate) {
        throw new HttpError(403, "You don't have permission to create requests");
      }

      try {
        const request = await legacyWrapper.createRequestLegacy(userId, body);

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "CREATE",
          "Approval Request",
          `Created approval request: ${request.request_number}`,
        );

        res.status(201).json(request);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Create request error:', error);
        throw new HttpError(500, "Failed to create request");
      }
    }),
  );

  // Get approval requests (refactored with department scoping)
  apiRouter.get(
    "/approval-requests",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const filters = {
        status: req.query.status as string,
        department_id: req.query.department_id as string,
        initiator_id: req.query.initiator_id as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
      };

      try {
        const result = await legacyWrapper.getRequestsLegacy(userId, filters);
        res.json(result);
      } catch (error) {
        console.error('Get requests error:', error);
        throw new HttpError(500, "Failed to get requests");
      }
    }),
  );

  // Get single approval request (refactored)
  apiRouter.get(
    "/approval-requests/:id",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const requestId = req.params.id;
      const userId = req.auth!.userId;

      try {
        const request = await legacyWrapper.getRequestDetailsLegacy(userId, requestId);

        // Apply visibility rules
        const userPermissions = req.profile?.permissions || [];
        const hasManageApprovals = 
          userPermissions.includes("manage_approvals") ||
          userPermissions.includes("all") ||
          req.profile?.is_admin;

        if (!hasManageApprovals) {
          // Check if user can access: is initiator OR assigned to current step OR is department manager
          const isInitiator = request.initiator_id === userId;
          
          // Check if assigned to current step
          const { rows: steps } = await pool.query(
            `SELECT 1 FROM request_steps 
             WHERE request_id = $1 
             AND assigned_to = $2 
             AND status IN ('PENDING', 'WAITING')
             LIMIT 1`,
            [requestId, userId]
          );
          const isAssignedToStep = steps.length > 0;

          // Check if is department manager for request's department
          const { rows: deptMgr } = await pool.query(
            `SELECT 1 FROM department_managers 
             WHERE department_id = $1 
             AND user_id = $2 
             AND is_active = true 
             LIMIT 1`,
            [request.department_id, userId]
          );
          const isDepartmentManager = deptMgr.length > 0;

          if (!isInitiator && !isAssignedToStep && !isDepartmentManager) {
            throw new HttpError(403, "Access denied");
          }
        }

        res.json(request);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Get request error:', error);
        throw new HttpError(500, "Failed to get request");
      }
    }),
  );

  // ===============================
  // REFACTORED APPROVAL ACTION ENDPOINTS
  // ===============================

  // Approve request (refactored with dynamic resolution)
  const actionBody = z.object({
    comment: z.string().optional(),
  });

  apiRouter.post(
    "/approval-requests/:id/approve",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const requestId = req.params.id;
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canApproveReject =
        userPermissions.includes("approve_reject") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canApproveReject) {
        throw new HttpError(403, "You don't have permission to approve requests");
      }

      try {
        const result = await legacyWrapper.approveRequestLegacy(userId, requestId, body.comment);

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "APPROVE",
          "Approval Request",
          `Approved request: ${result.request_number}`,
        );

        res.json(result);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Approve request error:', error);
        throw new HttpError(500, "Failed to approve request");
      }
    }),
  );

  // Reject request (refactored)
  apiRouter.post(
    "/approval-requests/:id/reject",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const requestId = req.params.id;
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canApproveReject =
        userPermissions.includes("approve_reject") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canApproveReject) {
        throw new HttpError(403, "You don't have permission to reject requests");
      }

      try {
        const result = await legacyWrapper.rejectRequestLegacy(userId, requestId, body.comment);

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "REJECT",
          "Approval Request",
          `Rejected request: ${result.request_number}`,
        );

        res.json(result);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Reject request error:', error);
        throw new HttpError(500, "Failed to reject request");
      }
    }),
  );

  // Request changes (new functionality)
  apiRouter.post(
    "/approval-requests/:id/request-changes",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const requestId = req.params.id;
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canApproveReject =
        userPermissions.includes("approve_reject") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canApproveReject) {
        throw new HttpError(403, "You don't have permission to request changes");
      }

      try {
        // Find the current pending step for this user
        const { rows } = await pool.query(
          `SELECT rs.id as step_id
           FROM request_steps rs
           WHERE rs.request_id = $1 
           AND rs.assigned_to = $2 
           AND rs.status IN ('PENDING', 'WAITING')
           ORDER BY rs.step_order ASC
           LIMIT 1`,
          [requestId, userId]
        );

        if (rows.length === 0) {
          throw new HttpError(400, "No pending approval step found for this user");
        }

        const result = await legacyWrapper.getRefactoredService().processAction(userId, {
          request_id: requestId,
          step_id: rows[0].step_id,
          action: 'REQUEST_CHANGES',
          comment: body.comment
        });

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "REQUEST_CHANGES",
          "Approval Request",
          `Requested changes for: ${result.request_number}`,
        );

        res.json(result);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Request changes error:', error);
        throw new HttpError(500, "Failed to request changes");
      }
    }),
  );

  // Resume request after changes (new functionality)
  const resumeBody = z.object({
    title: z.string().optional(),
    form_data: z.record(z.any()),
  });

  apiRouter.post(
    "/approval-requests/:id/resume",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = resumeBody.parse(req.body);
      const requestId = req.params.id;
      const userId = req.auth!.userId;

      try {
        const result = await legacyWrapper.getRefactoredService().resumeRequest(userId, requestId, body);

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "RESUME",
          "Approval Request",
          `Resumed request: ${result.request_number}`,
        );

        res.json(result);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        console.error('Resume request error:', error);
        throw new HttpError(500, "Failed to resume request");
      }
    }),
  );

  // ===============================
  // REFACTORED PENDING ACTIONS ENDPOINT
  // ===============================

  // Get pending actions (refactored with department scoping)
  apiRouter.get(
    "/approval-actions/pending",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;

      try {
        const pendingActions = await legacyWrapper.getPendingActionsLegacy(userId);
        res.json(pendingActions);
      } catch (error) {
        console.error('Get pending actions error:', error);
        throw new HttpError(500, "Failed to get pending actions");
      }
    }),
  );

  // ===============================
  // MIGRATION AND STATUS ENDPOINTS (Admin only)
  // ===============================

  // Get migration status
  apiRouter.get(
    "/system/migration-status",
    requireAdmin,
    asyncHandler(async (_req: AuthedRequest, res) => {
      try {
        const status = await legacyWrapper.getMigrationStatus();
        res.json(status);
      } catch (error) {
        console.error('Get migration status error:', error);
        throw new HttpError(500, "Failed to get migration status");
      }
    }),
  );

  // Run migration (admin only, careful with this)
  apiRouter.post(
    "/system/migrate",
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        await legacyWrapper.migrateExistingData();
        res.json({ message: "Migration completed successfully" });
      } catch (error) {
        console.error('Migration error:', error);
        throw new HttpError(500, "Migration failed");
      }
    }),
  );

  // ===============================
  // DEPARTMENT MANAGEMENT ENDPOINTS (Enhanced)
  // ===============================

  // Set department manager
  const setDepartmentManagerBody = z.object({
    user_id: z.string().uuid(),
  });

  apiRouter.post(
    "/departments/:id/managers",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = setDepartmentManagerBody.parse(req.body);
      const departmentId = req.params.id;
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canManageDepartments =
        userPermissions.includes("manage_departments") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canManageDepartments) {
        throw new HttpError(403, "You don't have permission to manage departments");
      }

      try {
        await legacyWrapper.getRefactoredService().getApproverResolver().setupDepartmentManager(
          departmentId,
          body.user_id,
          userId
        );

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "SET_DEPARTMENT_MANAGER",
          "Department",
          `Set department manager for department: ${departmentId}`,
        );

        res.json({ message: "Department manager set successfully" });
      } catch (error) {
        console.error('Set department manager error:', error);
        throw new HttpError(500, "Failed to set department manager");
      }
    }),
  );

  // Set user manager
  const setUserManagerBody = z.object({
    manager_id: z.string().uuid(),
  });

  apiRouter.post(
    "/users/:id/managers",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = setUserManagerBody.parse(req.body);
      const targetUserId = req.params.id;
      const userId = req.auth!.userId;

      // Check permissions
      const userPermissions = req.profile?.permissions || [];
      const canManageUsers =
        userPermissions.includes("manage_users") ||
        userPermissions.includes("all") ||
        req.profile?.is_admin;

      if (!canManageUsers) {
        throw new HttpError(403, "You don't have permission to manage users");
      }

      try {
        await legacyWrapper.getRefactoredService().getApproverResolver().setupManagerRelationship(
          targetUserId,
          body.manager_id,
          userId
        );

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "SET_USER_MANAGER",
          "User",
          `Set manager for user: ${targetUserId}`,
        );

        res.json({ message: "User manager set successfully" });
      } catch (error) {
        console.error('Set user manager error:', error);
        throw new HttpError(500, "Failed to set user manager");
      }
    }),
  );

  return apiRouter;
};
