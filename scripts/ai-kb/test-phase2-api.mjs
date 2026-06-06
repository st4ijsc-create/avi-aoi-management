#!/usr/bin/env node

/**
 * Phase 2 Local KB API Smoke Tests
 * Tests health, retrieve, and ask endpoints
 */

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

async function makeRequest(endpoint, method = "GET", body = null) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (AUTH_TOKEN) {
    headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, options);
  const data = await res.json();

  return {
    status: res.status,
    ok: res.ok,
    data,
  };
}

async function testHealth() {
  console.log("\n=== Test 1: GET /api/ai/local-kb/health ===");
  const res = await makeRequest("/api/ai/local-kb/health");
  console.log("Status:", res.status);
  console.log("Response:", JSON.stringify(res.data, null, 2));
  if (res.data.success) {
    console.log("✓ Health check passed");
    console.log(`  Chunks: ${res.data.chunks}, Embeddings: ${res.data.embeddings}`);
    return true;
  } else {
    console.log("✗ Health check failed");
    return false;
  }
}

async function testRetrieve() {
  console.log("\n=== Test 2: POST /api/ai/local-kb/retrieve ===");
  const res = await makeRequest("/api/ai/local-kb/retrieve", "POST", {
    question: "API external inspection o dau?",
    topK: 3,
  });
  console.log("Status:", res.status);
  if (res.data.success) {
    const data = res.data.data;
    console.log("✓ Retrieval successful");
    console.log(`  Intent: ${data.intent}`);
    console.log(`  Language: ${data.language}`);
    console.log(`  Confidence: ${data.confidence}`);
    console.log(`  Citations found: ${data.citations.length}`);
    if (data.citations[0]) {
      console.log(`  Top result: ${data.citations[0].sourcePath} (score: ${data.citations[0].score})`);
    }
    return true;
  } else {
    console.log("✗ Retrieval failed:", res.data.error);
    return false;
  }
}

async function testAsk() {
  console.log("\n=== Test 3: POST /api/ai/local-kb/ask ===");
  console.log("(This may take time if Ollama is generating)");
  
  const res = await makeRequest("/api/ai/local-kb/ask", "POST", {
    question: "Lam sao de kiem tra lich su external inspection?",
    topK: 5,
  });
  console.log("Status:", res.status);
  if (res.data.success) {
    const data = res.data.data;
    console.log("✓ Ask successful");
    console.log(`  Provider: ${data.provider}`);
    console.log(`  Cached: ${data.cached}`);
    console.log(`  Answer (first 300 chars):\n  ${data.answer.slice(0, 300)}...`);
    console.log(`  Citations: ${data.citations.length}`);
    return true;
  } else {
    console.log("✗ Ask failed:", res.data.error);
    return false;
  }
}

async function main() {
  console.log("🚀 Phase 2 Local KB API Smoke Tests");
  console.log(`Base URL: ${BASE_URL}`);
  
  try {
    const results = [];
    
    results.push(await testHealth());
    results.push(await testRetrieve());
    results.push(await testAsk());
    
    console.log("\n=== Summary ===");
    const passed = results.filter(Boolean).length;
    const total = results.length;
    console.log(`Passed: ${passed}/${total}`);
    
    if (passed === total) {
      console.log("✓ All tests passed!");
      process.exit(0);
    } else {
      console.log("✗ Some tests failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("Test error:", error);
    process.exit(1);
  }
}

main();
