/**
 * ★★★ Đợt 4B-server (2026-10-17) — ba tuyến REST cho extension VSCode xác thực bằng TOKEN THEO NGƯỜI DÙNG
 * (`Authorization: Bearer avgw_…`, mig 0392/0396) thay cho COOKIE phiên web:
 *
 *   POST /api/ai/client-apply/bat-dau        phạm vi `apply` ⇒ `aiCopilotActions.batDauApDungOClient` (GHI TRƯỚC khi byte rơi)
 *   POST /api/ai/client-apply/chot           phạm vi `apply` ⇒ `aiCopilotActions.chotApDungOClient`   (CHỐT SAU)
 *   POST /api/ai/gateway-token/tu-thu-hoi    mọi token        ⇒ thu hồi CHÍNH token đang trình (idempotent, audit)
 *
 * ⚠⚠ KHÔNG VIẾT LẠI LOGIC SỔ: hai tuyến `client-apply` gọi ĐÚNG hai hàm dịch vụ mà tRPC `aiCopilot.*` gọi, với ĐÚNG lược đồ
 *   (`routers/aiCopilotApOClientSchema.ts`, một chủ cho hai cửa) và người = CHỦ TOKEN (`{id, role, name}` từ lượt tra băm —
 *   không bao giờ từ thân yêu cầu). Ràng buộc "token người A không chốt được lượt của người B" là của CHÍNH
 *   `chotApDungOClient` (`row.userId !== user.id`), cửa này chỉ đưa đúng người vào.
 * ⚠⚠ QUYỀN — thủ tục tRPC cũ đòi: phiên hợp lệ + giấy phép `MOD_AI` (`moduleProcedure`), KHÔNG một bit RBAC nào. Cửa này
 *   đòi NHIỀU hơn, không ít hơn: (1) giấy phép `MOD_AI` — `chanTuyenAiTheoGiayPhep()` gắn trên nhánh `/api/ai` ở
 *   `_core/index.ts`, đứng TRƯỚC lượt đăng ký; (2) token hợp lệ (thu hồi · hết hạn · tài khoản tắt · buộc đổi mật khẩu ⇒
 *   từ chối, cùng bảng mã cổng `/v1` — `gatewayToken/tuChoiToken.ts`); (3) `ai_repo_read/canView` kiểm LẠI mỗi lượt (bit
 *   cấp token — mất quyền sau khi cấp ⇒ token thôi mở cửa, khuôn cổng `/v1`); (4) phạm vi `apply` trên token; (5) trần
 *   lượt/phút THEO TOKEN.
 * ⚠ KEY CHUNG `OPENAI_GATEWAY_API_KEY` KHÔNG được nhận: sổ kiểm toán cần một NGƯỜI, key chung không gắn người.
 * ⚠ TỰ THU HỒI không đòi phạm vi/quyền/hạn (thu hẹp quyền luôn được phép — xem `tuThuHoiTokenTheoBam`); trần theo IP chặn
 *   dùng tuyến này làm máy dò băm (vô vọng với 256 bit, nhưng mỗi lượt là một truy vấn CSDL).
 * ⚠ Thân lỗi = khung OpenAI `{error:{message,type,code}}` như cổng `/v1` — extension đọc bằng cùng bộ diễn dịch
 *   (`vscode-extension/src/loi/luongV1.ts#moTaLoiHttpV1`). Thân thành công của `client-apply/*` = NGUYÊN VĂN thân tRPC cũ.
 * ⚠ Header `Authorization` KHÔNG BAO GIỜ đi vào ngữ cảnh audit (chỉ IP/User-Agent).
 * Census: `xacThucBeMatRest.test.ts` GỌI THẬT registrar này (không Bearer ⇒ 401, không 5xx); `phamViTuyenCensus.test.ts`
 *   đếm ba tuyến vào nhóm D (POST).
 */
import express from "express";
import type { KetQuaXacThucToken, KetQuaTuThuHoi } from "../db/aiGatewayTokens";
import type {
  BatDauApDungOClientInput,
  BatDauApDungOClientResult,
  ChotApDungOClientInput,
  ChotApDungOClientResult,
  CopilotUser,
} from "../services/aiCopilotActions";
import { TIEN_TO_TOKEN } from "../services/ai/gatewayToken/maToken";
import { TU_CHOI_TOKEN, loaiLoiTheoMa } from "../services/ai/gatewayToken/tuChoiToken";
import { batDauApDungOClientSchema, chotApDungOClientSchema } from "../routers/aiCopilotApOClientSchema";

/** Trần lượt ghi sổ mỗi phút MỖI TOKEN (mỗi lượt áp = 2 lượt gọi; một phiên agent bình thường áp vài chục tệp). */
export const TRAN_APPLY_MOI_PHUT_TOKEN = 60;
/** Trần lượt tự thu hồi mỗi phút mỗi IP. */
export const TRAN_TU_THU_HOI_MOI_PHUT_IP = 30;
export const ENTITY_AI_GATEWAY_TOKEN = "ai_gateway_token";

