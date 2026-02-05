#!/usr/bin/env node
/**
 * Test script for login endpoint
 * Usage: node test-login.mjs
 */

async function testLogin() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Testing Login Endpoint\n');
  console.log('='.repeat(50));
  
  // Test 1: Login with valid credentials
  console.log('\n✅ Test 1: Valid credentials (admin/admin123)');
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123',
      }),
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Login successful!');
    } else {
      console.log('❌ Login failed:', data.error);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  // Test 2: Login with invalid credentials
  console.log('\n❌ Test 2: Invalid credentials');
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'wrongpassword',
      }),
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.status === 401) {
      console.log('✅ Correctly rejected invalid credentials');
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  // Test 3: Login with missing fields
  console.log('\n❌ Test 3: Missing password field');
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
      }),
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.status === 400) {
      console.log('✅ Correctly rejected missing fields');
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!\n');
}

// Run tests
testLogin().catch(console.error);
