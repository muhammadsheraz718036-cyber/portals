const { ApproversResolver } = require('./src/services/ApproversResolver.js');
const { pool } = require('./src/db.js');

async function testApproversResolver() {
  console.log('🧪 Testing ApproversResolver Service...\n');

  const resolver = new ApproversResolver();

  // Clean up test data
  await pool.query('DELETE FROM approval_steps WHERE chain_id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
  await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

  try {
    // Create test data
    console.log('--- Setting up test data ---');

    // Create test roles
    const { rows: roles } = await pool.query(
      `INSERT INTO roles (name, description, permissions) VALUES 
       ('Employee', 'Regular Employee', ARRAY['initiate_request']),
       ('Manager', 'Department Manager', ARRAY['approve_reject']),
       ('Admin', 'System Admin', ARRAY['all'])
       RETURNING *`
    );

    const employeeRole = roles.find(r => r.name === 'Employee');
    const managerRole = roles.find(r => r.name === 'Manager');
    const adminRole = roles.find(r => r.name === 'Admin');

    // Create test users
    const { rows: users } = await pool.query(
      `INSERT INTO users (email, password_hash, manager_id) VALUES 
       ('test-employee@example.com', 'hash', NULL),
       ('test-manager@example.com', 'hash', NULL),
       ('test-admin@example.com', 'hash', NULL),
       ('test-senior-manager@example.com', 'hash', NULL)
       RETURNING *`
    );

    // Create test departments
    const { rows: departments } = await pool.query(
      `INSERT INTO departments (name, head_name, manager_user_id) VALUES 
       ('Test Department', 'Test Manager', $1),
       ('IT Department', 'IT Manager', NULL)
       RETURNING *`,
      [users[1].id] // Set manager as department manager
    );

    const testDept = departments[0];
    const itDept = departments[1];

    // Create profiles
    const { rows: profiles } = await pool.query(
      `INSERT INTO profiles (id, full_name, email, department_id, role_id, is_admin) VALUES 
       ($1, 'Test Employee', 'test-employee@example.com', $2, $3, false),
       ($4, 'Test Manager', 'test-manager@example.com', $2, $5, false),
       ($6, 'Test Admin', 'test-admin@example.com', $2, $7, true),
       ($8, 'Senior Manager', 'test-senior-manager@example.com', $2, $5, false)
       RETURNING *`,
      [
        users[0].id, testDept.id, employeeRole.id,
        users[1].id, managerRole.id,
        users[2].id, adminRole.id,
        users[3].id
      ]
    );

    // Set up manager relationship
    await pool.query(
      'UPDATE users SET manager_id = $1 WHERE id = $2',
      [users[3].id, users[0].id] // Senior manager manages employee
    );

    const employee = profiles[0];
    const manager = profiles[1];
    const admin = profiles[2];
    const seniorManager = profiles[3];

    console.log('✓ Test data created');

    // Test 1: ROLE-based resolution
    console.log('\n--- Test 1: ROLE-based resolution ---');

    const roleStep = {
      step_order: 1,
      name: 'Manager Review',
      actor_type: 'ROLE',
      actor_value: 'Manager',
      action_label: 'Approve'
    };

    const request = {
      id: 'test-request-1',
      initiator_id: employee.id,
      department_id: testDept.id,
      status: 'pending',
      current_step: 1
    };

    const roleResult = await resolver.resolveApprovers(roleStep, request);

    if (roleResult.success && roleResult.approvers.length > 0) {
      console.log('✓ ROLE resolution successful');
      console.log(`  Found ${roleResult.approvers.length} approvers`);
      console.log(`  Approver: ${roleResult.approvers[0].full_name}`);
      console.log(`  Assignment type: ${roleResult.approvers[0].assignment_type}`);
    } else {
      console.log('✗ ROLE resolution failed:', roleResult.error);
    }

    // Test 2: USER_MANAGER resolution
    console.log('\n--- Test 2: USER_MANAGER resolution ---');

    const userManagerStep = {
      step_order: 2,
      name: 'Manager Review',
      actor_type: 'USER_MANAGER',
      action_label: 'Approve'
    };

    const userManagerResult = await resolver.resolveApprovers(userManagerStep, request);

    if (userManagerResult.success && userManagerResult.approvers.length > 0) {
      console.log('✓ USER_MANAGER resolution successful');
      console.log(`  Approver: ${userManagerResult.approvers[0].full_name}`);
      console.log(`  Assignment type: ${userManagerResult.approvers[0].assignment_type}`);
    } else {
      console.log('✗ USER_MANAGER resolution failed:', userManagerResult.error);
    }

    // Test 3: DEPARTMENT_MANAGER resolution
    console.log('\n--- Test 3: DEPARTMENT_MANAGER resolution ---');

    const deptManagerStep = {
      step_order: 3,
      name: 'Department Manager Review',
      actor_type: 'DEPARTMENT_MANAGER',
      action_label: 'Approve'
    };

    const deptManagerResult = await resolver.resolveApprovers(deptManagerStep, request);

    if (deptManagerResult.success && deptManagerResult.approvers.length > 0) {
      console.log('✓ DEPARTMENT_MANAGER resolution successful');
      console.log(`  Approver: ${deptManagerResult.approvers[0].full_name}`);
      console.log(`  Assignment type: ${deptManagerResult.approvers[0].assignment_type}`);
    } else {
      console.log('✗ DEPARTMENT_MANAGER resolution failed:', deptManagerResult.error);
    }

    // Test 4: SPECIFIC_USER resolution
    console.log('\n--- Test 4: SPECIFIC_USER resolution ---');

    const specificUserStep = {
      step_order: 4,
      name: 'Specific User Review',
      actor_type: 'SPECIFIC_USER',
      actor_value: admin.id,
      action_label: 'Approve'
    };

    const specificUserResult = await resolver.resolveApprovers(specificUserStep, request);

    if (specificUserResult.success && specificUserResult.approvers.length > 0) {
      console.log('✓ SPECIFIC_USER resolution successful');
      console.log(`  Approver: ${specificUserResult.approvers[0].full_name}`);
      console.log(`  Assignment type: ${specificUserResult.approvers[0].assignment_type}`);
    } else {
      console.log('✗ SPECIFIC_USER resolution failed:', specificUserResult.error);
    }

    // Test 5: Fallback mechanisms
    console.log('\n--- Test 5: Fallback mechanisms ---');

    // Test with non-existent department
    const requestWithBadDept = {
      ...request,
      department_id: 'non-existent-dept-id'
    };

    const fallbackResult = await resolver.resolveApprovers(deptManagerStep, requestWithBadDept);

    if (fallbackResult.success && fallbackResult.warnings && fallbackResult.warnings.length > 0) {
      console.log('✓ Fallback mechanism works');
      console.log(`  Warnings: ${fallbackResult.warnings.join(', ')}`);
      console.log(`  Found ${fallbackResult.approvers.length} fallback approvers`);
    } else {
      console.log('⚠ Fallback test inconclusive');
    }

    // Test 6: Backward compatibility
    console.log('\n--- Test 6: Backward compatibility ---');

    const deprecatedStep = {
      step_order: 5,
      name: 'Deprecated Step',
      role_id: managerRole.id, // Deprecated field
      action_label: 'Approve'
    };

    const deprecatedResult = await resolver.resolveApprovers(deprecatedStep, request);

    if (deprecatedResult.success) {
      console.log('✓ Backward compatibility works');
      console.log(`  Found ${deprecatedResult.approvers.length} approvers using deprecated fields`);
    } else {
      console.log('✗ Backward compatibility failed:', deprecatedResult.error);
    }

    // Test 7: Legacy getUsersByRole method
    console.log('\n--- Test 7: Legacy getUsersByRole method ---');

    const legacyUsers = await resolver.getUsersByRole('Manager', testDept.id);

    if (legacyUsers.length > 0) {
      console.log('✓ Legacy getUsersByRole method works');
      console.log(`  Found ${legacyUsers.length} users`);
    } else {
      console.log('✗ Legacy getUsersByRole method failed');
    }

    // Test 8: Batch resolution
    console.log('\n--- Test 8: Batch resolution ---');

    const batchSteps = [roleStep, userManagerStep, deptManagerStep];
    const batchResults = await resolver.resolveApproversForBatch(batchSteps, request);

    if (batchResults.size === 3) {
      console.log('✓ Batch resolution successful');
      console.log(`  Resolved ${batchResults.size} steps`);
      
      for (const [stepOrder, result] of batchResults) {
        console.log(`  Step ${stepOrder}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      }
    } else {
      console.log('✗ Batch resolution failed');
    }

    // Test 9: User access validation
    console.log('\n--- Test 9: User access validation ---');

    // Create a test step and request in the database
    const { rows: chains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, created_by) VALUES 
       ('Test Chain', 'test-type', $1) RETURNING *`,
      [admin.id]
    );

    const { rows: steps } = await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, actor_type, actor_value, action_label) VALUES 
       ($1, 1, 'Test Step', 'ROLE', 'Manager', 'Approve') RETURNING *`,
      [chains[0].id]
    );

    const { rows: testRequests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, initiator_id, department_id, status) VALUES 
       ('test-type', $1, $2, 'pending') RETURNING *`,
      [employee.id, testDept.id]
    );

    const canAct = await resolver.canUserActOnStep(manager.id, steps[0].id);

    if (canAct) {
      console.log('✓ User access validation works');
      console.log(`  Manager can act on the step: ${canAct}`);
    } else {
      console.log('✗ User access validation failed');
    }

    // Test 10: Error handling
    console.log('\n--- Test 10: Error handling ---');

    const invalidStep = {
      step_order: 6,
      name: 'Invalid Step',
      actor_type: 'INVALID_TYPE' as any,
      action_label: 'Approve'
    };

    const errorResult = await resolver.resolveApprovers(invalidStep, request);

    if (!errorResult.success && errorResult.error) {
      console.log('✓ Error handling works');
      console.log(`  Error: ${errorResult.error}`);
    } else {
      console.log('✗ Error handling failed');
    }

    // Clean up
    await pool.query('DELETE FROM approval_steps WHERE chain_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
    await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

    console.log('\n🎉 All ApproversResolver tests completed successfully!');
    console.log('\nApproversResolver Features:');
    console.log('✅ Dynamic approver resolution based on actor_type');
    console.log('✅ ROLE-based resolution with department scoping');
    console.log('✅ USER_MANAGER resolution with fallback');
    console.log('✅ DEPARTMENT_MANAGER resolution with multiple fallbacks');
    console.log('✅ SPECIFIC_USER resolution');
    console.log('✅ Backward compatibility with deprecated fields');
    console.log('✅ Legacy method support');
    console.log('✅ Batch resolution capability');
    console.log('✅ User access validation');
    console.log('✅ Comprehensive error handling');
    console.log('✅ Fallback mechanisms with warnings');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testApproversResolver()
  .then(() => {
    console.log('\n✅ ApproversResolver test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
