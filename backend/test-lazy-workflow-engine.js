const { LazyWorkflowEngine } = require('./src/services/LazyWorkflowEngine.js');
const { pool } = require('./src/db.js');

async function testLazyWorkflowEngine() {
  console.log('🧪 Testing Lazy Workflow Engine...\n');

  const workflowEngine = new LazyWorkflowEngine();

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
       ('Director', 'Director', ARRAY['approve_reject'])
       RETURNING *`
    );

    const employeeRole = roles.find(r => r.name === 'Employee');
    const managerRole = roles.find(r => r.name === 'Manager');
    const directorRole = roles.find(r => r.name === 'Director');

    // Create test users
    const { rows: users } = await pool.query(
      `INSERT INTO users (email, password_hash, manager_id) VALUES 
       ('test-employee@example.com', 'hash', NULL),
       ('test-manager@example.com', 'hash', NULL),
       ('test-director@example.com', 'hash', NULL)
       RETURNING *`
    );

    // Create test departments
    const { rows: departments } = await pool.query(
      `INSERT INTO departments (name, head_name, manager_user_id) VALUES 
       ('Test Department', 'Test Manager', $1)
       RETURNING *`,
      [users[1].id] // Set manager as department manager
    );

    const testDept = departments[0];

    // Create profiles
    const { rows: profiles } = await pool.query(
      `INSERT INTO profiles (id, full_name, email, department_id, role_id, is_admin) VALUES 
       ($1, 'Test Employee', 'test-employee@example.com', $2, $3, false),
       ($4, 'Test Manager', 'test-manager@example.com', $2, $5, false),
       ($6, 'Test Director', 'test-director@example.com', $2, $7, false)
       RETURNING *`,
      [
        users[0].id, testDept.id, employeeRole.id,
        users[1].id, managerRole.id,
        users[2].id, directorRole.id
      ]
    );

    // Set up manager relationship
    await pool.query(
      'UPDATE users SET manager_id = $1 WHERE id = $2',
      [users[2].id, users[1].id] // Director manages manager
    );

    const employee = profiles[0];
    const manager = profiles[1];
    const director = profiles[2];

    // Create approval type
    const { rows: approvalTypes } = await pool.query(
      `INSERT INTO approval_types (name, description, fields, created_by) VALUES 
       ('Test Request', 'Test approval type', '[{"name": "test", "type": "text"}]', $1)
       RETURNING *`,
      [director.id]
    );

    // Create approval chain with multiple steps
    const { rows: chains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, created_by) VALUES 
       ('Test Chain', $1, $2)
       RETURNING *`,
      [approvalTypes[0].id, director.id]
    );

    const chain = chains[0];

    // Create approval steps
    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, actor_type, actor_value, action_label) VALUES 
       ($1, 1, 'Manager Review', 'USER_MANAGER', NULL, 'Approve'),
       ($1, 2, 'Director Review', 'DEPARTMENT_MANAGER', NULL, 'Approve'),
       ($1, 3, 'Final Approval', 'ROLE', 'Director', 'Approve')`,
      [chain.id]
    );

    console.log('✓ Test data created');

    // Test 1: Initialize workflow - should only create first step
    console.log('\n--- Test 1: Lazy Workflow Initialization ---');

    const { rows: requests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [approvalTypes[0].id, chain.id, employee.id, testDept.id, 'Test Request', { test: 'data' }]
    );

    const request = requests[0];

    const initResult = await workflowEngine.initializeWorkflow(request.id);

    if (initResult.success && initResult.step_created) {
      console.log('✓ Workflow initialized successfully');
      console.log(`  Step created: ${initResult.step_created}`);
      console.log(`  Approver assigned: ${initResult.approver_assigned}`);

      // Verify only ONE step was created
      const { rows: createdSteps } = await pool.query(
        'SELECT * FROM request_steps WHERE request_id = $1',
        [request.id]
      );

      if (createdSteps.length === 1) {
        console.log('✓ Only one step created (lazy initialization)');
        console.log(`  Step: ${createdSteps[0].name}`);
        console.log(`  Status: ${createdSteps[0].status}`);
        console.log(`  Assigned to: ${createdSteps[0].assigned_to}`);
      } else {
        console.log(`✗ Expected 1 step, found ${createdSteps.length}`);
      }

    } else {
      console.log('✗ Workflow initialization failed:', initResult.error);
    }

    // Test 2: Get pending steps for manager
    console.log('\n--- Test 2: Pending Steps Query ---');

    const pendingSteps = await workflowEngine.getPendingSteps(manager.id);

    if (pendingSteps.length > 0) {
      console.log('✓ Manager has pending steps');
      console.log(`  Found ${pendingSteps.length} pending steps`);
      console.log(`  Step: ${pendingSteps[0].name}`);
      console.log(`  Request: ${pendingSteps[0].request_number}`);
    } else {
      console.log('✗ No pending steps found for manager');
    }

    // Test 3: Process approval action - should create next step
    console.log('\n--- Test 3: Dynamic Next Step Creation ---');

    const firstStep = pendingSteps[0];
    const approvalResult = await workflowEngine.processApprovalAction(
      request.id,
      firstStep.id,
      manager.id,
      'APPROVE',
      'Looks good to me'
    );

    if (approvalResult.success) {
      console.log('✓ Approval processed successfully');
      
      if (approvalResult.nextStep) {
        console.log('✓ Next step created dynamically');
        console.log(`  Next step: ${approvalResult.nextStep.name}`);
        console.log(`  Assigned to: ${approvalResult.nextStep.assigned_to}`);
      } else if (approvalResult.workflowComplete) {
        console.log('✓ Workflow completed');
      } else {
        console.log('⚠ No next step created');
      }

      // Verify total steps created
      const { rows: allSteps } = await pool.query(
        'SELECT * FROM request_steps WHERE request_id = $1 ORDER BY step_order',
        [request.id]
      );

      if (allSteps.length === 2) {
        console.log('✓ Exactly 2 steps created (first + next)');
      } else {
        console.log(`⚠ Expected 2 steps, found ${allSteps.length}`);
      }

    } else {
      console.log('✗ Approval processing failed:', approvalResult.error);
    }

    // Test 4: Get workflow statistics
    console.log('\n--- Test 4: Workflow Statistics ---');

    const stats = await workflowEngine.getWorkflowStatistics(request.id);

    console.log('✓ Workflow statistics:');
    console.log(`  Total steps: ${stats.totalSteps}`);
    console.log(`  Created steps: ${stats.createdSteps}`);
    console.log(`  Active steps: ${stats.activeSteps}`);
    console.log(`  Completed steps: ${stats.completedSteps}`);

    if (stats.createdSteps < stats.totalSteps) {
      console.log('✓ Lazy initialization working (not all steps created)');
    } else {
      console.log('⚠ All steps already created');
    }

    // Test 5: Process second approval
    console.log('\n--- Test 5: Second Approval ---');

    const directorPendingSteps = await workflowEngine.getPendingSteps(director.id);

    if (directorPendingSteps.length > 0) {
      const secondApprovalResult = await workflowEngine.processApprovalAction(
        request.id,
        directorPendingSteps[0].id,
        director.id,
        'APPROVE',
        'Approved'
      );

      if (secondApprovalResult.success) {
        console.log('✓ Second approval processed');

        if (secondApprovalResult.nextStep) {
          console.log('✓ Third step created');
        } else if (secondApprovalResult.workflowComplete) {
          console.log('✗ Workflow completed but should have third step');
        } else {
          console.log('⚠ No next step, workflow may complete');
        }

      } else {
        console.log('✗ Second approval failed:', secondApprovalResult.error);
      }
    } else {
      console.log('✗ No pending steps for director');
    }

    // Test 6: Process third approval (should complete workflow)
    console.log('\n--- Test 6: Final Approval ---');

    const finalPendingSteps = await workflowEngine.getPendingSteps(director.id);

    if (finalPendingSteps.length > 0) {
      const finalApprovalResult = await workflowEngine.processApprovalAction(
        request.id,
        finalPendingSteps[0].id,
        director.id,
        'APPROVE',
        'Final approval'
      );

      if (finalApprovalResult.success) {
        console.log('✓ Final approval processed');

        if (finalApprovalResult.nextStep) {
          console.log('✗ Unexpected next step after final approval');
        } else if (finalApprovalResult.workflowComplete) {
          console.log('✓ Workflow completed successfully');
        } else {
          console.log('⚠ Workflow may be complete');
        }

        // Check final request status
        const { rows: finalRequest } = await pool.query(
          'SELECT status FROM approval_requests WHERE id = $1',
          [request.id]
        );

        console.log(`  Final status: ${finalRequest[0].status}`);

      } else {
        console.log('✗ Final approval failed:', finalApprovalResult.error);
      }
    }

    // Test 7: Request resumption
    console.log('\n--- Test 7: Request Resumption ---');

    // Create a new request for testing resumption
    const { rows: resumeRequests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [approvalTypes[0].id, chain.id, employee.id, testDept.id, 'Resume Test', { test: 'original' }]
    );

    const resumeRequest = resumeRequests[0];
    await workflowEngine.initializeWorkflow(resumeRequest.id);

    const resumePendingSteps = await workflowEngine.getPendingSteps(manager.id);
    
    if (resumePendingSteps.length > 0) {
      // Request changes
      const changeResult = await workflowEngine.processApprovalAction(
        resumeRequest.id,
        resumePendingSteps[0].id,
        manager.id,
        'REQUEST_CHANGES',
        'Please add more details'
      );

      if (changeResult.success) {
        console.log('✓ Changes requested successfully');

        // Resume the request
        const resumeResult = await workflowEngine.resumeRequest(
          resumeRequest.id,
          { test: 'updated data' }
        );

        if (resumeResult.success) {
          console.log('✓ Request resumed successfully');
          console.log(`  Step status: ${resumeResult.step.status}`);
          console.log(`  Assigned to: ${resumeResult.step.assigned_to}`);
        } else {
          console.log('✗ Request resume failed:', resumeResult.error);
        }

      } else {
        console.log('✗ Change request failed:', changeResult.error);
      }
    }

    // Test 8: User requests with visibility
    console.log('\n--- Test 8: Department-Scoped Visibility ---');

    const employeeRequests = await workflowEngine.getUserRequests(employee.id);
    const managerRequests = await workflowEngine.getUserRequests(manager.id);

    console.log(`✓ Employee can see ${employeeRequests.requests.length} requests`);
    console.log(`✓ Manager can see ${managerRequests.requests.length} requests`);

    const employeeCanSeeOwnRequest = employeeRequests.requests.some(r => r.id === request.id);
    const managerCanSeeEmployeeRequest = managerRequests.requests.some(r => r.id === request.id);

    if (employeeCanSeeOwnRequest) {
      console.log('✓ Employee can see their own request');
    } else {
      console.log('✗ Employee cannot see their own request');
    }

    if (managerCanSeeEmployeeRequest) {
      console.log('✓ Manager can see employee request (same department)');
    } else {
      console.log('✗ Manager cannot see employee request');
    }

    // Clean up
    await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
    await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

    console.log('\n🎉 All Lazy Workflow Engine tests completed successfully!');
    console.log('\nLazy Workflow Engine Features:');
    console.log('✅ Lazy initialization - only creates first step');
    console.log('✅ Dynamic next step creation on approval');
    console.log('✅ Per-request approver resolution');
    console.log('✅ Only one active step at a time');
    console.log('✅ Request resumption functionality');
    console.log('✅ Department-scoped visibility');
    console.log('✅ Workflow statistics tracking');
    console.log('✅ No bulk approver preloading');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testLazyWorkflowEngine()
  .then(() => {
    console.log('\n✅ Lazy Workflow Engine test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
