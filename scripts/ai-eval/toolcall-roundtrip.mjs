#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G2-B — NGHIỆM THU SỐNG: **MỘT VÒNG ĐỜI TOOL-CALL TRỌN VẸN QUA `/v1`**.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Bốn chặng, chạy trên APP ĐANG CHẠY THẬT (không mock, không stub):
 *   (1) client gửi `tools` + câu hỏi → model TỰ QUYẾT ĐỊNH và trả `tool_calls`;
 *   (2) CLIENT (chính script này) thực thi tool — đây là hợp đồng của một bề mặt OpenAI: gateway
 *       KHÔNG thực thi gì cả (xem khối "BẤT BIẾN AN NINH" ở đầu `openaiGateway.ts`);
 *   (3) client gửi lại `role:"tool"` + `tool_call_id`;
 *   (4) model kết luận bằng lời, dùng ĐÚNG con số của bước (2).
 *
 * ⚠ VÌ SAO CHẶNG (4) PHẢI KIỂM NỘI DUNG, KHÔNG CHỈ "HTTP 200": một vòng đứt ở chặng (3) — vai
 * `tool` bị bóp về `user`, `tool_call_id` bị đánh rơi — VẪN trả 200 và VẪN sinh ra một câu trả lời
 * trôi chảy, chỉ là model bịa số. Điều kiện đạt vì thế là **con số ta vừa bơm vào phải xuất hiện
 * lại trong câu kết luận**.
 *
 * CHẠY:  node scripts/ai-eval/toolcall-roundtrip.mjs
 * ENV :  OPENAI_GATEWAY_URL (mặc định http://127.0.0.1:3000/v1) · OPENAI_GATEWAY_API_KEY
 */
import "dotenv/config";

const BASE = (process.env.OPENAI_GATEWAY_URL || "http://127.0.0.1:3000/v1").replace(/\/$/, "");
const KEY = process.env.OPENAI_GATEWAY_API_KEY || "";
const H = { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) };

/** Giá trị "chỉ dấu" — một con số KHÔNG THỂ đoán được, để chặng (4) không thể qua bằng cách bịa. */
const OEE_MOC = 0.8731;
const MAY = "AOI-01";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_machine_oee",
      description: "Lấy chỉ số OEE hiện tại của một máy theo mã máy.",
      parameters: {
        type: "object",
        properties: { machineId: { type: "string", description: "Mã máy, ví dụ AOI-01" } },
        required: ["machineId"],
        additionalProperties: false,
      },
    },
  },
];

/** Bước (2) — CLIENT thực thi. Đây là toàn bộ "quyền lực" của tool trong mô hình BYOT. */
function thucThi(name, argsJson) {
  if (name !== "get_machine_oee") throw new Error(`tool lạ: ${name}`);
  const a = JSON.parse(argsJson || "{}");
  return JSON.stringify({ machineId: a.machineId, oee: OEE_MOC, availability: 0.95, performance: 0.94, quality: 0.978 });
}

async function post(body) {
  const res = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {
    /* giữ nguyên txt để in ra */
  }
  return { status: res.status, json, txt };
}

const ok = (c, msg) => console.log(`  ${c ? "✓" : "✗"} ${msg}`) || c;
let hong = 0;
const canh = (c, msg) => {
  if (!ok(c, msg)) hong++;
};

