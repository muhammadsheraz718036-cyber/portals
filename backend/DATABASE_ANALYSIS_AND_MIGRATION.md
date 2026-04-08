# Database Schema Analysis and Migration Strategy

## Current Schema Analysis

### Approval Chains & Steps Storage

**Current Implementation:**
- `approval_chains.steps` stores steps as JSONB array
- `approval_actions` stores individual step instances with `role_name` (TEXT)
- **No existing `approval_steps` table** - all step definitions are in JSON

**JSON Step Structure:**
```json
{
  "order": 1,
  "name": "Manager Review",
  "description": "Review by department manager",
  "roleName": "Department Manager",
  "action": "Approve",
  "due_days": 3,
  "type": "department_manager" // Optional, varies by implementation
}
```

**Current Storage Analysis:**
- ✅ Stores `role_name` in `approval_actions` table
- ❌ Does NOT store `role_id` or `user_id` directly
- ✅ Steps are defined in JSON, not relational table
- ❌ Limited flexibility for dynamic approver resolution

### User & Department Structure

**Current Implementation:**
```sql
users:
  - id, email, password_hash, timestamps
  - ❌ NO department_id
  - ❌ NO manager_id

profiles:
  - id (FK to users), full_name, email
  - ✅ department_id (FK to departments)
  - ✅ role_id (FK to roles)
  - ❌ NO manager_id

departments:
  - id, name, head_name (TEXT)
  - ❌ NO manager_user_id (FK to users)
```

**Issues Identified:**
- Manager relationships stored as TEXT (`head_name`) instead of proper FK
- Users table lacks department and manager references
- No support for USER_MANAGER or DEPARTMENT_MANAGER actor types

## Migration Strategy

### Phase 1: Add New Tables and Columns

**1. Create `approval_steps` table:**
```sql
CREATE TABLE approval_steps (
  id UUID PRIMARY KEY,
  chain_id UUID NOT NULL REFERENCES approval_chains(id),
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- NEW COLUMNS for dynamic resolution
  actor_type TEXT NOT NULL DEFAULT 'ROLE' 
    CHECK (actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
  actor_value TEXT, -- Role name, User ID, or NULL for manager types
  -- DEPRECATED COLUMNS (kept for compatibility)
  role_id UUID REFERENCES roles(id), -- DEPRECATED
  user_id UUID REFERENCES users(id), -- DEPRECATED
  -- Existing columns
  action_label TEXT NOT NULL DEFAULT 'Review',
  due_days INTEGER DEFAULT 3,
  is_parallel BOOLEAN DEFAULT false,
  parallel_group TEXT,
  timestamps...
);
```

**2. Add manager relationships:**
```sql
-- Add to users table
ALTER TABLE users ADD COLUMN manager_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN department_id UUID REFERENCES departments(id);

-- Add to departments table  
ALTER TABLE departments ADD COLUMN manager_user_id UUID REFERENCES users(id);
```

### Phase 2: Data Backfill Strategy

**Actor Type Mapping:**
| JSON Property | Actor Type | Actor Value | Notes |
|---------------|------------|-------------|-------|
| `type: "user"` | SPECIFIC_USER | user_id | From email/name lookup |
| `type: "manager"` | USER_MANAGER | NULL | Resolve from initiator |
| `type: "department_manager"` | DEPARTMENT_MANAGER | NULL | Resolve from department |
| `roleName: "Role Name"` | ROLE | "Role Name" | Direct mapping |
| Default | ROLE | roleName | Fallback |

**Manager Relationship Backfill:**
1. **Strategy 1**: `departments.head_name` → `departments.manager_user_id`
   - Exact match on `profiles.full_name`
   - Partial match fallback
   - Email match fallback

2. **Strategy 2**: `profiles.department_id` → `users.department_id`
   - Direct sync for all users

3. **Strategy 3**: Infer from approval patterns
   - Users who frequently approve become managers
   - Based on `approval_actions.acted_by` patterns

### Phase 3: Backward Compatibility

**Compatibility Measures:**
1. **Keep deprecated columns**: `role_id`, `user_id` in `approval_steps`
2. **Create view**: `approval_chains_with_steps` mimics old JSON structure
3. **Update triggers**: Use new table but maintain old `approval_actions` creation
4. **Sync functions**: Keep `users.department_id` in sync with `profiles.department_id`

**View Structure:**
```sql
CREATE VIEW approval_chains_with_steps AS
SELECT 
  ac.*,
  jsonb_agg(
    jsonb_build_object(
      'order', as_.step_order,
      'name', as_.name,
      'roleName', CASE 
        WHEN as_.actor_type = 'ROLE' THEN as_.actor_value
        WHEN as_.actor_type = 'DEPARTMENT_MANAGER' THEN 'Department Manager'
        WHEN as_.actor_type = 'USER_MANAGER' THEN 'User Manager'
        ELSE as_.actor_value
      END,
      'action', as_.action_label,
      -- Include deprecated fields for compatibility
      'roleId', as_.role_id,
      'userId', as_.user_id
    ) ORDER BY as_.step_order
  ) as steps
FROM approval_chains ac
LEFT JOIN approval_steps as_ ON ac.id = as_.chain_id
GROUP BY ac.id;
```