type ReqMeta = { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } };

export interface PhuThuocBearer {
  xacThucToken?: (token: string) => Promise<KetQuaXacThucToken>;
  coQuyenAi?: (userId: number, role: string) => Promise<boolean>;
  ghiDung?: (tokenId: number) => void;
  batDau?: (vao: BatDauApDungOClientInput, u: CopilotUser, req?: ReqMeta) => Promise<BatDauApDungOClientResult>;
  chot?: (vao: ChotApDungOClientInput, u: CopilotUser, req?: ReqMeta) => Promise<ChotApDungOClientResult>;
  tuThuHoi?: (token: string) => Promise<KetQuaTuThuHoi>;
  ghiAudit?: (userId: number, req: ReqMeta, hang: { entityId: number; entityName: string; metadata: Record<string, unknown> }) => Promise<void>;
}

// ─── Mặc định (nạp lười: lượt từ chối sớm — không Bearer — không kéo module CSDL/dịch vụ nào) ──────────────────

const macDinh: Required<PhuThuocBearer> = {
  xacThucToken: async (t) => (await import("../db/aiGatewayTokens")).xacThucTokenNguoiDung(t),
  coQuyenAi: async (userId, role) => {
    try {
      const { checkPermission } = await import("../_core/accessControl");
      return await checkPermission(userId, role, "ai_repo_read", "canView");
    } catch {
      return false;
    }
  },
  ghiDung: (id) => {
    void import("../db/aiGatewayTokens").then((m) => m.ghiDungLanCuoi(id)).catch(() => undefined);
  },
  batDau: async (vao, u, req) => (await import("../services/aiCopilotActions")).batDauApDungOClient(vao, u, req as never),
  chot: async (vao, u, req) => (await import("../services/aiCopilotActions")).chotApDungOClient(vao, u, req as never),
  tuThuHoi: async (t) => (await import("../db/aiGatewayTokens")).tuThuHoiTokenTheoBam(t),
  ghiAudit: async (userId, req, hang) => {
    const { createAuditContext, logCrudOperation } = await import("../services/auditTrailService");
    await logCrudOperation(createAuditContext({ user: { id: userId }, req: req as never }), {
      action: "update",
      entityType: ENTITY_AI_GATEWAY_TOKEN,
      entityId: hang.entityId,
      entityName: hang.entityName,
      details: { operation: "AI_GATEWAY_TOKEN_REVOKED", metadata: hang.metadata },
      status: "success",
    });
  },
};

// ─── Trợ thủ ───────────────────────────────────────────────────────────────────────────────────

function loi(res: express.Response, ma: number, code: string, message: string): void {
  if (res.headersSent) return;
  res.status(ma).setHeader("Cache-Control", "no-store");
  // data-raw-ok: khung lỗi chuẩn OpenAI cho client MÁY (extension) — `code` là hợp đồng, không phải chữ cho người.
  res.json({ error: { message, type: ma === 429 ? "rate_limit_error" : loaiLoiTheoMa(ma), code } });
}

/** `Bearer avgw_…` hay không gì cả (key chung / rác ⇒ null: cửa này chỉ nhận token người dùng). */
function bearerNguoiDung(req: express.Request): string | null {
  const h = req.headers?.authorization;
  const m = typeof h === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(h.trim()) : null;
  return m && m[1].startsWith(TIEN_TO_TOKEN) ? m[1] : null;
}

function ipCua(req: express.Request): string {
  return String(req.ip || req.socket?.remoteAddress || "?");
}

/** Ngữ cảnh audit: IP + User-Agent — KHÔNG `authorization` (bản rõ token), không cookie. */
function reqMetaCua(req: express.Request): ReqMeta {
  const h = req.headers ?? {};
  const headers: Record<string, unknown> = {};
  for (const k of ["user-agent", "x-forwarded-for", "x-real-ip"]) if (h[k] !== undefined) headers[k] = h[k];
  return { ip: req.ip, headers, socket: { remoteAddress: req.socket?.remoteAddress } };
}

async function quaTran(userId: number | undefined, xo: string, tran: number): Promise<number | null> {
  const { checkNamedRateLimit } = await import("../services/aiGateway");
  return checkNamedRateLimit(userId, xo, tran);
}

/**
 * Cửa xác thực của hai tuyến `client-apply`: token ⇒ quyền AI ⇒ phạm vi `apply` ⇒ trần theo token. Trả người dùng, hoặc
 * `null` khi ĐÃ trả lời từ chối (fail-closed: mọi nhánh hỏng dừng tại đây).
 */
