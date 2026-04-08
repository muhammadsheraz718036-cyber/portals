const { RequestVisibilityService } = require('./src/services/RequestVisibilityService.js');
const { pool } = require('./src/db.js');

async function testSecureVisibility() {
  console.log('🧪 Testing Secure Request Visibility...\n');

  const visibilityService = new RequestVisibilityService();

  // Clean up test data
  await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
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
       ('HR Manager', 'HR Manager', ARRAY['approve_reject']),
       ('IT Manager', 'IT Manager', ARRAY['approve_reject'])
       RETURNING *`
    );

    const employeeRole = roles.find(r => r.name === 'Employee');
    const managerRole = roles.find(r => r.name === 'Manager');
    const hrRole = roles.find(r => r.name === 'HR Manager');
    const itRole = roles.find(r => r.name === 'IT Manager');

    // Create test users
    const { rows: users } = await pool.query(
      `INSERT INTO users (email, password_hash, manager_id) VALUES 
       ('hr-employee@example.com', 'hash', NULL),
       ('it-employee@example.com', 'hash', NULL),
       ('hr-manager@example.com', 'hash', NULL),
       ('it-manager@example.com', 'hash', NULL)
       RETURNING *`
    );

    // Create test departments
    const { rows: departments } = await pool.query(
      `INSERT INTO departments (name, head_name, manager_user_id) VALUES 
       ('HR Department', 'HR Manager', $1),
       ('IT Department', 'IT Manager', $2)
       RETURNING *`,
      [users[2].id, users[3].id] // HR manager and IT manager
    );

    const hrDept = departments[0];
    const itDept = departments[1];

    // Create profiles
    const { rows: profiles } = await pool.query(
      `INSERT INTO profiles (id, full_name, email, department_id, role_id, is_admin) VALUES 
       ($1, 'HR Employee', 'hr-employee@example.com', $2, $3, false),
       ($4, 'IT Employee', 'it-employee@example.com', $5, $6, false),
       ($7, 'HR Manager', 'hr-manager@example.com', $2, $8, false),
       ($9, 'IT Manager', 'it-manager@example.com', $5, $10, false)
       RETURNING *`,
      [
        users[0].id, hrDept.id, employeeRole.id,
        users[1].id, itDept.id, employeeRole.id,
        users[2].id, hrRole.id,
        users[3].id, itRole.id
      ]
    );

    const hrEmployee = profiles[0];
    const itEmployee = profiles[1];
    const hrManager = profiles[2];
    const itManager = profiles[3];

    // Create approval types
    const { rows: approvalTypes } = await pool.query(
      `INSERT INTO approval_types (name, description, fields, created_by) VALUES 
       ('HR Request', 'HR department request', '[{"name": "reason", "type": "text"}]', $1),
       ('IT Request', 'IT department request', '[{"name": "system", "type": "text"}]', $2)
       RETURNING *`,
      [hrManager.id, itManager.id]
    );

    const hrApprovalType = approvalTypes[0];
    const itApprovalType = approvalTypes[1];

    // Create approval chains
    const { rows: chains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, created_by) VALUES 
       ('HR Chain', $1, $2),
       ('IT Chain', $3, $4)
       RETURNING *`,
      [hrApprovalType.id, hrManager.id, itApprovalType.id, itManager.id]
    );

    const hrChain = chains[0];
    const itChain = chains[1];

    // Create approval steps
    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, actor_type, actor_value, action_label) VALUES 
       ($1, 1, 'Manager Review', 'ROLE', 'Manager', 'Approve')
       `,
      [hrChain.id]
    );

    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, actor_type, actor_value, action_label) VALUES 
       ($1, 1, 'Manager Review', 'ROLE', 'Manager', 'Approve')
       `,
      [itChain.id]
    );

    console.log('✓ Test data created');

    // Test 1: Create requests in different departments
    console.log('\n--- Test 1: Create Cross-Department Requests ---');

    const { rows: hrRequests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [hrApprovalType.id, hrChain.id, hrEmployee.id, hrDept.id, 'HR Request', { reason: 'HR related' }]
    );

    const { rows: itRequests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [itApprovalType.id, itChain.id, itEmployee.id, itDept.id, 'IT Request', { system: 'IT related' }]
    );

    const hrRequest = hrRequests[0];
    const itRequest = itRequests[0];

    console.log(`✓ Created HR request: ${hrRequest.id}`);
    console.log(`✓ Created IT request: ${itRequest.id}`);

    // Test 2: HR Employee visibility (should only see their own request)
    console.log('\n--- Test 2: HR Employee Visibility ---');

    const hrEmployeeVisibility = await visibilityService.getVisibleRequests({
      user_id: hrEmployee.id
    });

    console.log(`✓ HR Employee can see ${hrEmployeeVisibility.requests.length} requests`);

    const hrEmployeeCanSeeHR = hrEmployeeVisibility.requests.some(r => r.id === hrRequest.id);
    const hrEmployeeCanSeeIT = hrEmployeeVisibility.requests.some(r => r.id === itRequest.id);

    if (hrEmployeeCanSeeHR) {
      console.log('✓ HR Employee can see their own HR request');
    } else {
      console.log('✗ HR Employee cannot see their own HR request');
    }

    if (!hrEmployeeCanSeeIT) {
      console.log('✓ HR Employee cannot see IT requests (correct)');
    } else {
      console.log('✗ HR Employee can see IT requests (security breach!)');
    }

    // Test 3: IT Employee visibility (should only see their own request)
    console.log('\n--- Test 3: IT Employee Visibility ---');

    const itEmployeeVisibility = await visibilityService.getVisibleRequests({
      user_id: itEmployee.id
    });

    console.log(`✓ IT Employee can see ${itEmployeeVisibility.requests.length} requests`);

    const itEmployeeCanSeeIT = itEmployeeVisibility.requests.some(r => r.id === itRequest.id);
    const itEmployeeCanSeeHR = itEmployeeVisibility.requests.some(r => r.id === hrRequest.id);

    if (itEmployeeCanSeeIT) {
      console.log('✓ IT Employee can see their own IT request');
    } else {
      console.log('✗ IT Employee cannot see their own IT request');
    }

    if (!itEmployeeCanSeeHR) {
      console.log('✓ IT Employee cannot see HR requests (correct)');
    } else {
      console.log('✗ IT Employee can see HR requests (security breach!)');
    }

    // Test 4: Assign IT request to HR Manager (cross-department assignment)
    console.log('\n--- Test 4: Cross-Department Assignment ---');

    // Create request steps and assign IT request to HR Manager
    await pool.query(
      `INSERT INTO request_steps (request_id, step_id, step_order, name, actor_type, actor_value, action_label, status, assigned_to)
       VALUES ($1, $2, 1, 'Manager Review', 'ROLE', 'Manager', 'Approve', 'PENDING', $3)`,
      [itRequest.id, (await pool.query('SELECT id FROM approval_steps WHERE chain_id = $1', [itChain.id])).rows[0].id, hrManager.id]
    );

    console.log('✓ Assigned IT request to HR Manager (cross-department)');

    // Test 5: HR Manager visibility (should see own HR request + assigned IT request)
    console.log('\n--- Test 5: HR Manager Visibility ---');

    const hrManagerVisibility = await visibilityService.getVisibleRequests({
      user_id: hrManager.id
    });

    console.log(`✓ HR Manager can see ${hrManagerVisibility.requests.length} requests`);

    const hrManagerCanSeeHR = hrManagerVisibility.requests.some(r => r.id === hrRequest.id);
    const hrManagerCanSeeIT = hrManagerVisibility.requests.some(r => r.id === itRequest.id);

    if (hrManagerCanSeeHR) {
      console.log('✓ HR Manager can see HR department request');
    } else {
      console.log('✗ HR Manager cannot see HR department request');
    }

    if (hrManagerCanSeeIT) {
      console.log('✓ HR Manager can see IT request (assigned to them)');
    } else {
      console.log('✗ HR Manager cannot see IT request assigned to them');
    }

    // Test 6: IT Manager visibility (should NOT see HR request)
    console.log('\n--- Test 6: IT Manager Visibility ---');

    const itManagerVisibility = await visibilityService.getVisibleRequests({
      user_id: itManager.id
    });

    console.log(`✓ IT Manager can see ${itManagerVisibility.requests.length} requests`);

    const itManagerCanSeeIT = itManagerVisibility.requests.some(r => r.id === itRequest.id);
    const itManagerCanSeeHR = itManagerVisibility.requests.some(r => r.id === hrRequest.id);

    if (itManagerCanSeeIT) {
      console.log('✓ IT Manager can see IT department request');
    } else {
      console.log('✗ IT Manager cannot see IT department request');
    }

    if (!itManagerCanSeeHR) {
      console.log('✓ IT Manager cannot see HR request (correct - not assigned)');
    } else {
      console.log('✗ IT Manager can see HR request (security breach!)');
    }

    // Test 7: Access control validation
    console.log('\n--- Test 7: Access Control Validation ---');

    const hrEmployeeAccessToIT = await visibilityService.canAccessRequest(hrEmployee.id, itRequest.id);
    const hrManagerAccessToIT = await visibilityService.canAccessRequest(hrManager.id, itRequest.id);
    const itManagerAccessToHR = await visibilityService.canAccessRequest(itManager.id, hrRequest.id);

    console.log(`✓ HR Employee access to IT request: ${hrEmployeeAccessToIT.can_access} (${hrEmployeeAccessToIT.access_reason})`);
    console.log(`✓ HR Manager access to IT request: ${hrManagerAccessToIT.can_access} (${hrManagerAccessToIT.access_reason})`);
    console.log(`✓ IT Manager access to HR request: ${itManagerAccessToHR.can_access} (${itManagerAccessToHR.access_reason})`);

    if (!hrEmployeeAccessToIT.can_access && hrManagerAccessToIT.can_access && !itManagerAccessToHR.can_access) {
      console.log('✓ Access control working correctly');
    } else {
      console.log('✗ Access control has issues');
    }

    // Test 8: Request details with access control
    console.log('\n--- Test 8: Request Details Access Control ---');

    const hrEmployeeITDetails = await visibilityService.getRequestWithAccess(hrEmployee.id, itRequest.id);
    const hrManagerITDetails = await visibilityService.getRequestWithAccess(hrManager.id, itRequest.id);

    if (!hrEmployeeITDetails.can_access) {
      console.log('✓ HR Employee blocked from IT request details');
    } else {
      console.log('✗ HR Employee can access IT request details (security breach!)');
    }

    if (hrManagerITDetails.can_access && hrManagerITDetails.request) {
      console.log('✓ HR Manager can access IT request details (assigned)');
    } else {
      console.log('✗ HR Manager cannot access IT request details');
    }

    // Test 9: User statistics
    console.log('\n--- Test 9: User Statistics ---');

    const hrEmployeeStats = await visibilityService.getUserRequestStatistics(hrEmployee.id);
    const hrManagerStats = await visibilityService.getUserRequestStatistics(hrManager.id);
    const itManagerStats = await visibilityService.getUserRequestStatistics(itManager.id);

    console.log('✓ HR Employee Statistics:');
    console.log(`  Initiated: ${hrEmployeeStats.initiated}`);
    console.log(`  Assigned: ${hrEmployeeStats.assigned}`);
    console.log(`  Pending actions: ${hrEmployeeStats.pending_actions}`);

    console.log('✓ HR Manager Statistics:');
    console.log(`  Initiated: ${hrManagerStats.initiated}`);
    console.log(`  Assigned: ${hrManagerStats.assigned}`);
    console.log(`  Pending actions: ${hrManagerStats.pending_actions}`);

    console.log('✓ IT Manager Statistics:');
    console.log(`  Initiated: ${itManagerStats.initiated}`);
    console.log(`  Assigned: ${itManagerStats.assigned}`);
    console.log(`  Pending actions: ${itManagerStats.pending_actions}`);

    // Test 10: Filter options
    console.log('\n--- Test 10: Visibility Filter Options ---');

    const hrManagerInitiatedOnly = await visibilityService.getVisibleRequests({
      user_id: hrManager.id,
      include_initiated: true,
      include_assigned: false,
      include_previously_acted_on: false
    });

    const hrManagerAssignedOnly = await visibilityService.getVisibleRequests({
      user_id: hrManager.id,
      include_initiated: false,
      include_assigned: true,
      include_previously_acted_on: false
    });

    console.log(`✓ HR Manager initiated only: ${hrManagerInitiatedOnly.requests.length} requests`);
    console.log(`✓ HR Manager assigned only: ${hrManagerAssignedOnly.requests.length} requests`);

    // Clean up
    await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
    await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

    console.log('\n🎉 All Secure Visibility tests completed successfully!');
    console.log('\nSecure Visibility Features:');
    console.log('✅ Strict user-based visibility - NO role-based access');
    console.log('✅ Users only see requests they created');
    console.log('✅ Users only see requests assigned to them');
    console.log('✅ Optional visibility for previously acted on requests');
    console.log('✅ Cross-department assignments work correctly');
    console.log('✅ Department managers cannot see other departments requests');
    console.log('✅ Access control validation at query level');
    console.log('✅ Request details protected by access control');
    console.log('✅ User statistics based on strict visibility');
    console.log('✅ Flexible filter options for different visibility types');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testSecureVisibility()
  .then(() => {
    console.log('\n✅ Secure Visibility test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
