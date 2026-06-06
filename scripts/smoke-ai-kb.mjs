// Smoke-test AI Local KB: 5 questions hitting tools + KB.
// Usage: node scripts/smoke-ai-kb.mjs [baseUrl]
import process from "node:process";

const BASE = process.argv[2] || "http://localhost:3002";

const QUESTIONS = [
  { label: "get_today_stats", q: "Hôm nay sản lượng thế nào?" },
  { label: "get_lot_status", q: "Trạng thái lô L20260505-001?" },
  { label: "get_machine_status", q: "Máy nào đang offline?" },
  { label: "get_defect_trend", q: "Xu hướng lỗi 7 ngày qua" },
  { label: "get_top_defects", q: "Top 5 lỗi nhiều nhất tuần này" },
];

async function main() {
  // 1) login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok || !loginBody?.success) {
    console.error("LOGIN FAILED", loginRes.status, loginBody);
    process.exit(1);
  }
  const setCookie = loginRes.headers.getSetCookie?.() || [
    loginRes.headers.get("set-cookie"),
  ].filter(Boolean);
  const cookie = setCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    console.error("No session cookie returned from login");
    process.exit(1);
  }
  console.log("LOGIN OK, cookie=", cookie.slice(0, 80));

  // 2) run each question
  for (const item of QUESTIONS) {
    console.log("\n" + "=".repeat(72));
    console.log(`[${item.label}] Q: ${item.q}`);
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/ai/local-kb/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ question: item.q, topK: 5 }),
    });
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    console.log(`  status=${res.status} time=${ms}ms`);
    if (!res.ok || !body?.success) {
      console.error("  ERR:", JSON.stringify(body).slice(0, 400));
      continue;
    }
    const d = body.data || {};
    const answer = d.answer || d.text || "";
    console.log("  intent      :", d.intent ?? "?");
    console.log("  language    :", d.language ?? "?");
    console.log("  confidence  :", d.confidence?.toFixed?.(3) ?? d.confidence);
    const toolName =
      d.toolName ?? d.toolResult?.tool ?? d.toolResult?.type ?? d.tool ?? "(none)";
    console.log("  toolUsed    :", toolName);
    if (d.toolResult) {
      const success =
        d.toolResult.success ??
        (d.toolResult.note ? false : d.toolResult.data != null);
      console.log("  toolSuccess :", success);
      console.log(
        "  toolSummary :",
        (d.toolResult.textSummary || d.toolResult.summary || "").slice(0, 200),
      );
    }
    if (Array.isArray(d.citations)) {
      console.log("  citations   :", d.citations.length);
      for (const [i, c] of d.citations.slice(0, 5).entries()) {
        console.log(
          `    [${i + 1}] score=${c.score?.toFixed?.(3) ?? c.score} src=${c.sourceType}/${c.sourcePath}`,
        );
      }
    }
    console.log("  ANSWER (first 600 chars):");
    console.log(
      "    " + String(answer).slice(0, 600).replace(/\n/g, "\n    "),
    );
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
