import process from "node:process";
const BASE = process.argv[2] || "http://localhost:3000";
const Q = process.argv[3] || "Streaming SSE endpoint nào dùng cho AI local KB và fallback ra sao?";

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const sc = loginRes.headers.getSetCookie?.() || [loginRes.headers.get("set-cookie")].filter(Boolean);
const cookie = sc.map(c => c.split(";")[0]).join("; ");
console.log("LOGIN", loginRes.status, "cookie len=", cookie.length);

const t0 = Date.now();
const res = await fetch(`${BASE}/api/ai/local-kb/ask`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ question: Q, topK: 5 }),
});
const ms = Date.now() - t0;
const body = await res.json().catch(() => ({}));
console.log("ASK status=", res.status, "ms=", ms);
const d = body.data || {};
console.log("intent=", d.intent, "lang=", d.language);
console.log("citations=", d.citations?.length);
console.log("=== ANSWER ===");
console.log(d.answer || d.text || JSON.stringify(body).slice(0, 500));
