import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../httpError.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  requireAuth,
  requireAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import { WorkflowEngine } from "../services/WorkflowEngine.js";
import { ApproversResolver } from "../services/ApproversResolver.js";
import { pool } from "../db.js";

export const createRefactoredWorkflowRouter = () => {
  const router = Router();
  const workflowEngine = new WorkflowEngine();
  const approversResolver = new ApproversResolver();

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

  // ===============================
  // REQUEST CREATION WITH DYNAMIC RESOLUTION
  // ===============================

  const createRequestBody = z.object({
    title: z.string().min(1),
    approval_type_id: z.string().uuid(),
    form_data: z.record(z.any()),
    approval_chain_id: z.string().uuid().optional(),
    department_id: z.string().uuid().optional(),
  });

  router.post(
    "/requests",
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

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Get user's department if not provided
        let departmentId = body.department_id;
        if (!departmentId) {
          const { rows } = await client.query(
            "SELECT department_id FROM profiles WHERE id = $1",
            [userId]
          );
          departmentId = rows[0]?.department_id;
        }

        // Get approval chain
        let chainId = body.approval_chain_id;
        if (!chainId) {
          const { rows } = await client.query(
            "SELECT id FROM approval_chains WHERE approval_type_id = $1 ORDER BY created_at DESC LIMIT 1",
            [body.approval_type_id]
          );
          if (rows.length === 0) {
            throw new HttpError(400, "No approval chain found for this approval type");
          }
          chainId = rows[0].id;
        }

        // Create the request
        const { rows: requests } = await client.query(
          `INSERT INTO approval_requests 
           (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status, current_step, total_steps)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1, 0)
           RETURNING *`,
          [body.approval_type_id, chainId, userId, departmentId, body.title, JSON.stringify(body.form_data)]
        );

        const request = requests[0];

        await client.query("COMMIT");

        // Initialize workflow with dynamic approver resolution
        const assignmentResult = await workflowEngine.initializeWorkflow(request.id);

        if (!assignmentResult.success) {
          // Log the failure but don't fail the request creation
          console.error("Workflow initialization failed:", assignmentResult.errors);
          await logAudit(
            userId,
            req.profile!.full_name,
            "CREATE_REQUEST_WORKFLOW_FAILED",
            "Approval Request",
            `Request created but workflow failed: ${assignmentResult.errors.join(", ")}`
          );
        }

        // Get the created request with steps
        const { rows: fullRequests } = await pool.query(
          `SELECT ar.*, p.full_name as initiator_name, d.name as department_name, at.name as approval_type_name
           FROM approval_requests ar
           JOIN profiles p ON ar.initiator_id = p.id
           LEFT JOIN departments d ON ar.department_id = d.id
           LEFT JOIN approval_types at ON ar.approval_type_id = at.id
           WHERE ar.id = $1`,
          [request.id]
        );

        const { rows: steps } = await pool.query(
          `SELECT rs.*, p.full_name as assigned_name, p.email as assigned_email
           FROM request_steps rs
           LEFT JOIN profiles p ON rs.assigned_to = p.id
           WHERE rs.request_id = $1
           ORDER BY rs.step_order`,
          [request.id]
        );

        const fullRequest = {
          ...fullRequests[0],
          form_data: typeof fullRequests[0].form_data === 'string' ? JSON.parse(fullRequests[0].form_data) : fullRequests[0].form_data,
          steps
        };

        // Log audit event
        await logAudit(
          userId,
          req.profile!.full_name,
          "CREATE",
          "Approval Request",
          `Created approval request: ${fullRequest.request_number}`
        );

        res.status(201).json({
          ...fullRequest,
          workflow_assignment: assignmentResult
        });

      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  // ===============================
  // APPROVAL ACTIONS WITH DYNAMIC RESOLUTION
  // ===============================

  const actionBody = z.object({
    remarks: z.string().optional(),
  });

  router.post(
    "/requests/:requestId/steps/:stepId/approve",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const { requestId, stepId } = req.params;
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

      // Process approval using workflow engine
      const result = await workflowEngine.processApprovalAction(
        requestId,
        stepId,
        userId,
        "APPROVE",
        body.remarks
      );

      if (!result.success) {
        throw new HttpError(400, result.error || "Approval failed");
      }

      // Get updated request
      const { rows: requests } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         WHERE ar.id = $1`,
        [requestId]
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "APPROVE",
        "Approval Request",
        `Approved request: ${requests[0].request_number}`
      );

      res.json({
        request: requests[0],
        nextSteps: result.nextSteps
      });
    }),
  );

  router.post(
    "/requests/:requestId/steps/:stepId/reject",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const { requestId, stepId } = req.params;
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

      // Process rejection using workflow engine
      const result = await workflowEngine.processApprovalAction(
        requestId,
        stepId,
        userId,
        "REJECT",
        body.remarks
      );

      if (!result.success) {
        throw new HttpError(400, result.error || "Rejection failed");
      }

      // Get updated request
      const { rows: requests } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         WHERE ar.id = $1`,
        [requestId]
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "REJECT",
        "Approval Request",
        `Rejected request: ${requests[0].request_number}`
      );

      res.json({
        request: requests[0],
        nextSteps: result.nextSteps
      });
    }),
  );

  router.post(
    "/requests/:requestId/steps/:stepId/request-changes",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBody.parse(req.body);
      const { requestId, stepId } = req.params;
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

      // Process change request using workflow engine
      const result = await workflowEngine.processApprovalAction(
        requestId,
        stepId,
        userId,
        "REQUEST_CHANGES",
        body.remarks
      );

      if (!result.success) {
        throw new HttpError(400, result.error || "Change request failed");
      }

      // Get updated request
      const { rows: requests } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         WHERE ar.id = $1`,
        [requestId]
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "REQUEST_CHANGES",
        "Approval Request",
        `Requested changes for: ${requests[0].request_number}`
      );

      res.json({
        request: requests[0],
        nextSteps: result.nextSteps
      });
    }),
  );

  // ===============================
  // REQUEST RESUME FUNCTIONALITY
  // ===============================

  const resumeBody = z.object({
    title: z.string().optional(),
    form_data: z.record(z.any()),
  });

  router.post(
    "/requests/:requestId/resume",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = resumeBody.parse(req.body);
      const { requestId } = req.params;
      const userId = req.auth!.userId;

      // Process resume using workflow engine
      const result = await workflowEngine.resumeRequest(requestId, body.form_data);

      if (!result.success) {
        throw new HttpError(400, result.error || "Resume failed");
      }

      // Get updated request
      const { rows: requests } = await pool.query(
        `SELECT ar.*, p.full_name as initiator_name, d.name as department_name
         FROM approval_requests ar
         JOIN profiles p ON ar.initiator_id = p.id
         LEFT JOIN departments d ON ar.department_id = d.id
         WHERE ar.id = $1`,
        [requestId]
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "RESUME",
        "Approval Request",
        `Resumed request: ${requests[0].request_number}`
      );

      res.json({
        request: requests[0],
        steps: result.steps
      });
    }),
  );

  // ===============================
  // GET REQUESTS WITH DEPARTMENT SCOPING
  // ===============================

  router.get(
    "/requests",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const filters = {
        status: req.query.status as string,
        department_id: req.query.department_id as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
      };

      const result = await workflowEngine.getUserRequests(userId, filters);

      res.json({
        requests: result.requests,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / filters.limit)
        }
      });
    }),
  );

  // ===============================
  // GET PENDING ACTIONS (DEPARTMENT SCOPED)
  // ===============================

  router.get(
    "/pending-actions",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;

      const pendingSteps = await workflowEngine.getPendingSteps(userId);

      res.json(pendingSteps);
    }),
  );

  // ===============================
  // APPROVER RESOLUTION ENDPOINTS
  // ===============================

  router.get(
    "/steps/:stepId/approvers",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { stepId } = req.params;
      const userId = req.auth!.userId;

      // Get step definition
      const step = await approversResolver.getStepDefinition(stepId);
      if (!step) {
        throw new HttpError(404, "Step not found");
      }

      // Get request definition
      const request = await approversResolver.getRequestDefinition(step.request_id || '');
      if (!request) {
        throw new HttpError(404, "Request not found");
      }

      // Check if user can view approvers for this step
      const canView = await approversResolver.canUserActOnStep(userId, stepId) || 
                     req.profile?.is_admin ||
                     req.profile?.permissions?.includes('manage_approvals') ||
                     req.profile?.permissions?.includes('all');

      if (!canView) {
        throw new HttpError(403, "You don't have permission to view approvers for this step");
      }

      // Resolve approvers
      const result = await approversResolver.resolveApprovers(step, request);

      res.json(result);
    }),
  );

  // ===============================
  // LEGACY BACKWARD COMPATIBILITY ENDPOINTS
  // ===============================

  // Legacy endpoint: Get users by role (replaced with dynamic resolution)
  router.get(
    "/users/by-role/:roleName",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { roleName } = req.params;
      const departmentId = req.query.department_id as string;

      // Use the new resolver instead of direct query
      const approvers = await approversResolver.getUsersByRole(roleName, departmentId);

      res.json({
        users: approvers,
        note: "This endpoint is deprecated. Use the new approver resolution system."
      });
    }),
  );

  // Legacy endpoint: Check if user can approve (replaced with dynamic resolution)
  router.get(
    "/requests/:requestId/can-approve",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { requestId } = req.params;
      const userId = req.auth!.userId;

      // Find pending step for this user
      const { rows } = await pool.query(
        `SELECT rs.id FROM request_steps rs
         WHERE rs.request_id = $1 
         AND rs.assigned_to = $2 
         AND rs.status IN ('PENDING', 'WAITING')
         LIMIT 1`,
        [requestId, userId]
      );

      const canApprove = rows.length > 0;

      res.json({
        can_approve: canApprove,
        step_id: canApprove ? rows[0].id : null,
        note: "This endpoint is deprecated. Use the new workflow engine."
      });
    }),
  );

  return router;
};