## Migration Scripts

### Files Created:

1. **`003-add-actor-columns.sql`** - Main migration script
   - Creates new tables and columns
   - Adds indexes and constraints
   - Creates backfill functions
   - Maintains backward compatibility

2. **`003-add-actor-columns-rollback.sql`** - Complete rollback script
   - Removes all new objects
   - Restores original triggers
   - Preserves original JSON data

3. **`003-data-backfill-strategy.sql`** - Comprehensive backfill strategy
   - Safe migration with validation
   - Multiple backfill strategies
   - Error handling and logging
   - Verification functions

### Execution Steps:

**1. Apply Migration:**
```sql
-- Apply the main migration
\i sql/migrations/003-add-actor-columns.sql

-- Execute data backfill
SELECT * FROM execute_complete_backfill();

-- Verify migration
SELECT * FROM verify_migration_completeness();
```

**2. Test Backward Compatibility:**
```sql
-- Test that old JSON queries still work
SELECT steps FROM approval_chains_with_steps WHERE id = 'chain-uuid';

-- Test that approval_actions are still created
INSERT INTO approval_requests (...) VALUES (...);
SELECT * FROM approval_actions WHERE request_id = 'new-request';
```

**3. Rollback if Needed:**
```sql
-- Complete rollback
\i sql/migrations/003-add-actor-columns-rollback.sql
```

## Data Transformation Examples

### Example 1: Role-based Step
**Before (JSON):**
```json
{
  "order": 1,
  "name": "Manager Review",
  "roleName": "Department Manager",
  "action": "Approve"
}
```

**After (approval_steps):**
```sql
INSERT INTO approval_steps (
  chain_id, step_order, name, actor_type, actor_value, 
  action_label, role_id  -- DEPRECATED
) VALUES (
  'chain-uuid', 1, 'Manager Review', 'ROLE', 'Department Manager',
  'Approve', 'role-uuid'
);
```

### Example 2: User-specific Step
**Before (JSON):**
```json
{
  "order": 2,
  "name": "Specific User Approval",
  "type": "user",
  "userEmail": "manager@company.com",
  "action": "Approve"
}
```

**After (approval_steps):**
```sql
INSERT INTO approval_steps (
  chain_id, step_order, name, actor_type, actor_value,
  action_label, user_id  -- DEPRECATED
) VALUES (
  'chain-uuid', 2, 'Specific User Approval', 'SPECIFIC_USER', 'user-uuid',
  'Approve', 'user-uuid'
);
```

### Example 3: Manager Step
**Before (JSON):**
```json
{
  "order": 3,
  "name": "User Manager Approval",
  "type": "manager",
  "action": "Approve"
}
```

**After (approval_steps):**
```sql
INSERT INTO approval_steps (
  chain_id, step_order, name, actor_type, actor_value,
  action_label
) VALUES (
  'chain-uuid', 3, 'User Manager Approval', 'USER_MANAGER', NULL,
  'Approve'
);
```

## Verification Checklist

### Pre-Migration:
- [ ] Backup database
- [ ] Document current approval chains structure
- [ ] Identify custom integrations using JSON steps

### Post-Migration:
- [ ] All approval chains migrated to approval_steps
- [ ] Manager relationships populated
- [ ] Department managers assigned
- [ ] User departments synced
- [ ] Backward compatibility verified
- [ ] Existing API endpoints working
- [ ] New actor types functioning

### Performance:
- [ ] Indexes created and used
- [ ] Query performance maintained
- [ ] Migration completion time acceptable

## Risk Mitigation

### Data Loss Prevention:
- Original JSON data preserved in `approval_chains.steps`
- Deprecated columns kept as backup
- Complete rollback script available
- Migration is idempotent (can be re-run safely)

### Performance Impact:
- New indexes for optimal query performance
- View for backward compatibility
- Minimal impact on existing queries

### Rollback Plan:
- Complete rollback script tested
- Data can be restored to original state
- No destructive changes to original tables

## Future Considerations

### Phase 2 Migration (Future):
- Remove deprecated columns after verification
- Update all APIs to use new actor types
- Remove backward compatibility views
- Optimize for new structure

### Dynamic Resolution Integration:
- Integrate with DynamicApproverResolver service
- Update approval workflow logic
- Add department-scoped visibility
- Implement change request resume functionality

This migration provides a solid foundation for dynamic approver resolution while maintaining complete backward compatibility and data safety.
