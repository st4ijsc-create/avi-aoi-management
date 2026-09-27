/**
 * Doc 80 · Đợt 1 · Task 8 (AI-07, phụ lục A §8 D1) — `POST /api/ai/programming-copilot/stream`.
 *
 * Copilot lập trình qua SSE: `stage` (gate/retrieve/generate/validate/repair) · `token` · `result` ·
 * `error{code,userMessage}`. Gắn trong `registerAiStreamingRoutes` (nhánh `/api/ai` ⇒ ĐỨNG SAU cổng
 * giấy phép `chanTuyenAiTheoGiayPhep` như mọi tuyến AI Express khác).
 *
 * ── Thứ tự cửa (mỗi cửa từ chối ⇒ KHÔNG một lượt model nào) ─────────────────────────────────────
 *   1. danh tính phiên — `thuXacThucRest` (cùng chủ với `/api/ai/local-kb/stream`, 401/403/500 đúng lớp);
 *   1b. giấy phép `MOD_ENGINEERING` — `isModuleLicensed`, ĐÚNG module + đúng động cơ của
 *      `moduleProcedure("MOD_ENGINEERING")` mà `copilotGenerate` đi qua (fix round 1 #1). `MOD_AI` vẫn do
 *      middleware nhánh `/api/ai` chặn TRƯỚC ⇒ tuyến này đòi CẢ HAI;
 *   2. RBAC — `checkPermission(…, "machine_monitoring", "canView")`: ĐÚNG động cơ + đúng cặp mà
 *      `requirePermission` của `copilotGenerate` dùng;
 *   3. lược đồ — `copilotGenerateInput` (chung với `copilotGenerate`);
 *   4. cổng an toàn — chạy BÊN TRONG `generateProgram`, TRƯỚC mọi lượt model (sự kiện `error`
 *      `SAFETY_REFUSED`).
 *
 * ── Huỷ ───────────────────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ `res.on("close")` + `!res.writableFinished`, KHÔNG `req.on("close")`. ĐO trong phiên này trên
 *    Node 24.18 (express thật, thân JSON): `req` phát `close` **1 ms** sau khi handler chạy — tức ngay
 *    khi thân yêu cầu đã đọc xong, KHÔNG phải khi client ngắt. Gắn lắng nghe `req.on("close")` sau một
 *    `await` (xác thực) ⇒ sự kiện đã qua ⇒ KHÔNG BAO GIỜ huỷ; gắn trước `await` ⇒ huỷ NGAY lượt vừa
 *    bắt đầu. `res` phát `close` đúng lúc socket đóng; `writableFinished` phân biệt "ta đã `end()`"
 *    với "client bỏ đi" (đo: client abort ⇒ `res close` 515 ms, `writableFinished:false`).
 *    `AbortController` đi xuống `generateProgram` → `chatCompletionStream` → `fetch` tới llama-server.
 *
 * ── Vì sao DANH SÁCH TRẮNG `switch (evt.type)` ─────────────────────────────────────────────────
 * Cùng lý lẽ với `/api/ai/local-kb/stream`: chuyển tiếp đúng các ô của hợp đồng, không `default:`
 * đẩy nguyên object nội bộ ra trình duyệt. Giá phải trả: thêm `case` khi union mọc kiểu mới —
 * `programmingCopilotStream.sseCensus.test.ts` bắt ta trả giá đó.
 */
import type { Request, Response } from "express";
import { thuXacThucRest, thanTuChoiRest } from "./_xacThucRest";

export const DUONG_COPILOT_STREAM = "/api/ai/programming-copilot/stream";
/** Module giấy phép của bề mặt lập trình — PHẢI trùng `moduleProcedure(...)` của `programmingRouter` (census canh). */
export const MODULE_COPILOT = "MOD_ENGINEERING";

