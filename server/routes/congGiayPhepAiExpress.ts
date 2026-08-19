/**
 * ★★★ CỔNG GIẤY PHÉP `MOD_AI` CHO **TUYẾN EXPRESS** — nửa mà `moduleGate` KHÔNG với tới.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/moduleGate.ts` là một **middleware tRPC**: nó nhận `{ ctx, next }` của tRPC và chỉ
 * chạy được trong một chuỗi `procedure.use(...)`. Bề mặt AI của hệ này **KHÔNG** chỉ nằm trên tRPC —
 * có **10 tuyến Express** dưới `/api/ai/**` (SSE sinh chữ · SSE chat · SSE narrative · KB cục bộ)
 * cộng cổng tương thích OpenAI ở `/v1` (mặc định TẮT). Cắm cổng cho 200+ thủ tục tRPC rồi để mười
 * tuyến ấy mở là đúng lớp lỗi **"lỗ thứ chín"** mà bản điều tra dân số phạm vi đọc đã trả giá để
 * học: *cổng chỉ thấy tRPC, còn tuyến Express ngoài tầm phát biểu của nó*.
 *
 * ⇒ Middleware này gọi **ĐÚNG MỘT ĐỘNG CƠ QUYẾT ĐỊNH** với tRPC: `isModuleLicensed("MOD_AI")`
 *   (`server/_core/moduleGate.ts`). **Không** có bản sao thứ hai của luật entitlement ở đây — hai
 *   bản sao lệch nhau thì cái yếu hơn quyết định ai vào được, và không ai biết bản nào đang chạy.
 *
 * ── Hành vi (thừa hưởng NGUYÊN VẸN từ `isModuleLicensed`) ─────────────────────────────────────
 *   cờ `LICENSE_MODULE_GATE_ENABLED=false`  → cho qua
 *   `LICENSE_BYPASS=true`                   → cho qua
 *   module không rõ / là CORE               → cho qua
 *   **SKU chưa từng khai** (không-brick)    → cho qua
 *   phân giải entitlement NÉM (CSDL sập)    → cho qua (fail-safe)
 *   SKU có khai và KHÔNG gồm `MOD_AI`       → **403** + `code: "MODULE_NOT_LICENSED"`
 *
 * ⚠ Bất đối xứng fail-OPEN là **CỐ Ý**, giống hệt `moduleGate`: một trục trặc hạ tầng thoáng qua
 *   không bao giờ được tự khoá một khách đã trả tiền ra khỏi module họ đã mua.
 *
 * ⚠ Thân 403 giữ **đúng hình dạng** mà các tuyến `/api/ai/**` đang trả khi từ chối
 *   (`{ error, code }` — xem `server/routes/_xacThucRest.ts#thanTuChoiRest`), để client không phải
 *   học một hình dạng lỗi thứ hai.
 */
import type { RequestHandler } from "express";

/** Mã máy đọc được, để client phân biệt "chưa mua module" với "chưa đăng nhập". */
export const MA_TU_CHOI_GIAY_PHEP = "MODULE_NOT_LICENSED" as const;

/**
 * Middleware Express chặn một nhánh tuyến sau giấy phép của MỘT module.
 *
 * @param maModule mã SKU (`MOD_AI`, …) — cùng bảng với `shared/module-registry.ts`.
 */
export function chanTuyenTheoGiayPhep(maModule: string): RequestHandler {
  return (_req, res, next) => {
    // Nhập ĐỘNG: file này được nhập ở tầng khởi động Express, và `moduleGate` kéo theo tầng dữ
    // liệu. Giữ nó ngoài đồ thị nhập tĩnh (đúng kỹ thuật mà chính `moduleGate.ts` dùng bên trong).
    void (async () => {
      try {
        const { isModuleLicensed } = await import("../_core/moduleGate");
        if (await isModuleLicensed(maModule)) {
          next();
          return;
        }
        res.status(403).json({
          success: false,
          error: `Module "${maModule}" chưa được cấp phép cho hệ thống này.`,
          code: MA_TU_CHOI_GIAY_PHEP,
          module: maModule,
        });
      } catch (err) {
        // Fail-safe: KHÔNG bao giờ để một lỗi của chính cổng biến thành một lượt từ chối.
        console.warn(
          `[congGiayPhepAiExpress] phân giải giấy phép ${maModule} hỏng — CHO QUA (fail-safe): ${
            (err as Error)?.message ?? err
          }`,
        );
        next();
      }
    })();
  };
}

/**
 * Cổng cho nhánh `/api/ai/**`.
 *
 * ⚠⚠ **KHÔNG dùng cho `/v1`** (cổng tương thích OpenAI). Đã thử và đo được: nó làm ĐỎ 5 ca ở
 *    `openaiGatewayEnforcement.test.ts` vì bề mặt ấy (a) đã có đường cưỡng chế giấy phép RIÊNG,
 *    **cố ý opt-in** qua `AI_GATEWAY_LICENSE_GATE_ENABLED` (doc69 G2-4), và (b) đòi thân lỗi
 *    **tương thích OpenAI** (`error.type = "permission_error"`), khác hình dạng `{success,error,code}`
 *    mà middleware này trả. Lý lẽ đầy đủ nằm ngay tại chỗ gắn: `server/routes/openaiGateway.ts`.
 */
export function chanTuyenAiTheoGiayPhep(): RequestHandler {
  return chanTuyenTheoGiayPhep("MOD_AI");
}