async function xacThucApply(req: express.Request, res: express.Response, pt: Required<PhuThuocBearer>): Promise<CopilotUser | null> {
  const token = bearerNguoiDung(req);
  if (!token) {
    loi(res, 401, "invalid_api_key", "Missing personal API token. Provide 'Authorization: Bearer avgw_…'.");
    return null;
  }
  const kq = await pt.xacThucToken(token);
  if (!kq.ok) {
    const [ma, code, msg] = TU_CHOI_TOKEN[kq.ma] ?? TU_CHOI_TOKEN["khong-hop-le"];
    loi(res, ma, code, msg);
    return null;
  }
  if (!(await pt.coQuyenAi(kq.userId, kq.role))) {
    loi(res, 403, "permission_denied", "The token owner no longer has AI access.");
    return null;
  }
  if (!kq.phamVi.includes("apply")) {
    loi(res, 403, "insufficient_scope", "This token lacks the 'apply' scope.");
    return null;
  }
  const choMs = await quaTran(kq.userId, `gw-token-apply:${kq.tokenId}`, TRAN_APPLY_MOI_PHUT_TOKEN);
  if (choMs !== null) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
    loi(res, 429, "rate_limit_exceeded", "Rate limit exceeded for this token.");
    return null;
  }
  pt.ghiDung(kq.tokenId);
  return { id: kq.userId, role: kq.role, name: kq.name ?? null };
}

/** Bọc handler: KHÔNG một ngoại lệ nào thoát ra (census §2 — 5xx thô / rò `err.message`). */
function anToan(fn: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error("[aiGatewayTokenBearer] lỗi không lường trước:", (err as Error)?.message ?? err);
      loi(res, 503, "server_error", "Unexpected server error.");
    });
  };
}

// ─── Đăng ký ───────────────────────────────────────────────────────────────────────────────────

export function registerAiGatewayTokenBearerRoutes(app: express.Express, phuThuoc: PhuThuocBearer = {}): void {
  const pt: Required<PhuThuocBearer> = { ...macDinh, ...phuThuoc };
  const docThan = express.json({ limit: "16kb" });

  app.post(
    "/api/ai/client-apply/bat-dau",
    docThan,
    anToan(async (req, res) => {
      const nguoi = await xacThucApply(req, res, pt);
      if (!nguoi) return;
      const vao = batDauApDungOClientSchema.safeParse(req.body ?? {});
      if (!vao.success) {
        loi(res, 400, "invalid_body", `Invalid body: ${vao.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
        return;
      }
      let kq: BatDauApDungOClientResult;
      try {
        kq = await pt.batDau(vao.data, nguoi, reqMetaCua(req));
      } catch {
        // `batDauApDungOClient` chỉ ném khi CSDL không mở được — extension PHẢI dừng, không ghi byte.
        loi(res, 503, "db_unavailable", "Audit ledger unavailable — do NOT write the file.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ actionId: kq.actionId, token: kq.token });
    }),
  );

  app.post(
    "/api/ai/client-apply/chot",
    docThan,
    anToan(async (req, res) => {
      const nguoi = await xacThucApply(req, res, pt);
      if (!nguoi) return;
      const vao = chotApDungOClientSchema.safeParse(req.body ?? {});
      if (!vao.success) {
        loi(res, 400, "invalid_body", `Invalid body: ${vao.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
        return;
      }
      const kq = await pt.chot(vao.data, nguoi, reqMetaCua(req));
      res.setHeader("Cache-Control", "no-store");
      if (!kq.ok && kq.message === "DB_UNAVAILABLE") {
        res.status(503).json(kq);
        return;
      }
      // ok:false (không tồn tại · token/người không khớp · trạng thái sai) ⇒ 409 + NGUYÊN thân dịch vụ.
      res.status(kq.ok ? 200 : 409).json(kq);
    }),
  );

  app.post(
    "/api/ai/gateway-token/tu-thu-hoi",
    anToan(async (req, res) => {
      const token = bearerNguoiDung(req);
      if (!token) {
        loi(res, 401, "invalid_api_key", "Missing personal API token. Provide 'Authorization: Bearer avgw_…'.");
        return;
      }
      const choMs = await quaTran(undefined, `gw-tu-thu-hoi:${ipCua(req)}`, TRAN_TU_THU_HOI_MOI_PHUT_IP);
      if (choMs !== null) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
        loi(res, 429, "rate_limit_exceeded", "Too many revocation requests from this address.");
        return;
      }
      const kq = await pt.tuThuHoi(token);
      if (!kq.ok) {
        const [ma, code, msg] = TU_CHOI_TOKEN[kq.ma];
        loi(res, ma, code, msg);
        return;
      }
      if (!kq.daThuHoiTruoc) {
        try {
          await pt.ghiAudit(kq.userId, reqMetaCua(req), {
            entityId: kq.tokenId,
            entityName: kq.tienTo,
            metadata: { nguon: "tu-thu-hoi", ip: ipCua(req) },
          });
        } catch {
          /* logCrudOperation tự nuốt lỗi; khối này chỉ chặn lỗi nạp module — thu hồi ĐÃ xảy ra */
        }
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ revoked: true, already_revoked: kq.daThuHoiTruoc, token_prefix: kq.tienTo });
    }),
  );
}
