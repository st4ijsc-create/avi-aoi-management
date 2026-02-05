/**
 * Simple test for tRPC login endpoint
 */

async function testTRPCLogin() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🧪 Testing tRPC Login Endpoint\n');
  console.log('='.repeat(50));
  
  // Test: Login with valid credentials via tRPC
  console.log('\n✅ Test: Valid credentials (admin/admin123) via tRPC');
  try {
    const response = await fetch(`${baseUrl}/trpc/auth.login`, {
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
    
    if (response.ok && data.result?.data?.success) {
      console.log('✅ Login successful via tRPC!');
    } else {
      console.log('Response data:', data);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Test completed!\n');
}

// Run tests
testTRPCLogin().catch(console.error);
