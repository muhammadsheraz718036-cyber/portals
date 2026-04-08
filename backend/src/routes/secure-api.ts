import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../httpError.js";
import { asyncHandler } from "../asyncHandler.js";
import {
  requireAuth,
  requireAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import { RequestVisibilityService } from "../services/RequestVisibilityService.js";
import { FixedLazyWorkflowEngine } from "../services/FixedLazyWorkflowEngine.js";
import { pool } from "../db.js";

export const createSecureAPIRouter = () => {
  const router = Router();
  const visibilityService = new RequestVisibilityService();
  const workflowEngine = new FixedLazyWorkflowEngine();

  // Create request access guard middleware
  const requestAccessGuard = visibilityService.createRequestAccessGuard();

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
  // SECURE REQUEST LISTING
  // ===============================

  const requestsQuerySchema = z.object({
    status: z.string().optional(),
    department_id: z.string().uuid().optional(),
    page: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).optional(),
    include_initiated: z.string().transform(val => val !== 'false').optional(),
    include_assigned: z.string().transform(val => val !== 'false').optional(),
    include_previously_acted_on: z.string().transform(val => val !== 'false').optional(),
  });

  router.get(
    "/requests",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      
      // Validate query parameters
      const query = requestsQuerySchema.parse(req.query);

      // Apply strict visibility rules - NO role-based or department-wide access
      const result = await visibilityService.getVisibleRequests({
        user_id: userId,
        status: query.status,
        department_id: query.department_id,
        page: query.page || 1,
        limit: query.limit || 10,
        include_initiated: query.include_initiated,
        include_assigned: query.include_assigned,
        include_previously_acted_on: query.include_previously_acted_on,
      });

      res.json({
        success: true,
        data: result.requests,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
        visibility_rules: {
          initiated: query.include_initiated,
          assigned: query.include_assigned,
          previously_acted_on: query.include_previously_acted_on,
          note: "Strict user-based visibility - no role or department-wide access"
        }
      });
    }),
  );

  // ===============================
  // SECURE SINGLE REQUEST ACCESS
  // ===============================

  router.get(
    "/requests/:id",
    requireAuth,
    requestAccessGuard, // Apply access guard
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;
      const requestId = req.params.id;

      // Get request with access control
      const result = await visibilityService.getRequestWithAccess(userId, requestId);

      if (!result.can_access || !result.request) {
        throw new HttpError(404, "Request not found or access denied");
      }

      res.json({
        success: true,
        data: result.request,
        access_info: {
          can_access: result.can_access,
          access_reason: result.access_reason,
        },
      });
    }),
  );

  // ===============================
  // SECURE REQUEST CREATION
  // ===============================

  const createRequestSchema = z.object({
    title: z.string().min(1),
    approval_type_id: z.string().uuid(),
    form_data: z.record(z.any()),
    department_id: z.string().uuid().optional(),
  });

  router.post(
    "/requests",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = createRequestSchema.parse(req.body);
      const userId = req.auth!.userId;

      // Check permissions for request creation
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
        let chainId;
        const { rows: chains } = await client.query(
          "SELECT id FROM approval_chains WHERE approval_type_id = $1 ORDER BY created_at DESC LIMIT 1",
          [body.approval_type_id]
        );
        
        if (chains.length === 0) {
          throw new HttpError(400, "No approval chain found for this approval type");
        }
        chainId = chains[0].id;

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

        // Initialize workflow with lazy approver assignment
        const assignmentResult = await workflowEngine.initializeWorkflow(request.id);

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
          form_data: typeof fullRequests[0].form_data === 'string' ? 
            JSON.parse(fullRequests[0].form_data) : fullRequests[0].form_data,
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
          success: true,
          data: fullRequest,
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
  // SECURE APPROVAL ACTIONS
  // ===============================

  const actionBodySchema = z.object({
    remarks: z.string().optional(),
  });

  router.post(
    "/requests/:requestId/steps/:stepId/approve",
    requireAuth,
    requestAccessGuard, // Verify user can access this request
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBodySchema.parse(req.body);
      const { requestId, stepId } = req.params;
      const userId = req.auth!.userId;

      // Additional check: user must be assigned to this step
      const { rows: stepAssignments } = await pool.query(
        'SELECT assigned_to FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (stepAssignments.length === 0 || stepAssignments[0].assigned_to !== userId) {
        throw new HttpError(403, "You are not assigned to this step");
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
        success: true,
        data: {
          request: requests[0],
          nextStep: result.nextStep,
          workflowComplete: result.workflowComplete
        }
      });
    }),
  );

  router.post(
    "/requests/:requestId/steps/:stepId/reject",
    requireAuth,
    requestAccessGuard,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBodySchema.parse(req.body);
      const { requestId, stepId } = req.params;
      const userId = req.auth!.userId;

      // Additional check: user must be assigned to this step
      const { rows: stepAssignments } = await pool.query(
        'SELECT assigned_to FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (stepAssignments.length === 0 || stepAssignments[0].assigned_to !== userId) {
        throw new HttpError(403, "You are not assigned to this step");
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
        success: true,
        data: {
          request: requests[0],
          nextStep: result.nextStep,
          workflowComplete: result.workflowComplete
        }
      });
    }),
  );

  router.post(
    "/requests/:requestId/steps/:stepId/request-changes",
    requireAuth,
    requestAccessGuard,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = actionBodySchema.parse(req.body);
      const { requestId, stepId } = req.params;
      const userId = req.auth!.userId;

      // Additional check: user must be assigned to this step
      const { rows: stepAssignments } = await pool.query(
        'SELECT assigned_to FROM request_steps WHERE id = $1',
        [stepId]
      );

      if (stepAssignments.length === 0 || stepAssignments[0].assigned_to !== userId) {
        throw new HttpError(403, "You are not assigned to this step");
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
        success: true,
        data: {
          request: requests[0],
          changesRequested: result.changesRequested
        }
      });
    }),
  );

  // ===============================
  // SECURE REQUEST RESUMPTION
  // ===============================

  const resumeBodySchema = z.object({
    title: z.string().optional(),
    form_data: z.record(z.any()),
  });

  router.post(
    "/requests/:requestId/resume",
    requireAuth,
    requestAccessGuard,
    asyncHandler(async (req: AuthedRequest, res) => {
      const body = resumeBodySchema.parse(req.body);
      const { requestId } = req.params;
      const userId = req.auth!.userId;

      // Additional check: user must be the initiator
      const { rows: requests } = await pool.query(
        'SELECT initiator_id FROM approval_requests WHERE id = $1',
        [requestId]
      );

      if (requests.length === 0 || requests[0].initiator_id !== userId) {
        throw new HttpError(403, "Only the request initiator can resume a request");
      }

      // Process resume using workflow engine
      const result = await workflowEngine.resumeRequest(requestId, body.form_data);

      if (!result.success) {
        throw new HttpError(400, result.error || "Resume failed");
      }

      // Get updated request
      const { rows: updatedRequests } = await pool.query(
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
        `Resumed request: ${updatedRequests[0].request_number}`
      );

      res.json({
        success: true,
        data: {
          request: updatedRequests[0],
          step: result.step
        }
      });
    }),
  );

  // ===============================
  // SECURE PENDING ACTIONS
  // ===============================

  router.get(
    "/pending-actions",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;

      // Only get steps assigned to this specific user
      const pendingSteps = await workflowEngine.getPendingSteps(userId);

      res.json({
        success: true,
        data: pendingSteps,
        visibility_note: "Only showing actions assigned to you - no role-based visibility"
      });
    }),
  );

  // ===============================
  // USER STATISTICS
  // ===============================

  router.get(
    "/statistics",
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const userId = req.auth!.userId;

      const stats = await visibilityService.getUserRequestStatistics(userId);

      res.json({
        success: true,
        data: stats,
        visibility_note: "Statistics based on strict user-based visibility rules"
      });
    }),
  );

  // ===============================
  // CHANGE REQUEST HISTORY
  // ===============================

  router.get(
    "/requests/:requestId/change-history",
    requireAuth,
    requestAccessGuard,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { requestId } = req.params;

      const history = await workflowEngine.getChangeRequestHistory(requestId);

      res.json({
        success: true,
        data: history
      });
    }),
  );

  return router;
};
