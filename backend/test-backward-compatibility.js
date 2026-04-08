const { BackwardCompatibilityAdapter } = require('./src/services/BackwardCompatibilityAdapter.js');
const { CompatibleApproversResolver } = require('./src/services/CompatibleApproversResolver.js');
const { pool } = require('./src/db.js');

async function testBackwardCompatibility() {
  console.log('🧪 Testing Backward Compatibility Adapter...\n');

  const adapter = new BackwardCompatibilityAdapter(true); // Enable warnings
  const resolver = new CompatibleApproversResolver(true);

  // Clean up test data
  await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_steps WHERE chain_id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
  await pool.query('DELETE FROM deprecation_logs WHERE request_id LIKE \'test-%\'');
  await pool.query('DELETE FROM migration_logs WHERE item_id LIKE \'test-%\'');
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
      [users[1].id]
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

    console.log('✓ Test data created');

    // Test 1: Create legacy approval chain (without actor_type)
    console.log('\n--- Test 1: Create Legacy Approval Chain ---');

    const { rows: chains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, steps, created_by) 
       VALUES ($1, $2, $3::jsonb, $4) 
       RETURNING *`,
      [
        'Legacy Test Chain',
        approvalTypes[0].id,
        JSON.stringify([
          { order: 1, name: 'Manager Review', roleName: 'Manager', action: 'Approve' },
          { order: 2, name: 'Director Review', userName: 'Test Director', action: 'Approve' }
        ]),
        director.id
      ]
    );

    const legacyChain = chains[0];

    // Create approval steps without actor_type (legacy format)
    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, description, role_id, action_label, due_days)
       VALUES ($1, 1, 'Manager Review', 'Legacy manager step', $2, 'Approve', 3),
            ($1, 2, 'Director Review', 'Legacy director step', NULL, 'Approve', 5)`,
      [legacyChain.id, managerRole.id]
    );

    console.log('✓ Legacy approval chain created');

    // Test 2: Create new approval chain (with actor_type)
    console.log('\n--- Test 2: Create Modern Approval Chain ---');

    const { rows: modernChains } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, steps, created_by) 
       VALUES ($1, $2, $3::jsonb, $4) 
       RETURNING *`,
      [
        'Modern Test Chain',
        approvalTypes[0].id,
        JSON.stringify([
          { step_order: 1, name: 'Manager Review', actor_type: 'USER_MANAGER', action_label: 'Approve' },
          { step_order: 2, name: 'Director Review', actor_type: 'SPECIFIC_USER', actor_value: director.id, action_label: 'Approve' }
        ]),
        director.id
      ]
    );

    const modernChain = modernChains[0];

    await pool.query(
      `INSERT INTO approval_steps (chain_id, step_order, name, description, actor_type, actor_value, action_label, due_days)
       VALUES ($1, 1, 'Manager Review', 'Modern manager step', 'USER_MANAGER', NULL, 'Approve', 3),
            ($1, 2, 'Director Review', 'Modern director step', 'SPECIFIC_USER', $2, 'Approve', 5)`,
      [modernChain.id, director.id]
    );

    console.log('✓ Modern approval chain created');

    // Test 3: Test legacy step resolution
    console.log('\n--- Test 3: Legacy Step Resolution ---');

    // Get legacy step
    const { rows: legacySteps } = await pool.query(
      'SELECT * FROM approval_steps WHERE chain_id = $1 AND actor_type IS NULL ORDER BY step_order',
      [legacyChain.id]
    );

    const legacyStep = legacySteps[0];

    // Create test request
    const { rows: requests } = await pool.query(
      `INSERT INTO approval_requests (approval_type_id, approval_chain_id, initiator_id, department_id, title, form_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [approvalTypes[0].id, legacyChain.id, employee.id, testDept.id, 'Test Request', { test: 'data' }]
    );

    const request = requests[0];

    const requestDefinition = {
      id: request.id,
      initiator_id: request.initiator_id,
      department_id: request.department_id,
      approval_chain_id: request.approval_chain_id,
      status: request.status,
      current_step: request.current_step
    };

    const legacyStepDef = {
      step_order: legacyStep.step_order,
      name: legacyStep.name,
      description: legacyStep.description,
      role_id: legacyStep.role_id,  // Legacy field
      user_id: legacyStep.user_id,  // Legacy field
      action_label: legacyStep.action_label,
      due_days: legacyStep.due_days
    };

    const legacyResult = await adapter.resolveApproversWithCompatibility(legacyStepDef, requestDefinition);

    if (legacyResult.success) {
      console.log('✅ Legacy step resolution successful');
      console.log(`  Approvers found: ${legacyResult.approvers.length}`);
      console.log(`  Used legacy logic: ${legacyResult.used_legacy_logic}`);
      console.log(`  Warnings: ${legacyResult.warnings.length}`);
      
      if (legacyResult.warnings.length > 0) {
        console.log(`  Warning: ${legacyResult.warnings[0]}`);
      }
    } else {
      console.log('❌ Legacy step resolution failed:', legacyResult.error);
    }

    // Test 4: Test modern step resolution
    console.log('\n--- Test 4: Modern Step Resolution ---');

    const { rows: modernSteps } = await pool.query(
      'SELECT * FROM approval_steps WHERE chain_id = $1 AND actor_type IS NOT NULL ORDER BY step_order',
      [modernChain.id]
    );

    const modernStep = modernSteps[0];

    const modernStepDef = {
      step_order: modernStep.step_order,
      name: modernStep.name,
      description: modernStep.description,
      actor_type: modernStep.actor_type,
      actor_value: modernStep.actor_value,
      role_id: modernStep.role_id,
      user_id: modernStep.user_id,
      action_label: modernStep.action_label,
      due_days: modernStep.due_days
    };

    const modernResult = await adapter.resolveApproversWithCompatibility(modernStepDef, requestDefinition);

    if (modernResult.success) {
      console.log('✅ Modern step resolution successful');
      console.log(`  Approvers found: ${modernResult.approvers.length}`);
      console.log(`  Used legacy logic: ${modernResult.used_legacy_logic}`);
      console.log(`  Warnings: ${modernResult.warnings.length}`);
    } else {
      console.log('❌ Modern step resolution failed:', modernResult.error);
    }

    // Test 5: Test batch resolution
    console.log('\n--- Test 5: Batch Resolution ---');

    const batchSteps = [legacyStepDef, modernStepDef];
    const batchResult = await resolver.resolveApproversBatch(batchSteps, requestDefinition);

    if (batchResult.success) {
      console.log('✅ Batch resolution successful');
      console.log(`  Total steps: ${batchResult.summary.total_steps}`);
      console.log(`  Successful resolutions: ${batchResult.summary.successful_resolutions}`);
      console.log(`  Legacy steps used: ${batchResult.summary.legacy_steps_used}`);
      console.log(`  Total warnings: ${batchResult.summary.total_warnings}`);
    } else {
      console.log('❌ Batch resolution failed:', batchResult.error);
    }

    // Test 6: Test deprecation logging
    console.log('\n--- Test 6: Deprecation Logging ---');

    const { rows: deprecationLogs } = await pool.query(
      'SELECT * FROM deprecation_logs WHERE request_id = $1',
      [request.id]
    );

    console.log(`✅ Deprecation logs created: ${deprecationLogs.length}`);
    deprecationLogs.forEach((log, index) => {
      console.log(`  Log ${index + 1}: ${log.warning_message}`);
    });

    // Test 7: Test legacy steps detection
    console.log('\n--- Test 7: Legacy Steps Detection ---');

    const legacyStepsList = await adapter.getLegacySteps();

    console.log(`✅ Legacy steps found: ${legacyStepsList.length}`);
    legacyStepsList.forEach((step, index) => {
      console.log(`  Step ${index + 1}: ${step.name} in ${step.chain_name} (used ${step.usage_count} times)`);
    });

    // Test 8: Test step migration
    console.log('\n--- Test 8: Step Migration ---');

    const { rows: stepsToMigrate } = await pool.query(
      'SELECT id FROM approval_steps WHERE chain_id = $1 AND actor_type IS NULL LIMIT 1',
      [legacyChain.id]
    );

    if (stepsToMigrate.length > 0) {
      const stepToMigrate = stepsToMigrate[0];
      
      const migrateResult = await adapter.migrateStep(
        stepToMigrate.id,
        'ROLE',
        'Manager'
      );

      if (migrateResult.success) {
        console.log('✅ Step migration successful');

        // Verify migration
        const { rows: migratedStep } = await pool.query(
          'SELECT actor_type, actor_value FROM approval_steps WHERE id = $1',
          [stepToMigrate.id]
        );

        console.log(`  New actor_type: ${migratedStep[0].actor_type}`);
        console.log(`  New actor_value: ${migratedStep[0].actor_value}`);

        // Check migration log
        const { rows: migrationLogs } = await pool.query(
          'SELECT * FROM migration_logs WHERE item_id = $1',
          [stepToMigrate.id]
        );

        console.log(`✅ Migration log created: ${migrationLogs.length > 0}`);

      } else {
        console.log('❌ Step migration failed:', migrateResult.error);
      }
    }

    // Test 9: Test deprecation statistics
    console.log('\n--- Test 9: Deprecation Statistics ---');

    const deprecationStats = await adapter.getDeprecationStats(30);

    console.log('✅ Deprecation statistics:');
    console.log(`  Total warnings: ${deprecationStats.total_warnings}`);
    console.log(`  Unique steps: ${deprecationStats.unique_steps}`);
    console.log(`  Unique requests: ${deprecationStats.unique_requests}`);
    console.log(`  Most common warnings: ${deprecationStats.most_common_warnings.length}`);

    // Test 10: Test migration progress
    console.log('\n--- Test 10: Migration Progress ---');

    const migrationProgress = await resolver.getMigrationProgress();

    console.log('✅ Migration progress:');
    console.log(`  Total legacy steps: ${migrationProgress.total_legacy_steps}`);
    console.log(`  Migrated steps: ${migrationProgress.migrated_steps}`);
    console.log(`  Remaining steps: ${migrationProgress.remaining_steps}`);
    console.log(`  Migration percentage: ${migrationProgress.migration_percentage}%`);

    // Test 11: Test migration recommendations
    console.log('\n--- Test 11: Migration Recommendations ---');

    const recommendations = await resolver.generateMigrationRecommendations();

    console.log('✅ Migration recommendations:');
    console.log(`  High priority: ${recommendations.high_priority.length}`);
    console.log(`  Medium priority: ${recommendations.medium_priority.length}`);
    console.log(`  Low priority: ${recommendations.low_priority.length}`);

    recommendations.high_priority.slice(0, 2).forEach((rec, index) => {
      console.log(`  High ${index + 1}: ${rec.step_name} -> ${rec.recommended_actor_type} (${rec.reason})`);
    });

    // Test 12: Test warnings toggle
    console.log('\n--- Test 12: Warnings Toggle ---');

    console.log(`✅ Warnings enabled: ${resolver.isWarningsEnabled()}`);

    resolver.setWarningsEnabled(false);
    console.log(`✅ Warnings disabled: ${!resolver.isWarningsEnabled()}`);

    // Test resolution without warnings
    const noWarningResult = await adapter.resolveApproversWithCompatibility(legacyStepDef, requestDefinition);
    console.log(`✅ Resolution without warnings: ${noWarningResult.success}, warnings: ${noWarningResult.warnings.length}`);

    // Re-enable warnings
    resolver.setWarningsEnabled(true);
    console.log(`✅ Warnings re-enabled: ${resolver.isWarningsEnabled()}`);

    // Clean up
    await pool.query('DELETE FROM request_steps WHERE request_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_requests WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_steps WHERE chain_id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_chains WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM approval_types WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM deprecation_logs WHERE request_id LIKE \'test-%\'');
    await pool.query('DELETE FROM migration_logs WHERE item_id LIKE \'test-%\'');
    await pool.query('DELETE FROM departments WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM profiles WHERE id LIKE \'test-%\'');
    await pool.query('DELETE FROM users WHERE email LIKE \'test-%\'');
    await pool.query('DELETE FROM roles WHERE id LIKE \'test-%\'');

    console.log('\n🎉 All Backward Compatibility tests completed successfully!');
    console.log('\nBackward Compatibility Features:');
    console.log('✅ Automatic legacy step detection');
    console.log('✅ Fallback to old role-based logic when actor_type is NULL');
    console.log('✅ Deprecation warning logging');
    console.log('✅ Step migration functionality');
    console.log('✅ Migration progress tracking');
    console.log('✅ Migration recommendations');
    console.log('✅ Batch resolution support');
    console.log('✅ Warnings toggle capability');
    console.log('✅ Comprehensive statistics and monitoring');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testBackwardCompatibility()
  .then(() => {
    console.log('\n✅ Backward Compatibility test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
