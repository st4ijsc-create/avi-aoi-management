/**
 * ★★★ Đợt 4A (2026-10-17) — "DEVICE FLOW" tối giản cho extension VSCode lấy token cổng `/v1` mà KHÔNG dán tay
 * (khuôn RFC 8628, rút gọn):
 *
 *   1. extension  POST /api/ai/gateway-token/thiet-bi      {ten?, phamVi?}
 *                 ⇒ {device_code (bí mật), user_code "XXXX-XXXX", verification_path, expires_in: 600, interval: 5}
 *   2. người dùng mở `<máy chủ>/ai-thiet-bi?ma=XXXX-XXXX` — trang web, phiên ĐÃ đăng nhập (đã qua 2FA nếu bật) — đối
 *      chiếu mã + tên thiết bị + phạm vi rồi bấm Cho phép / Từ chối (tRPC `aiGatewayToken.quyetThietBi`, có audit);
 *   3. extension  POST /api/ai/gateway-token/thiet-bi/doi  {device_code}  mỗi `interval` giây
 *                 ⇒ 400 {error: authorization_pending | slow_down | access_denied | expired_token | invalid_grant}
 *                 ⇒ 200 {access_token: "avgw_…", token_type: "Bearer", scope, expires_at}  (ĐÚNG MỘT LẦN)
 *
 * ⚠⚠ VÌ SAO HAI TUYẾN NÀY KHÔNG ĐÒI PHIÊN: chính chúng là đường ĐẾN danh tính — extension chưa có gì để trình. Thứ
 *   thay thế xác thực: (a) bước duyệt là một PHIÊN WEB thật có quyền `ai_repo_read`; (b) `device_code` là 32 byte ngẫu
 *   nhiên, chỉ băm nằm trong CSDL; (c) mã sống 10 phút, đổi được MỘT lần (giao dịch + FOR UPDATE); (d) trần theo IP
 *   cho cả xin lẫn đổi, chu kỳ hỏi tối thiểu (`slow_down`), trần lượt hỏi mỗi mã; (e) phía duyệt có trần lượt thử mã.
 * ⚠ KHÔNG trả URL tuyệt đối: dựng từ `Host` là mở cửa cho chèn Host (lừa người dùng mở máy chủ giả). Extension đã
 *   biết địa chỉ máy chủ nó đang gọi ⇒ ghép `verification_path` vào đó.
 * ★★★ Rà bảo mật de591c868 #3 — LỪA ĐẢO MÃ THIẾT BỊ (RFC 8628 §5.4): kẻ tấn công tự khởi tạo luồng (tuyến này không
 *   đòi danh tính), gửi mã/đường dẫn cho nạn nhân bấm duyệt ⇒ kẻ tấn công (đang giữ `device_code`) nhận token của nạn
 *   nhân. Giảm thiểu, mỗi lớp một chỗ:
 *   • `verification_path_complete` KHÔNG mang mã nữa (ô giữ cho hợp đồng, = `verification_path`) và trang duyệt KHÔNG
 *     điền sẵn mã từ URL — người dùng phải GÕ mã đang hiện trong VSCode của CHÍNH họ;
 *   • trang duyệt hiện NGUỒN GỐC (IP + User-Agent + lúc khởi tạo — mig 0394), cảnh báo khi IP khởi tạo ≠ IP trình duyệt,
 *     và Cho phép đòi xác nhận tường minh — cưỡng chế ở máy chủ (`thuTucQuyetThietBi`, note `CAN_XAC_NHAN`);
 *   • token đúc từ thiết bị: phạm vi trần chat+fim (`embed` bị cắt), hạn 30 ngày (`SO_NGAY_THIET_BI`);
 *   • trần mã đang CHỜ mỗi IP (`TRAN_MA_CHO_MOI_IP`) ngoài trần theo phút;
 *   • audit: duyệt/từ chối mang IP/UA khởi tạo + IP người duyệt; lượt đổi mang id mã + IP khởi tạo + IP đổi.
 *   QUYẾT ĐỊNH — KHÔNG ràng buộc IP đổi mã = IP khởi tạo: kẻ lừa đảo vừa khởi tạo vừa hỏi từ CÙNG máy của hắn ⇒ ràng
 *   buộc ấy không chặn được lớp tấn công này; nó chỉ chống trộm `device_code` (256 bit, chỉ extension giữ, chỉ băm nằm
 *   trong CSDL) — đổi lại rủi ro gãy ca thật (máy dual-stack đổi ::1/127.0.0.1, NAT/VPN đổi đường giữa hai lượt).
 * ⚠ Cổng giấy phép MOD_AI: `chanTuyenAiTheoGiayPhep()` gắn trên nhánh `/api/ai` ở `_core/index.ts`, đứng TRƯỚC lượt đăng ký.
 * ⚠ Thân lỗi theo RFC 8628 (`{error, error_description}`) — extension là client máy, không phải người đọc.
 */
import express from "express";
import { batDauThietBi, doiMaThietBi } from "../db/aiGatewayTokens";

