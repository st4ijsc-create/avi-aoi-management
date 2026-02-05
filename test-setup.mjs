#!/usr/bin/env node
/**
 * Test script for setup admin functionality
 * Usage: node test-setup.mjs
 */

async function testSetup() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Testing Setup Admin Functionality\n');
  console.log('='.repeat(50));
  
  // Test 1: Check if setup is required
  console.log('\n✅ Test 1: Check if setup is required');
  try {
    const response = await fetch(`${baseUrl}/trpc/auth.checkSetupRequired`);
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.result?.data?.required !== undefined) {
      if (data.result.data.required) {
        console.log('✅ Setup is required - no admin exists');
      } else {
        console.log('ℹ️  Setup not required - admin already exists');
      }
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  // Test 2: Try to create admin (this will fail if admin already exists)
  console.log('\n✅ Test 2: Create admin user');
  try {
    const response = await fetch(`${baseUrl}/trpc/auth.setupAdmin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        email: 'admin@example.com',
        name: 'Administrator',
        password: 'admin123456',
      }),
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.result?.data?.success) {
      console.log('✅ Admin created successfully!');
    } else if (response.status === 403) {
      console.log('ℹ️  Admin already exists (this is expected if already set up)');
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  // Test 3: Check setup status again
  console.log('\n✅ Test 3: Verify setup status after creation');
  try {
    const response = await fetch(`${baseUrl}/trpc/auth.checkSetupRequired`);
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.result?.data?.required === false) {
      console.log('✅ Setup completed - admin exists');
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!\n');
  console.log('📝 Summary:');
  console.log('   - Setup check endpoint: /trpc/auth.checkSetupRequired');
  console.log('   - Setup admin endpoint: /trpc/auth.setupAdmin');
  console.log('   - Setup page: http://localhost:3000/setup');
  console.log('   - Login page: http://localhost:3000/login');
  console.log('\n💡 If no admin exists, visiting / or /login will redirect to /setup\n');
}

// Run tests
testSetup().catch(console.error);
