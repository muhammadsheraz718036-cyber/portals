# Approver Resolution Integration Guide

## Overview

This guide shows how to replace the existing static approver assignment logic with the new dynamic `ApproversResolver` service throughout the workflow system.

## Current vs New Approach

### Before (Static Assignment)
```sql
-- Direct role-based queries
SELECT p.* FROM profiles p 
JOIN roles r ON p.role_id = r.id 
WHERE r.name = 'Department Manager'
AND p.department_id = $1;
```

### After (Dynamic Resolution)
```typescript
const result = await resolver.resolveApprovers(step, request);
```

## Integration Steps

### Step 1: Replace Direct Role Queries

**File: `src/routes/api.ts` (Lines 2350-2365)**

**Before:**
```typescript
// For non-admins, only allow approving steps that match their role
const { rows: roleRows } = await pool.query<{ name: string }>(
  `SELECT name FROM roles WHERE id = $1`,
  [userRoleId],
);
if (roleRows.length > 0) {
  userRoleName = roleRows[0].name;
  currentActionQuery = `
    SELECT * FROM approval_actions 
    WHERE request_id = $1 AND status IN ('pending', 'waiting') AND role_name = $2
    ORDER BY step_order ASC, created_at DESC LIMIT 1`;
  queryParams = [requestId, userRoleName];
}
```

**After:**
```typescript
// Use dynamic approver resolution
import { ApproversResolver } from '../services/ApproversResolver.js';

const resolver = new ApproversResolver();
const canAct = await resolver.canUserActOnStep(userId, stepId);

if (!canAct) {
  throw new HttpError(403, "You are not assigned to this step");
}
```

### Step 2: Update Request Creation Logic

**File: `src/routes/api.ts` (Lines 2270-2298)**

