# Approval System Refactoring Guide

## Overview

This guide documents the refactoring of the approval workflow system to support dynamic approver resolution, department-scoped approvals, change request resume functionality, and strict visibility rules while maintaining full backward compatibility.

## Current Issues Addressed

### 1. Global Department Manager Problem
**Before**: All users with "Department Manager" role could see all requests across all departments.
**After**: Department managers are scoped to their specific departments only.

### 2. Static Role Mapping
**Before**: Approval steps stored static role names in `approval_actions.role_name`.
**After**: Dynamic resolution based on request context, department, and user relationships.

### 3. Missing Change Request Resume
**Before**: No mechanism to resume requests after changes are requested.
**After**: Full resume functionality with workflow continuation.

### 4. Lack of Department Scoping
**Before**: Users could potentially see requests from other departments.
**After**: Strict visibility rules based on department membership and permissions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (Backward Compatible)          │
├─────────────────────────────────────────────────────────────┤
│            BackwardCompatibilityWrapper                      │
├─────────────────────────────────────────────────────────────┤
│              RefactoredApprovalService                       │
├─────────────────────────────────────────────────────────────┤
│              DynamicApproverResolver                         │
├─────────────────────────────────────────────────────────────┤
│  Database (New Tables + Legacy Views for Compatibility)     │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema Changes

### New Tables

1. **approval_steps** - Replaces JSON steps in approval_chains
2. **request_steps** - Enhanced replacement for approval_actions
3. **department_managers** - Department-specific manager assignments
4. **user_managers** - User-to-manager relationships

### Backward Compatibility Views

- **approval_actions_view** - Maintains legacy approval_actions interface

## Implementation Steps

### Step 1: Run Database Migration

```sql
-- Apply the migration
\i sql/migrations/002-dynamic-approver-resolution.sql

-- Run migration functions
SELECT migrate_approval_chains();
SELECT migrate_approval_actions();
```

### Step 2: Update API Routes

Replace or patch existing routes with the refactored versions:

```typescript
// Option 1: Use the refactored patch
import { createRefactoredApiRouter } from './routes/api-refactored-patch.js';
const apiRouter = createRefactoredApiRouter();

// Option 2: Gradually integrate individual endpoints
import { BackwardCompatibilityWrapper } from './services/BackwardCompatibilityWrapper.js';
const wrapper = new BackwardCompatibilityWrapper();
```

### Step 3: Set Up Manager Relationships

```typescript
// Set department managers
await resolver.setupDepartmentManager(departmentId, userId, assignedBy);

// Set user managers
await resolver.setupManagerRelationship(userId, managerId, assignedBy);
```

### Step 4: Test the System

```bash
# Run the comprehensive test suite
node test-refactored-system.js

# Check migration status
GET /api/system/migration-status
```

## API Changes (Backward Compatible)

### New Endpoints

- `POST /api/approval-requests/:id/request-changes` - Request changes
- `POST /api/approval-requests/:id/resume` - Resume after changes
- `POST /api/departments/:id/managers` - Set department manager
- `POST /api/users/:id/managers` - Set user manager
- `GET /api/system/migration-status` - Check migration status

### Enhanced Existing Endpoints

All existing endpoints maintain the same interface but now use:
- Dynamic approver resolution
- Department-scoped visibility
- Enhanced error handling

## Dynamic Approver Resolution

### Actor Types

1. **ROLE** - Users with specific role (department-scoped)
2. **USER_MANAGER** - Direct manager of the request initiator
3. **DEPARTMENT_MANAGER** - Manager of the initiator's department
4. **SPECIFIC_USER** - Pre-defined specific user

### Resolution Logic

```typescript
const resolution = await resolver.resolveApprovers({
  request_id: 'request-uuid',
  step_definition: {
    actor_type: 'DEPARTMENT_MANAGER'
  },
  department_id: 'department-uuid',
  initiator_id: 'user-uuid'
});
```

### Fallback Mechanisms

- USER_MANAGER → DEPARTMENT_MANAGER → Admin users
- ROLE → Department-scoped role members
- SPECIFIC_USER → User validation

## Department-Scoped Visibility

### Visibility Rules

1. **Regular Users**: Can only see requests from their department
2. **Department Managers**: Can see requests from their managed department
3. **Admin Users**: Can see all requests (configurable)

### Implementation

```typescript
const requests = await wrapper.getRequestsLegacy(userId, {
  department_id: deptId,  // Optional filter
  status: 'pending',       // Optional filter
  page: 1,
  limit: 10
});
```

