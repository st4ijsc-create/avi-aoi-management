/**
 * MÁY CHỦ GIẢ cho KIỂM THƯỚC (không gọi model, không gọi :3000/:3010/:8091): một cổng HTTP cục bộ ngẫu nhiên phục vụ
 *   · `POST /v1/chat/completions` — stream SSE đúng khung OpenAI mà `taoGoiModelV1` đọc (chữ, `tool_calls` cắt đôi
 *     `arguments` để thử phép ghép, `finish_reason`, `usage`, `[DONE]`); câu trả lời do một KỊCH BẢN quyết định;
 *   · `POST /api/ai/client-apply/bat-dau|chot` — sổ kiểm toán giả, cùng hợp đồng REST Bearer của máy chủ 4B
 *     (`server/routes/aiGatewayTokenBearerApi.ts`): băm 64 hex, `{actionId, token}`, `chot` lệch ⇒ 409 + thân dịch vụ.
 *   · `GET /v1/models` — để harness dò token như ở lượt thật.
 * Token sai ⇒ 401 khung `{error:{…}}` — đường đăng nhập của extension được thử thật, không được bỏ qua.
 */
import http from "node:http";
import crypto from "node:crypto";

const HEX64 = /^[0-9a-f]{64}$/i;

export async function batMayChuGia({ token }) {
  let kichBan = () => ({ chu: "Không có kịch bản." });
  const so = new Map();
  const nhatKy = { v1: 0, batDau: 0, chot: 0, tuChoi: 0 };

  const docThan = (req) =>
    new Promise((res) => {
      const c = [];
      req.on("data", (d) => c.push(d));
      req.on("end", () => res(Buffer.concat(c).toString("utf8")));
    });
  const json = (res, ma, obj) => {
    res.writeHead(ma, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  const mc = http.createServer(async (req, res) => {
    const than = await docThan(req);
    const xacThuc = req.headers.authorization === `Bearer ${token}`;
    const u = new URL(req.url, "http://x");
    if (!xacThuc && u.pathname !== "/") {
      nhatKy.tuChoi++;
      return json(res, 401, { error: { message: "invalid token", type: "invalid_request_error", code: "invalid_api_key" } });
    }
    if (u.pathname === "/" ) return json(res, 200, { ok: true });
    if (u.pathname === "/v1/models") return json(res, 200, { object: "list", data: [{ id: "chat", object: "model" }] });

    if (u.pathname === "/v1/chat/completions" && req.method === "POST") {
      nhatKy.v1++;
      let body;
      try { body = JSON.parse(than); } catch { return json(res, 400, { error: { message: "bad json", code: "invalid_body" } }); }
      let tl;
      try { tl = await kichBan(body); } catch (e) { tl = { chu: `Kịch bản hỏng: ${e?.message ?? e}` }; }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const id = `chatcmpl-gia-${crypto.randomUUID()}`;
      const gui = (o) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", ...o })}\n\n`);
      gui({ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] });
      if (tl.chu) {
        const g = Math.ceil(tl.chu.length / 2);
        gui({ choices: [{ index: 0, delta: { content: tl.chu.slice(0, g) } }] });
        gui({ choices: [{ index: 0, delta: { content: tl.chu.slice(g) } }] });
      }
      const tcs = tl.toolCalls ?? [];
      tcs.forEach((t, i) => {
        const a = JSON.stringify(t.thamSo ?? {});
        const g = Math.ceil(a.length / 2);
        gui({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${i}_${crypto.randomUUID().slice(0, 8)}`, type: "function", function: { name: t.ten, arguments: a.slice(0, g) } }] } }] });
        gui({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: a.slice(g) } }] } }] });
      });
      gui({ choices: [{ index: 0, delta: {}, finish_reason: tcs.length ? "tool_calls" : "stop" }] });
      gui({ choices: [], usage: { prompt_tokens: Math.round(than.length / 4), completion_tokens: 50 + 20 * tcs.length } });
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    if (u.pathname === "/api/ai/client-apply/bat-dau" && req.method === "POST") {
      nhatKy.batDau++;
      let b;
      try { b = JSON.parse(than); } catch { return json(res, 400, { error: { code: "invalid_body", message: "json" } }); }
      if (typeof b.path !== "string" || !HEX64.test(b.sha256Truoc ?? "") || !HEX64.test(b.sha256Sau ?? "")) {
        return json(res, 400, { error: { code: "invalid_body", message: "path/sha256" } });
      }
      const actionId = crypto.randomUUID();
      const tk = crypto.randomBytes(16).toString("hex");
      so.set(actionId, { token: tk, trangThai: "dang_ap_client", path: b.path });
      return json(res, 200, { actionId, token: tk });
    }
    if (u.pathname === "/api/ai/client-apply/chot" && req.method === "POST") {
      nhatKy.chot++;
      let b;
      try { b = JSON.parse(than); } catch { return json(res, 400, { error: { code: "invalid_body", message: "json" } }); }
      const h = so.get(b.actionId);
      if (!h || h.token !== b.token || h.trangThai !== "dang_ap_client") {
        return json(res, 409, { ok: false, status: h?.trangThai ?? "khong_co", message: "không chốt được" });
      }
      h.trangThai = b.thanhCong ? "da_ap_client" : "ap_client_that_bai";
      return json(res, 200, { ok: true, status: h.trangThai });
    }
    return json(res, 404, { error: { code: "not_found", message: u.pathname } });
  });

  await new Promise((r) => mc.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${mc.address().port}`,
    datKichBan(f) { kichBan = f; },
    nhatKy,
    so,
    dong: () => new Promise((r) => mc.close(r)),
  };
}
