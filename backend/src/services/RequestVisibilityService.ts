import { pool } from '../db.js';

export interface RequestVisibilityFilter {
  user_id: string;
  include_initiated?: boolean;
  include_assigned?: boolean;
  include_previously_acted_on?: boolean;
  status?: string;
  department_id?: string;
  page?: number;
  limit?: number;
}

export interface RequestVisibilityResult {
  requests: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class RequestVisibilityService {
  
  /**
   * Get requests with STRICT user-based visibility
   * Users can ONLY see:
   * 1. Requests they created
   * 2. Requests assigned to them (request_steps.assigned_to)
   * 3. (Optional) Requests they previously acted on
   */
  async getVisibleRequests(filter: RequestVisibilityFilter): Promise<RequestVisibilityResult> {
    const {
      user_id,
      include_initiated = true,
      include_assigned = true,
      include_previously_acted_on = true,
      status,
      department_id,
      page = 1,
      limit = 10
    } = filter;

    const offset = (page - 1) * limit;

    // Build visibility conditions - NO role-based or department-wide visibility
    const visibilityConditions: string[] = [];
    const queryParams: any[] = [user_id];
    let paramIndex = 2;

    if (include_initiated) {
      visibilityConditions.push(`ar.initiator_id = $1`);
    }

    if (include_assigned) {
      visibilityConditions.push(`
        EXISTS (
          SELECT 1 FROM request_steps rs 
          WHERE rs.request_id = ar.id 
          AND rs.assigned_to = $1 
          AND rs.status IN ('PENDING', 'WAITING')
        )
      `);
    }

    if (include_previously_acted_on) {
      visibilityConditions.push(`
        EXISTS (
          SELECT 1 FROM request_steps rs 
          WHERE rs.request_id = ar.id 
          AND rs.acted_by = $1
        )
      `);
    }

    // If no visibility conditions, return empty result
    if (visibilityConditions.length === 0) {
      return {
        requests: [],
        total: 0,
        page,
        limit,
        totalPages: 0
      };
    }

    const whereClause = `(${visibilityConditions.join(' OR ')})`;

    // Add optional filters
    let additionalWhere = '';
    if (status) {
      additionalWhere += ` AND ar.status = $${paramIndex++}`;
      queryParams.push(status);
    }

    if (department_id) {
      additionalWhere += ` AND ar.department_id = $${paramIndex++}`;
      queryParams.push(department_id);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM approval_requests ar 
      WHERE ${whereClause}${additionalWhere}
    `;

    const { rows: countRows } = await pool.query(countQuery, queryParams);
    const total = parseInt(countRows[0].total);

    // Get requests with full details
    const requestsQuery = `
      SELECT DISTINCT ON (ar.id) ar.*,
        p_initiator.full_name as initiator_name,
        p_initiator.email as initiator_email,
        d.name as department_name,
        at.name as approval_type_name,
        EXISTS (
          SELECT 1 FROM request_steps rs_pending
          WHERE rs_pending.request_id = ar.id 
          AND rs_pending.assigned_to = $1 
          AND rs_pending.status IN ('PENDING', 'WAITING')
        ) as has_pending_actions,
        EXISTS (
          SELECT 1 FROM request_steps rs_assigned
          WHERE rs_assigned.request_id = ar.id 
          AND rs_assigned.assigned_to = $1
        ) as is_assigned_to_user,
        EXISTS (
          SELECT 1 FROM request_steps rs_acted
          WHERE rs_acted.request_id = ar.id 
          AND rs_acted.acted_by = $1
        ) as has_acted_on_request,
        (
          SELECT json_agg(
            json_build_object(
              'id', rs.id,
              'step_order', rs.step_order,
              'name', rs.name,
              'status', rs.status,
              'assigned_to', rs.assigned_to,
              'acted_by', rs.acted_by,
              'created_at', rs.created_at
            ) ORDER BY rs.step_order
          )
          FROM request_steps rs 
          WHERE rs.request_id = ar.id
        ) as steps
      FROM approval_requests ar
      LEFT JOIN profiles p_initiator ON ar.initiator_id = p_initiator.id
      LEFT JOIN departments d ON ar.department_id = d.id
      LEFT JOIN approval_types at ON ar.approval_type_id = at.id
      WHERE ${whereClause}${additionalWhere}
      ORDER BY ar.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    queryParams.push(limit, offset);

    const { rows } = await pool.query(requestsQuery, queryParams);

    return {
      requests: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Check if user can access a specific request
   */
  async canAccessRequest(userId: string, requestId: string): Promise<{
    can_access: boolean;
    access_reason: 'initiator' | 'assigned' | 'acted_on' | 'none';
  }> {
    const { rows } = await pool.query(
      `
      SELECT 
        CASE 
          WHEN ar.initiator_id = $1 THEN 'initiator'
          WHEN EXISTS (
            SELECT 1 FROM request_steps rs 
            WHERE rs.request_id = ar.id 
            AND rs.assigned_to = $1 
            AND rs.status IN ('PENDING', 'WAITING')
          ) THEN 'assigned'
          WHEN EXISTS (
            SELECT 1 FROM request_steps rs 
            WHERE rs.request_id = ar.id 
            AND rs.acted_by = $1
          ) THEN 'acted_on'
          ELSE 'none'
        END as access_reason
      FROM approval_requests ar
      WHERE ar.id = $2
      `,
      [userId, requestId]
    );

    if (rows.length === 0) {
      return { can_access: false, access_reason: 'none' };
    }

    const accessReason = rows[0].access_reason;
    return {
      can_access: accessReason !== 'none',
      access_reason: accessReason
    };
  }

  /**
   * Get request details with access control
   */
  async getRequestWithAccess(userId: string, requestId: string): Promise<{
    request: any;
    can_access: boolean;
    access_reason: 'initiator' | 'assigned' | 'acted_on' | 'none';
  }> {
    const accessCheck = await this.canAccessRequest(userId, requestId);

    if (!accessCheck.can_access) {
      return {
        request: null,
        can_access: false,
        access_reason: 'none'
      };
    }

    const { rows } = await pool.query(
      `
      SELECT 
        ar.*,
        p_initiator.full_name as initiator_name,
        p_initiator.email as initiator_email,
        d.name as department_name,
        at.name as approval_type_name,
        at.fields as approval_type_fields,
        (
          SELECT json_agg(
            json_build_object(
              'id', rs.id,
              'step_order', rs.step_order,
              'name', rs.name,
              'description', rs.description,
              'status', rs.status,
              'assigned_to', rs.assigned_to,
              'acted_by', rs.acted_by,
              'remarks', rs.remarks,
              'created_at', rs.created_at,
              'started_at', rs.started_at,
              'completed_at', rs.completed_at,
              'due_date', rs.due_date,
              'resumed_from_step_id', rs.resumed_from_step_id,
              p_assigned.full_name as assigned_name,
              p_assigned.email as assigned_email,
              p_acted.full_name as acted_by_name,
              p_acted.email as acted_by_email
            ) ORDER BY rs.step_order
          )
          FROM request_steps rs 
          LEFT JOIN profiles p_assigned ON rs.assigned_to = p_assigned.id
          LEFT JOIN profiles p_acted ON rs.acted_by = p_acted.id
          WHERE rs.request_id = ar.id
        ) as steps,
        (
          SELECT json_agg(
            json_build_object(
              'id', ra.id,
              'step_order', ra.step_order,
              'role_name', ra.role_name,
              'action_label', ra.action_label,
              'status', ra.status,
              'acted_by', ra.acted_by,
              'comment', ra.comment,
              'acted_at', ra.acted_at,
              'p_acted.full_name',
              'p_acted.email'
            ) ORDER BY ra.step_order
          )
          FROM approval_actions ra
          LEFT JOIN profiles p_acted ON ra.acted_by = p_acted.id
          WHERE ra.request_id = ar.id
        ) as approval_actions
      FROM approval_requests ar
      LEFT JOIN profiles p_initiator ON ar.initiator_id = p_initiator.id
      LEFT JOIN departments d ON ar.department_id = d.id
      LEFT JOIN approval_types at ON ar.approval_type_id = at.id
      WHERE ar.id = $1
      `,
      [requestId]
    );

    return {
      request: rows[0] || null,
      can_access: true,
      access_reason: accessCheck.access_reason
    };
  }

  /**
   * Middleware/guard function to check request access
   */
  createRequestAccessGuard() {
    return async (req: any, res: any, next: any) => {
      const userId = req.auth?.userId;
      const requestId = req.params.id || req.params.requestId;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!requestId) {
        return res.status(400).json({ error: 'Request ID required' });
      }

      const accessCheck = await this.canAccessRequest(userId, requestId);

      if (!accessCheck.can_access) {
        return res.status(403).json({ 
          error: 'Access denied',
          reason: 'You do not have permission to access this request'
        });
      }

      // Add access info to request for downstream use
      req.requestAccess = accessCheck;
      next();
    };
  }

  /**
   * Get user's request statistics
   */
  async getUserRequestStatistics(userId: string): Promise<{
    initiated: number;
    assigned: number;
    acted_on: number;
    pending_actions: number;
  }> {
    const { rows } = await pool.query(
      `
      SELECT 
        COUNT(DISTINCT CASE WHEN ar.initiator_id = $1 THEN ar.id END) as initiated,
        COUNT(DISTINCT CASE WHEN rs.assigned_to = $1 AND rs.status IN ('PENDING', 'WAITING') THEN ar.id END) as assigned,
        COUNT(DISTINCT CASE WHEN rs.acted_by = $1 THEN ar.id END) as acted_on,
        COUNT(DISTINCT CASE WHEN rs.assigned_to = $1 AND rs.status IN ('PENDING', 'WAITING') THEN rs.id END) as pending_actions
      FROM approval_requests ar
      LEFT JOIN request_steps rs ON ar.id = rs.request_id
      WHERE (
        ar.initiator_id = $1 
        OR rs.assigned_to = $1 
        OR rs.acted_by = $1
      )
      `,
      [userId]
    );

    return {
      initiated: parseInt(rows[0].initiated) || 0,
      assigned: parseInt(rows[0].assigned) || 0,
      acted_on: parseInt(rows[0].acted_on) || 0,
      pending_actions: parseInt(rows[0].pending_actions) || 0
    };
  }

  /**
   * Validate that a user can see a request based on strict visibility rules
   * This can be used as a guard in other services
   */
  async validateRequestAccess(userId: string, requestId: string): Promise<boolean> {
    const accessCheck = await this.canAccessRequest(userId, requestId);
    return accessCheck.can_access;
  }
}
