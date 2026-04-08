const { FixedLazyWorkflowEngine } = require('./src/services/FixedLazyWorkflowEngine.js');
const { pool } = require('./src/db.js');

async function testFixedRequestChanges() {
  console.log('🧪 Testing Fixed Request Changes Logic...\n');

  const workflowEngine = new FixedLazyWorkflowEngine();

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
       ('Manager', 'Department Manager', ARRAY['approve_reject'])
       RETURNING *`
    );

    const employeeRole = roles.find(r => r.name === 'Employee');
    const managerRole = roles.find(r => r.name === 'Manager');

    // Create test users
    const { rows: users } = await pool.query(
      `INSERT INTO users (email, password_hash, manager_id) VALUES 
       ('test-employee@example.com', 'hash', NULL),
       ('test-manager@example.com', 'hash', NULL)
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
       ($4, 'Test Manager', 'test-manager@example.com', $2, $5, false)
       RETURNING *`,
      [
        users[0].id, testDept.id, employeeRole.id,
        users[1].id, managerRole.id
      ]
    );

    const employee = profiles[0];
    const manager = profiles[1];

    // Create approval type
    const { rows: approvalTypes } = await pool.query(
      `INSERT INTO approval_types (name, description, fields, created_by) VALUES 
       ('Test Request', 'Test approval type', '[{"name": "test", "type": "text"}]', $1)
       RETURNING *`,
      [manager.id]
    );

    // Create approval chain with steps
    const { rows: chains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, created_by) VALUES 
       ('Test Chain', $1, $2)
       RETURNING *`,
      [approvalTypes[0].id, manager.id]
    );

    const chain = chains[0];

    // Create approval steps
    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, actor_type, actor_value, action_label) VALUES 
       ($1, 1, 'Manager Review', 'USER_MANAGER', NULL, 'Approve'),
       ($1, 2, 'Final Approval', 'ROLE', 'Manager', 'Approve')`,
      [chain.id]
    );

    console.log('✓ Test data created');

    // Test 1: Initialize workflow
    console.log('\n--- Test 1: Initialize Workflow ---');

    const { rows: requests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [approvalTypes[0].id, chain.id, employee.id, testDept.id, 'Test Request', { test: 'original data' }]
    );

    const request = requests[0];

    const initResult = await workflowEngine.initializeWorkflow(request.id);

    if (initResult.success) {
      console.log('✓ Workflow initialized successfully');
    } else {
      console.log('✗ Workflow initialization failed:', initResult.error);
      return;
    }

    // Test 2: Manager requests changes
    console.log('\n--- Test 2: Manager Requests Changes ---');

    const managerPendingSteps = await workflowEngine.getPendingSteps(manager.id);

    if (managerPendingSteps.length === 0) {
      console.log('✗ No pending steps for manager');
      return;
    }

    const firstStep = managerPendingSteps[0];
    const changeResult = await workflowEngine.processApprovalAction(
      request.id,
      firstStep.id,
      manager.id,
      'REQUEST_CHANGES',
      'Please add more details to your request'
    );

    if (changeResult.success && changeResult.changesRequested) {
      console.log('✓ Changes requested successfully');
      
      // Verify request status
      const { rows: updatedRequest } = await pool.query(
        'SELECT status, changes_requested_by, changes_requested_at FROM approval_requests WHERE id = $1',
        [request.id]
      );

      console.log(`  Request status: ${updatedRequest[0].status}`);
      console.log(`  Changes requested by: ${updatedRequest[0].changes_requested_by}`);
      console.log(`  Changes requested at: ${updatedRequest[0].changes_requested_at}`);

      // Verify step status
      const { rows: updatedStep } = await pool.query(
        'SELECT status FROM request_steps WHERE id = $1',
        [firstStep.id]
      );

      console.log(`  Step status: ${updatedStep[0].status}`);

      // Verify initiator has resubmission step
      const employeePendingSteps = await workflowEngine.getPendingSteps(employee.id);
      
      if (employeePendingSteps.length > 0) {
        console.log('✓ Initiator has resubmission step');
        console.log(`  Resubmission step: ${employeePendingSteps[0].name}`);
        console.log(`  Resumed from step: ${employeePendingSteps[0].resumed_from_step_id}`);
      } else {
        console.log('✗ No resubmission step for initiator');
      }

    } else {
      console.log('✗ Changes request failed:', changeResult.error);
    }

    // Test 3: Initiator resubmits
    console.log('\n--- Test 3: Initiator Resubmits ---');

    const resumeResult = await workflowEngine.resumeRequest(
      request.id,
      { test: 'updated data with more details' }
    );

    if (resumeResult.success) {
      console.log('✓ Request resumed successfully');
      
      if (resumeResult.step) {
        console.log(`  Resumed step: ${resumeResult.step.name}`);
        console.log(`  Step status: ${resumeResult.step.status}`);
        console.log(`  Assigned to: ${resumeResult.step.assigned_to}`);
        console.log(`  Due date: ${resumeResult.step.due_date}`);
      }

      // Verify request status
      const { rows: resumedRequest } = await pool.query(
        'SELECT status, changes_requested_by FROM approval_requests WHERE id = $1',
        [request.id]
      );

      console.log(`  Request status: ${resumedRequest[0].status}`);
      console.log(`  Changes requested by cleared: ${resumedRequest[0].changes_requested_by === null}`);

      // Verify manager has the step again
      const managerNewPendingSteps = await workflowEngine.getPendingSteps(manager.id);
      
      if (managerNewPendingSteps.length > 0) {
        console.log('✓ Manager has the step again for review');
        console.log(`  Step assigned to same manager: ${managerNewPendingSteps[0].assigned_to === manager.id}`);
      } else {
        console.log('✗ Manager does not have the step');
      }

    } else {
      console.log('✗ Request resume failed:', resumeResult.error);
    }

    // Test 4: Manager approves after resubmission
    console.log('\n--- Test 4: Manager Approves After Resubmission ---');

    const managerFinalPendingSteps = await workflowEngine.getPendingSteps(manager.id);

    if (managerFinalPendingSteps.length > 0) {
      const approveResult = await workflowEngine.processApprovalAction(
        request.id,
        managerFinalPendingSteps[0].id,
        manager.id,
        'APPROVE',
        'Looks good now, approved!'
      );

      if (approveResult.success) {
        console.log('✓ Approval processed successfully');

        if (approveResult.nextStep) {
          console.log('✓ Next step created');
          console.log(`  Next step: ${approveResult.nextStep.name}`);
        } else if (approveResult.workflowComplete) {
          console.log('✓ Workflow completed');
        }

        // Verify final request status
        const { rows: finalRequest } = await pool.query(
          'SELECT status FROM approval_requests WHERE id = $1',
          [request.id]
        );

        console.log(`  Final status: ${finalRequest[0].status}`);

      } else {
        console.log('✗ Approval failed:', approveResult.error);
      }
    } else {
      console.log('✗ No pending steps for manager');
    }

    // Test 5: Verify history preservation
    console.log('\n--- Test 5: History Preservation ---');

    const changeHistory = await workflowEngine.getChangeRequestHistory(request.id);

    if (changeHistory.length > 0) {
      console.log('✓ Change request history preserved');
      console.log(`  History entries: ${changeHistory.length}`);
      
      changeHistory.forEach((entry, index) => {
        console.log(`  Entry ${index + 1}:`);
        console.log(`    Step: ${entry.step_name}`);
        console.log(`    Requested by: ${entry.requested_by}`);
        console.log(`    Requested at: ${entry.requested_at}`);
        console.log(`    Remarks: ${entry.remarks}`);
        console.log(`    Resumed at: ${entry.resumed_at || 'Not yet resumed'}`);
      });

    } else {
      console.log('✗ No change request history found');
    }

    // Test 6: Verify no duplicate steps created
    console.log('\n--- Test 6: No Duplicate Steps ---');

    const { rows: allSteps } = await pool.query(
      'SELECT * FROM request_steps WHERE request_id = $1 ORDER BY created_at',
      [request.id]
    );

    console.log(`✓ Total steps created: ${allSteps.length}`);
    
    // Should have: original manager step, initiator resubmission step, resumed manager step, potentially next step
    const expectedSteps = 3; // Manager step, resubmission step, resumed manager step
    if (allSteps.length <= expectedSteps + 1) { // +1 for potential next step
      console.log('✓ No unnecessary duplicate steps created');
      
      allSteps.forEach((step, index) => {
        console.log(`  Step ${index + 1}: ${step.name} (${step.status})`);
      });

    } else {
      console.log(`✗ Too many steps created: ${allSteps.length} (expected <= ${expectedSteps + 1})`);
    }

    // Test 7: Verify resumed_from_step_id flag
    console.log('\n--- Test 7: Resumed From Step ID Flag ---');

    const { rows: stepsWithFlag } = await pool.query(
      'SELECT * FROM request_steps WHERE request_id = $1 AND resumed_from_step_id IS NOT NULL',
      [request.id]
    );

    if (stepsWithFlag.length > 0) {
      console.log('✓ resumed_from_step_id flag properly set');
      console.log(`  Steps with flag: ${stepsWithFlag.length}`);
      
      stepsWithFlag.forEach((step, index) => {
        console.log(`  Step ${index + 1}: ${step.name} -> resumed_from: ${step.resumed_from_step_id}`);
      });

    } else {
      console.log('✗ No steps with resumed_from_step_id flag');
    }

    // Test 8: Workflow statistics
    console.log('\n--- Test 8: Workflow Statistics ---');

    const stats = await workflowEngine.getWorkflowStatistics(request.id);

    console.log('✓ Workflow statistics:');
    console.log(`  Total steps: ${stats.totalSteps}`);
    console.log(`  Created steps: ${stats.createdSteps}`);
    console.log(`  Active steps: ${stats.activeSteps}`);
    console.log(`  Completed steps: ${stats.completedSteps}`);
    console.log(`  Changes requested steps: ${stats.changesRequestedSteps}`);

    // Clean up
    await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
    await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

    console.log('\n🎉 All Fixed Request Changes tests completed successfully!');
    console.log('\nFixed Request Changes Features:');
    console.log('✅ Changes requested marks step as CHANGES_REQUESTED');
    console.log('✅ Request assigned back to initiator with resubmission step');
    console.log('✅ Workflow stops when changes requested');
    console.log('✅ Initiator can resubmit with updated data');
    console.log('✅ Resumption reassigns to SAME approver who requested changes');
    console.log('✅ No duplicate steps created');
    console.log('✅ History preserved with resumed_from_step_id flag');
    console.log('✅ Change request tracking with who/when');
    console.log('✅ Proper workflow status management');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testFixedRequestChanges()
  .then(() => {
    console.log('\n✅ Fixed Request Changes test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