export async function xuLyCopilotStream(req: Request, res: Response): Promise<void> {
  const xacThuc = await thuXacThucRest(req);
  if (!xacThuc.ok) {
    res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
    return;
  }
  const user = xacThuc.user;
  const role = String(user.role ?? "");

  // Fix round 1 #1 — CÙNG quyết định giấy phép với `copilotGenerate`: `programmingRouter` dùng
  // `protectedProcedure = moduleProcedure("MOD_ENGINEERING")` (auth → moduleGate → RBAC). Nhánh
  // `/api/ai` đã chặn `MOD_AI` ở `_core/index.ts`; thiếu dòng này thì một SKU có AI mà KHÔNG có
  // Engineering dùng được copilot qua SSE trong khi thủ tục tRPC từ chối. `isModuleLicensed` là ĐÚNG
  // động cơ của `moduleGate` (cờ tắt / bypass / SKU chưa khai / lỗi phân giải ⇒ cho qua, như tRPC).
  const { isModuleLicensed } = await import("../_core/moduleGate");
  if (!(await isModuleLicensed(MODULE_COPILOT))) {
    res.status(403).json({
      success: false,
      error: `Module "${MODULE_COPILOT}" chưa được cấp phép cho hệ thống này.`,
      code: "MODULE_NOT_LICENSED",
      module: MODULE_COPILOT,
    });
    return;
  }

  let duocPhep = false;
  try {
    const { checkPermission } = await import("../_core/accessControl");
    duocPhep = await checkPermission(user.id, role, "machine_monitoring", "canView");
  } catch {
    duocPhep = false; // fail-closed: không phân giải được quyền ⇒ không chạy model
  }
  if (!duocPhep) {
    res.status(403).json({ success: false, error: "Forbidden", code: "PERMISSION_DENIED" });
    return;
  }

  const svc = await import("../services/programming/copilotStream");
  const parsed = svc.copilotGenerateInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid copilot request", code: "INVALID_VALUE" });
    return;
  }
  const input = parsed.data;

  const boHuy = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) boHuy.abort();
  });
  // Fix round 1 #3 — `close` có thể đã phát TRONG các `await` phía trên (xác thực · giấy phép ·
  // quyền · nạp module) ⇒ lắng nghe gắn muộn sẽ không bao giờ chạy. Socket đã chết ⇒ huỷ ngay.
  if (res.destroyed || req.socket?.destroyed) boHuy.abort();

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") res.flushHeaders();

  const send = (payload: Record<string, unknown>) => {
    if (!boHuy.signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const batDau = Date.now();
  let ketCuc = "cancelled";
  try {
    for await (const evt of svc.streamCopilot(input, { callerRole: role, signal: boHuy.signal })) {
      if (boHuy.signal.aborted) break;
      switch (evt.type) {
        case "stage":
          send({
            type: "stage",
            stage: evt.stage,
            ...(evt.attempt ? { attempt: evt.attempt } : {}),
            elapsedMs: evt.elapsedMs,
          });
          break;
        case "token":
          send({ type: "token", token: evt.token });
          break;
        case "result":
          ketCuc = "result";
          send({ type: "result", result: evt.result });
          break;
        case "error":
          ketCuc = evt.code;
          send({
            type: "error",
            code: evt.code,
            userMessage: evt.userMessage,
            ...(evt.reasonCode ? { reasonCode: evt.reasonCode } : {}),
            ...(evt.devDetail ? { devDetail: evt.devDetail } : {}),
            ...(evt.citations ? { citations: evt.citations } : {}),
          });
          break;
      }
    }
  } catch (e) {
    ketCuc = "INTERNAL";
    console.error("[programmingCopilotStream] luồng hỏng:", (e as Error)?.message ?? e);
    const { cauLoiCopilot } = await import("../services/programming/aiProgrammingCopilot");
    const { detectRequestLang } = await import("../services/programming/copilotSafetyGate");
    send({ type: "error", code: "INTERNAL", userMessage: cauLoiCopilot("INTERNAL", detectRequestLang(input.request)) });
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
    ghiAudit(req, user, input, ketCuc, Date.now() - batDau);
  }
}

/**
 * Nhật ký kiểm toán — tương đương `auditMutationMiddleware` mà `copilotGenerate` (mutation) đi qua.
 * Fire-and-forget: kiểm toán không bao giờ chặn/làm hỏng lượt gọi. Không ghi giá trị đầu vào.
 */
function ghiAudit(
  req: Request,
  user: { id: number; username?: string | null; name?: string | null },
  input: { kind: string; mode?: string },
  ketCuc: string,
  duration: number,
): void {
  if (process.env.AUDIT_ALL_MUTATIONS === "false") return;
  const ok = ketCuc === "result" || ketCuc === "cancelled" || ketCuc === "SAFETY_REFUSED";
  void import("../services/auditTrailService")
    .then(({ logCrudOperation }) =>
      logCrudOperation(
        {
          userId: user.id ?? null,
          userName: user.username ?? user.name ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers?.["user-agent"] as string | undefined) ?? null,
          source: "api",
        },
        {
          action: "programming.copilotStream",
          entityType: "rest_stream",
          details: {
            operation: "stream",
            duration,
            metadata: { path: DUONG_COPILOT_STREAM, kind: input.kind, mode: input.mode ?? "generate", outcome: ketCuc },
          },
          status: ok ? "success" : "failure",
        },
      ),
    )
    .catch(() => {
      /* auditing must never affect the request */
    });
}