export const TRAN_XIN_MA_MOI_PHUT_IP = 10;
export const TRAN_DOI_MA_MOI_PHUT_IP = 60;
const DUONG_XAC_NHAN = "/ai-thiet-bi";

function ipCua(req: express.Request): string {
  return String(req.ip || req.socket?.remoteAddress || "?");
}

async function quaTran(ip: string, xo: string, tran: number): Promise<number | null> {
  const { checkNamedRateLimit } = await import("../services/aiGateway");
  return checkNamedRateLimit(undefined, `${xo}:${ip}`, tran);
}

function loi(res: express.Response, ma: number, error: string, moTa: string): void {
  res.status(ma).setHeader("Cache-Control", "no-store");
  // data-raw-ok: thân lỗi chuẩn RFC 8628 cho client MÁY (extension) — mã `error` là hợp đồng, không phải chữ cho người.
  res.json({ error, error_description: moTa });
}

const MA_LOI_DOI: Record<string, [number, string, string]> = {
  cho: [400, "authorization_pending", "Waiting for the user to approve the code."],
  "cham-lai": [400, "slow_down", "Polling too fast; respect `interval`."],
  "tu-choi": [400, "access_denied", "The user denied the request."],
  "het-han": [400, "expired_token", "The device code expired. Start again."],
  "khong-hop-le": [400, "invalid_grant", "Unknown or already used device code."],
  "qua-tran": [409, "token_limit_reached", "The user has too many active tokens. Revoke some first."],
  csdl: [503, "temporarily_unavailable", "Token backend unavailable."],
};

export function registerAiGatewayTokenThietBiRoutes(app: express.Express): void {
  const docThan = express.json({ limit: "4kb" });

  app.post("/api/ai/gateway-token/thiet-bi", docThan, async (req, res) => {
    const choMs = await quaTran(ipCua(req), "gw-tb-xin", TRAN_XIN_MA_MOI_PHUT_IP);
    if (choMs !== null) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
      loi(res, 429, "slow_down", "Too many device code requests from this address.");
      return;
    }
    const than = (req.body ?? {}) as { ten?: unknown; phamVi?: unknown };
    const kq = await batDauThietBi({ ten: than.ten, phamVi: than.phamVi, ip: ipCua(req), tacNhan: req.get("user-agent") });
    if (!kq.ok) {
      if (kq.ma === "qua-tran-cho") {
        res.setHeader("Retry-After", "60");
        loi(res, 429, "slow_down", "Too many pending device codes from this address. Finish or let them expire first.");
        return;
      }
      loi(res, 503, "temporarily_unavailable", "Token backend unavailable.");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      device_code: kq.maThietBi,
      user_code: kq.maNguoiDung,
      verification_path: DUONG_XAC_NHAN,
      // ★ #3 — KHÔNG mang mã (xem docblock): người dùng gõ mã đang hiện trong VSCode của chính họ.
      verification_path_complete: DUONG_XAC_NHAN,
      expires_in: kq.hetHanGiay,
      interval: kq.chuKyGiay,
    });
  });

  app.post("/api/ai/gateway-token/thiet-bi/doi", docThan, async (req, res) => {
    const choMs = await quaTran(ipCua(req), "gw-tb-doi", TRAN_DOI_MA_MOI_PHUT_IP);
    if (choMs !== null) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
      loi(res, 429, "slow_down", "Too many polling requests from this address.");
      return;
    }
    const kq = await doiMaThietBi((req.body as { device_code?: unknown } | undefined)?.device_code);
    if (kq.trangThai !== "xong") {
      const [ma, error, moTa] = MA_LOI_DOI[kq.trangThai] ?? MA_LOI_DOI["khong-hop-le"];
      loi(res, ma, error, moTa);
      return;
    }
    // Audit: token do thiết bị đổi ra, gán cho NGƯỜI DUYỆT. Không bao giờ chứa bản rõ.
    try {
      const { createAuditContext, logCrudOperation } = await import("../services/auditTrailService");
      await logCrudOperation(createAuditContext({ user: { id: kq.userId }, req: req as never }), {
        action: "create",
        entityType: "ai_gateway_token",
        entityId: kq.tokenId,
        entityName: kq.tienTo,
        details: {
          operation: "AI_GATEWAY_TOKEN_CREATED",
          metadata: {
            ten: kq.ten,
            phamVi: kq.phamVi,
            hetHanLuc: kq.hetHanLuc,
            nguon: "thiet-bi",
            maThietBiId: kq.maThietBiId,
            ipKhoiTao: kq.ipKhoiTao,
            ipDoi: ipCua(req),
          },
        },
        status: "success",
      });
    } catch {
      /* logCrudOperation tự nuốt lỗi; khối này chỉ chặn lỗi nạp module */
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      access_token: kq.token,
      token_type: "Bearer",
      scope: kq.phamVi.join(" "),
      expires_at: kq.hetHanLuc,
      token_prefix: kq.tienTo,
    });
  });
}