## Change Request Resume Flow

### Process

1. Approver requests changes on a step
2. Request status changes to `changes_requested`
3. Initiator updates request data
4. System resumes workflow from the changes requested step
5. Same approver (or new one if unavailable) reviews updated request

### API Usage

```typescript
// Request changes
await wrapper.refactoredService.processAction(userId, {
  request_id: requestId,
  step_id: stepId,
  action: 'REQUEST_CHANGES',
  comment: 'Please add more details'
});

// Resume request
await wrapper.refactoredService.resumeRequest(initiatorId, requestId, {
  title: 'Updated Title',
  form_data: { /* updated data */ }
});
```

## Migration Strategy

### Phase 1: Database Migration
- Add new tables
- Create backward compatibility views
- Migrate existing data

### Phase 2: Service Integration
- Deploy new services alongside existing ones
- Use feature flags to gradually enable new functionality
- Monitor for issues

### Phase 3: API Migration
- Replace legacy endpoints with refactored versions
- Maintain backward compatibility through wrapper
- Update client applications gradually

### Phase 4: Cleanup
- Remove legacy tables (after verification)
- Remove compatibility views
- Update documentation

## Testing

### Unit Tests

```bash
# Test individual components
npm test -- DynamicApproverResolver
npm test -- RefactoredApprovalService
npm test -- BackwardCompatibilityWrapper
```

### Integration Tests

```bash
# Test complete system
node test-refactored-system.js

# Test specific scenarios
node test-workflow-safeguards.js
node test-request-resumption.js
```

### Backward Compatibility Tests

Verify all existing API endpoints work unchanged:
- Request creation
- Approval actions
- Request listing
- Permission checks

## Performance Considerations

### Database Indexes

New indexes added for:
- `approval_steps(chain_id, step_order)`
- `request_steps(request_id, step_order)`
- `department_managers(department_id, is_active)`
- `user_managers(user_id, is_active)`

### Caching

Consider caching:
- Department manager assignments
- User manager relationships
- Role permissions

### Query Optimization

- Use department-scoped queries
- Limit result sets with pagination
- Optimize approver resolution queries

## Security Considerations

### Authorization

- All operations require authentication
- Department-scoped access control
- Permission-based feature access

### Audit Trail

- All actions logged with user context
- Department context included in logs
- Migration and setup actions tracked

### Data Privacy

- Users only see requests from their department
- Manager relationships are validated
- Sensitive operations require elevated permissions

## Troubleshooting

### Common Issues

1. **Migration Fails**
   - Check database permissions
   - Verify foreign key constraints
   - Review error logs

2. **Approvers Not Assigned**
   - Verify manager relationships
   - Check department assignments
   - Validate user permissions

3. **Cross-Department Visibility**
   - Check department scoping rules
   - Verify user permissions
   - Review visibility logic

### Debug Tools

```sql
-- Check migration status
SELECT * FROM approval_steps LIMIT 5;
SELECT * FROM request_steps LIMIT 5;

-- Check manager assignments
SELECT * FROM department_managers;
SELECT * FROM user_managers;

-- Verify approver resolution
SELECT * FROM resolve_step_approvers('request-id', 'step-id');
```

## Rollback Plan

If issues occur:

1. **Immediate Rollback**
   - Switch back to legacy API routes
   - Disable new features via feature flags

2. **Data Rollback**
   - Restore from backup (if needed)
   - Legacy data remains intact in original tables

3. **Partial Rollback**
   - Disable specific problematic features
   - Maintain working functionality

## Monitoring

### Key Metrics

- Request processing time
- Approver resolution success rate
- Department access violations
- Migration completion status

### Alerts

- Failed approver resolution
- Cross-department access attempts
- Migration failures
- Performance degradation

## Future Enhancements

### Planned Features

1. **Parallel Approvals** - Multiple approvers can act simultaneously
2. **Conditional Steps** - Steps based on request data
3. **Delegation** - Temporary approval delegation
4. **SLA Management** - Due date enforcement and escalation

### Scalability

- Horizontal scaling of approval services
- Database sharding for large deployments
- Caching layer for frequently accessed data
- Queue-based processing for high volume

## Conclusion

This refactoring provides:
- ✅ Dynamic approver resolution
- ✅ Department-scoped approvals
- ✅ Change request resume functionality
- ✅ Strict visibility rules
- ✅ Full backward compatibility
- ✅ Enhanced security and audit capabilities

The system is now more flexible, secure, and maintainable while preserving all existing functionality.