async function main() {
  console.log(`[roundtrip] ${BASE}  (bearer ${KEY ? "CÓ" : "KHÔNG"})`);

  // ── (1) model tự quyết định gọi tool ──────────────────────────────────────
  console.log("\n[1] client gửi tools → model quyết định");
  const b1 = {
    model: "chat",
    messages: [
      { role: "system", content: "Bạn là trợ lý vận hành. Cần dữ liệu máy thì gọi tool." },
      { role: "user", content: `OEE hiện tại của máy ${MAY} là bao nhiêu?` },
    ],
    tools: TOOLS,
    tool_choice: "auto",
    max_tokens: 256,
    temperature: 0.1,
  };
  const r1 = await post(b1);
  if (r1.status !== 200) {
    console.error(`  ✗ HTTP ${r1.status}: ${r1.txt.slice(0, 400)}`);
    process.exit(1);
  }
  const msg1 = r1.json?.choices?.[0]?.message;
  const tcs = msg1?.tool_calls ?? [];
  canh(tcs.length === 1, `model trả ĐÚNG 1 tool_call (nhận ${tcs.length})`);
  canh(r1.json?.choices?.[0]?.finish_reason === "tool_calls", `finish_reason="tool_calls" (nhận "${r1.json?.choices?.[0]?.finish_reason}")`);
  if (!tcs.length) {
    console.error("  ✗ không có tool_call ⇒ vòng đời KHÔNG đi tiếp được.");
    process.exit(1);
  }
  const tc = tcs[0];
  canh(typeof tc.id === "string" && tc.id.length > 0, `tool_call có id ("${tc.id}")`);
  canh(tc.function?.name === "get_machine_oee", `tên tool đúng ("${tc.function?.name}")`);
  canh(typeof tc.function?.arguments === "string", "arguments là CHUỖI (hợp đồng OpenAI)");
  let args1 = {};
  try {
    args1 = JSON.parse(tc.function.arguments);
  } catch {
    canh(false, "arguments parse được thành JSON");
  }
  canh(args1.machineId === MAY, `model tự trích machineId="${args1.machineId}" (mong "${MAY}")`);
  canh(!("__authCtx" in args1), "args KHÔNG chứa __authCtx do model bịa");

  // ── (2) CLIENT thực thi ───────────────────────────────────────────────────
  console.log("\n[2] CLIENT thực thi tool (gateway không đụng vào)");
  const ketQua = thucThi(tc.function.name, tc.function.arguments);
  console.log(`  → ${ketQua}`);

  // ── (3)+(4) gửi lại role:"tool" → model kết luận ──────────────────────────
  console.log('\n[3] gửi lại role:"tool" + tool_call_id → [4] model kết luận');
  const r2 = await post({
    ...b1,
    messages: [
      ...b1.messages,
      { role: "assistant", content: msg1.content ?? "", tool_calls: tcs },
      { role: "tool", tool_call_id: tc.id, content: ketQua },
    ],
    max_tokens: 200,
  });
  if (r2.status !== 200) {
    console.error(`  ✗ HTTP ${r2.status}: ${r2.txt.slice(0, 400)}`);
    process.exit(1);
  }
  const cau = r2.json?.choices?.[0]?.message?.content ?? "";
  console.log(`  → "${cau.slice(0, 200)}"`);
  canh(cau.length > 0, "model trả về CHỮ (không rỗng)");
  canh(!r2.json?.choices?.[0]?.message?.tool_calls, "lượt kết luận KHÔNG gọi lại tool");
  // ⚠ Điều kiện THẬT: con số chỉ dấu phải quay lại. "87.31" / "87,31" / "0.8731" đều chấp nhận.
  const daDung = /87[.,]3/.test(cau) || /0[.,]8731/.test(cau) || /8731/.test(cau);
  canh(daDung, `câu kết luận dùng ĐÚNG số ta vừa bơm (${OEE_MOC} → "87,31%")`);

  // ── STREAM: cùng vòng, đường SSE ──────────────────────────────────────────
  console.log("\n[5] cùng câu hỏi, đường STREAM → delta.tool_calls");
  const resS = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ ...b1, stream: true }),
  });
  const raw = await resS.text();
  const evs = raw
    .split("\n\n")
    .map((b) => b.replace(/^data: /, "").trim())
    .filter((s) => s && s !== "[DONE]")
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const dToolCalls = evs.filter((e) => e.choices?.[0]?.delta?.tool_calls);
  canh(resS.status === 200, `SSE HTTP 200 (nhận ${resS.status})`);
  canh(dToolCalls.length > 0, `có ${dToolCalls.length} sự kiện mang delta.tool_calls`);
  const cuoi = evs[evs.length - 1];
  canh(cuoi?.choices?.[0]?.finish_reason === "tool_calls", `sự kiện cuối finish_reason="tool_calls" (nhận "${cuoi?.choices?.[0]?.finish_reason}")`);
  // Gộp lại xem args có ghép thành JSON hợp lệ không — đây là thứ client thật phải làm.
  const gop = dToolCalls.map((e) => e.choices[0].delta.tool_calls[0]?.function?.arguments ?? "").join("");
  let gopOk = false;
  try {
    gopOk = JSON.parse(gop).machineId === MAY;
  } catch {
    /* để false */
  }
  canh(gopOk, `ghép các mảnh arguments lại ⇒ JSON hợp lệ với machineId đúng ("${gop.slice(0, 60)}")`);
  // Không được rò khuôn nội bộ ra ô chữ.
  const chuStream = evs.map((e) => e.choices?.[0]?.delta?.content ?? "").join("");
  canh(!chuStream.includes("tool_call"), "ô `content` của luồng KHÔNG chứa chuỗi `<tool_call>`");

  console.log(`\n[roundtrip] ${hong === 0 ? "✓ TẤT CẢ ĐẠT — vòng đời đi TRỌN qua /v1" : `✗ ${hong} khẳng định TRƯỢT`}`);
  process.exit(hong === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[roundtrip] ✗ hỏng:", e?.stack ?? e);
  process.exit(1);
});