**Before:**
```typescript
// Direct insertion without approver assignment
const { rows } = await pool.query(
  `INSERT INTO approval_requests (
    approval_type_id, approval_chain_id, initiator_id, department_id,
    form_data, current_step, total_steps, status
  ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
  RETURNING *`,
  [/* parameters */]
);
```

**After:**
```typescript
// Create request and initialize workflow with dynamic resolution
import { WorkflowEngine } from '../services/WorkflowEngine.js';

const workflowEngine = new WorkflowEngine();

// Create request (same as before)
const { rows } = await pool.query(/* ... */);

// Initialize workflow with dynamic approver assignment
const assignmentResult = await workflowEngine.initializeWorkflow(rows[0].id);

if (!assignmentResult.success) {
  console.error("Workflow initialization failed:", assignmentResult.errors);
}
```

### Step 3: Replace Approval Action Processing

**File: `src/routes/api.ts` (Lines 2378-2414)**

**Before:**
```typescript
// Direct role matching and static assignment
const { rows: pendingActions } = await pool.query(
  currentActionQuery, queryParams
);

// Update action
await pool.query(
  `UPDATE approval_actions SET status = 'approved', acted_by = $1, acted_at = now(), comment = $2 WHERE id = $3`,
  [userId, body.comment || null, currentAction.id],
);

// Manual next step calculation
const remainingPending = allActions.filter((a: any) =>
  ["pending", "waiting"].includes(a.status),
);
```

**After:**
```typescript
// Use workflow engine with dynamic resolution
const result = await workflowEngine.processApprovalAction(
  requestId,
  stepId,
  userId,
  "APPROVE",
  body.comment
);

if (!result.success) {
  throw new HttpError(400, result.error);
}

// Next steps are automatically assigned by the engine
const nextSteps = result.nextSteps;
```

### Step 4: Update Pending Actions Query

**File: `src/routes/api.ts` (Various locations)**

**Before:**
```typescript
// Direct query based on role matching
const { rows } = await pool.query(
  `SELECT ar.*, aa.role_name, aa.action_label, aa.status
   FROM approval_requests ar
   JOIN approval_actions aa ON ar.id = aa.request_id
   WHERE aa.acted_by IS NULL 
   AND aa.status IN ('pending', 'waiting')
   AND (aa.role_name = $1 OR $2 = true)`,
  [userRoleName, isAdmin]
);
```

**After:**
```typescript
// Use workflow engine with department scoping
const pendingSteps = await workflowEngine.getPendingSteps(userId);

// Results include dynamic assignment information
```

## Complete File Replacements

### Option 1: Gradual Migration

Replace specific functions in existing files:

```typescript
// In src/routes/api.ts
import { ApproversResolver } from '../services/ApproversResolver.js';
import { WorkflowEngine } from '../services/WorkflowEngine.js';

const resolver = new ApproversResolver();
const workflowEngine = new WorkflowEngine();

// Replace individual functions one by one
```

### Option 2: Complete API Replacement

Use the new refactored router:

```typescript
// In your main app file
import { createRefactoredWorkflowRouter } from './routes/workflow-api-refactored.js';

app.use('/api/workflow', createRefactoredWorkflowRouter());
```

## Database Query Replacements

### 1. Role-Based User Queries

**Before:**
```sql
-- Get users by role
SELECT p.* FROM profiles p 
JOIN roles r ON p.role_id = r.id 
WHERE r.name = $1 AND p.department_id = $2;
```

**After:**
```typescript
const approvers = await resolver.getUsersByRole('Manager', departmentId);
```

### 2. Department Manager Queries

**Before:**
```sql
-- Get department manager
SELECT p.* FROM profiles p 
WHERE p.full_name = d.head_name
AND p.department_id = $1;
```

**After:**
```typescript
const result = await resolver.resolveApprovers({
  actor_type: 'DEPARTMENT_MANAGER'
}, request);
```

### 3. User Manager Queries

**Before:**
```sql
-- Complex manager relationship queries
SELECT manager.* FROM users u
JOIN users manager ON u.manager_id = manager.id
WHERE u.id = $1;
```

**After:**
```typescript
const result = await resolver.resolveApprovers({
  actor_type: 'USER_MANAGER'
}, request);
```

## Service Integration Points

### 1. Request Creation Service

**File: `src/services/RequestCreationService.ts`**

```typescript
export class RequestCreationService {
  constructor(private workflowEngine: WorkflowEngine) {}

  async createRequest(data: RequestData): Promise<Request> {
    // Create request
    const request = await this.createRequestRecord(data);
    
    // Initialize workflow with dynamic approver assignment
    await this.workflowEngine.initializeWorkflow(request.id);
    
    return request;
  }
}
```

### 2. Notification Service

**File: `src/services/NotificationService.ts`**

```typescript
export class NotificationService {
  constructor(private resolver: ApproversResolver) {}

  async notifyApprovers(stepId: string, requestId: string): Promise<void> {
    const step = await this.resolver.getStepDefinition(stepId);
    const request = await this.resolver.getRequestDefinition(requestId);
    
    const result = await this.resolver.resolveApprovers(step, request);
    
    for (const approver of result.approvers) {
      await this.sendNotification(approver.user_id, 'approval_pending', {
        requestId,
        stepName: step.name
      });
    }
  }
}
```

### 3. Audit Service

**File: `src/services/AuditService.ts`**

```typescript
export class AuditService {
  constructor(private resolver: ApproversResolver) {}

  async logApprovalAction(stepId: string, userId: string, action: string): Promise<void> {
    const canAct = await this.resolver.canUserActOnStep(userId, stepId);
    
    if (!canAct) {
      throw new Error('Unauthorized action attempted');
    }
    
    // Log the action with dynamic resolution context
    await this.createAuditLog({
      userId,
      action,
      stepId,
      resolvedAt: new Date()
    });
  }
}
```

## Testing Integration

### 1. Unit Tests

```typescript
// test/approver-resolution.test.ts
import { ApproversResolver } from '../src/services/ApproversResolver.js';

describe('ApproversResolver', () => {
  let resolver: ApproversResolver;

  beforeEach(() => {
    resolver = new ApproversResolver();
  });

  test('should resolve USER_MANAGER correctly', async () => {
    const step = { actor_type: 'USER_MANAGER' };
    const request = { initiator_id: 'user-123', department_id: 'dept-123' };
    
    const result = await resolver.resolveApprovers(step, request);
    
    expect(result.success).toBe(true);
    expect(result.approvers[0].assignment_type).toBe('USER_MANAGER');
  });
});
```

### 2. Integration Tests

```typescript
// test/workflow-integration.test.ts
import { WorkflowEngine } from '../src/services/WorkflowEngine.js';

describe('Workflow Integration', () => {
  let engine: WorkflowEngine;

  test('should initialize workflow with dynamic approvers', async () => {
    const result = await engine.initializeWorkflow('request-123');
    
    expect(result.success).toBe(true);
    expect(result.assigned_steps).toBeGreaterThan(0);
  });
});
```

## Migration Checklist

### Phase 1: Preparation
- [ ] Backup database
- [ ] Run tests to ensure current functionality
- [ ] Review existing approver assignment logic
- [ ] Identify all direct role queries

### Phase 2: Service Integration
- [ ] Add ApproversResolver and WorkflowEngine imports
- [ ] Replace direct role queries with resolver calls
- [ ] Update request creation to use workflow engine
- [ ] Replace approval action processing

### Phase 3: API Updates
- [ ] Update existing endpoints to use new services
- [ ] Add new dynamic resolution endpoints
- [ ] Maintain backward compatibility endpoints
- [ ] Update error handling

### Phase 4: Testing
- [ ] Run unit tests for resolver service
- [ ] Run integration tests for workflow engine
- [ ] Test all existing API endpoints
- [ ] Verify department scoping works correctly

### Phase 5: Deployment
- [ ] Deploy to staging environment
- [ ] Run comprehensive tests
- [ ] Monitor for errors
- [ ] Deploy to production

### Phase 6: Cleanup
- [ ] Remove deprecated direct queries
- [ ] Update documentation
- [ ] Remove old fallback logic
- [ ] Optimize performance

## Common Integration Patterns

### 1. Replacing Role Checks

**Before:**
```typescript
if (userRoleName === 'Department Manager') {
  // Handle department manager logic
}
```

**After:**
```typescript
const result = await resolver.resolveApprovers(step, request);
if (result.approvers.some(a => a.assignment_type === 'DEPARTMENT_MANAGER')) {
  // Handle department manager logic
}
```

### 2. Replacing User Assignment

**Before:**
```typescript
await pool.query(
  'UPDATE approval_actions SET assigned_to = $1 WHERE id = $2',
  [userId, actionId]
);
```

**After:**
```typescript
const result = await workflowEngine.processApprovalAction(
  requestId, stepId, userId, 'APPROVE'
);
// Assignment is handled automatically
```

### 3. Replacing Permission Checks

**Before:**
```typescript
const { rows } = await pool.query(
  'SELECT 1 FROM approval_actions WHERE role_name = $1 AND request_id = $2',
  [userRoleName, requestId]
);
```

**After:**
```typescript
const canAct = await resolver.canUserActOnStep(userId, stepId);
```

## Performance Considerations

### 1. Caching Resolver Results

```typescript
class CachedApproversResolver extends ApproversResolver {
  private cache = new Map<string, ResolverResult>();

  async resolveApprovers(step: StepDefinition, request: RequestDefinition): Promise<ResolverResult> {
    const cacheKey = `${step.actor_type}-${step.actor_value}-${request.department_id}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const result = await super.resolveApprovers(step, request);
    this.cache.set(cacheKey, result);
    
    return result;
  }
}
```

### 2. Batch Resolution

```typescript
// Resolve multiple steps at once
const batchResults = await resolver.resolveApproversForBatch(steps, request);
```

### 3. Database Optimization

- Add indexes on `approval_steps.actor_type` and `actor_value`
- Optimize manager relationship queries
- Use connection pooling for resolver operations

## Troubleshooting

### Common Issues

1. **Resolver Returns No Approvers**
   - Check manager relationships are set up
   - Verify department assignments
   - Check user is active

2. **Permission Denied Errors**
   - Verify user can act on step using `canUserActOnStep`
   - Check department scoping rules
   - Review user permissions

3. **Workflow Initialization Fails**
   - Check approval chain has steps
   - Verify step definitions are valid
   - Review resolver error messages

### Debug Tools

```typescript
// Enable debug logging
const resolver = new ApproversResolver();
resolver.setDebugMode(true);

// Test resolution manually
const result = await resolver.resolveApprovers(step, request);
console.log('Resolution result:', result);
```

This integration guide provides a complete roadmap for replacing static approver assignment with dynamic resolution while maintaining backward compatibility and improving system flexibility.
