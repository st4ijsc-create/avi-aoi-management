/**
 * ★★★ Đợt 4B-server (2026-10-17) — các tuyến REST cho extension VSCode xác thực bằng TOKEN THEO NGƯỜI DÙNG
 * (`Authorization: Bearer avgw_…`, mig 0392/0396) thay cho COOKIE phiên web:
 *
 *   POST /api/ai/client-apply/bat-dau        phạm vi `apply` ⇒ `aiCopilotActions.batDauApDungOClient` (GHI TRƯỚC khi byte rơi)
 *   POST /api/ai/client-apply/chot           phạm vi `apply` ⇒ `aiCopilotActions.chotApDungOClient`   (CHỐT SAU)
 *   POST /api/ai/gateway-token/tu-thu-hoi    mọi token        ⇒ thu hồi CHÍNH token đang trình (idempotent, audit)
 *   POST /api/ai/client-feedback             phạm vi `chat`   ⇒ `thuTucPhanHoiClient` (Đợt 5.1 VSCode — 👍/👎 + lý do cho câu
 *                                            trả lời cuối của lượt agent CHẠY CỤC BỘ trong extension)
 *
 * ★ Đợt 5.1 VSCode — VÌ SAO `chat` (không `apply`): người đang chat với agent thì được chấm câu trả lời; phiếu không ghi
 *   byte nào, không mở sổ áp tệp. Lượt cục bộ KHÔNG có hàng `ai_agent_runs` ⇒ thân MANG văn bản (câu hỏi + câu trả lời);
 *   thủ tục che bí mật + cắt trần, tầng dữ liệu đặt `nguon = 'vscode'` (mức tin riêng, mig 0398). Khoá phiếu = (CHỦ
 *   token, `luotId` client, `chiSoKhoi`) ⇒ gửi lại = sửa cùng hàng. Thân lớn (≤ 1 MB, câu trả lời ≤ 100k ký tự) ⇒ header
 *   Bearer được soi TRƯỚC khi đọc thân (lượt không trình gì không bắt máy chủ parse 1 MB). Trần riêng
 *   `TRAN_PHAN_HOI_MOI_PHUT_TOKEN` (không ăn chung xô với `apply`).
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
import { z } from "zod";
import { TRAN_KY_TU_CAU_HOI_CLIENT, TRAN_KY_TU_TRA_LOI_CLIENT, TRAN_KY_TU_LY_DO } from "@shared/phanHoiAgent";
import type { DauVaoPhanHoiClient } from "../services/ai/phanHoi/thuTucPhanHoi";
import type { TomTatPhanHoi } from "../db/aiAgentFeedback";

/** Trần lượt ghi sổ mỗi phút MỖI TOKEN (mỗi lượt áp = 2 lượt gọi; một phiên agent bình thường áp vài chục tệp). */
export const TRAN_APPLY_MOI_PHUT_TOKEN = 60;
/** Trần phiếu phản hồi mỗi phút MỖI TOKEN (người bấm 👍/👎 + sửa lý do vài lần mỗi lượt; 30 là dư). */
export const TRAN_PHAN_HOI_MOI_PHUT_TOKEN = 30;
/** Trần thân `client-feedback` (câu hỏi 20k + câu trả lời 100k ký tự UTF-8 ≈ ≤ 0,5 MB, dư cho thoát JSON). */
export const TRAN_THAN_PHAN_HOI = "1mb";
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
  phanHoiClient?: (
    u: CopilotUser,
    vao: DauVaoPhanHoiClient,
  ) => Promise<{ ok: true; note: null; phieu: TomTatPhanHoi | null } | { ok: false; note: "PERMISSION_DENIED" | "DB_LOI"; phieu: null }>;
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
  phanHoiClient: async (u, vao) => (await import("../services/ai/phanHoi/thuTucPhanHoi")).thuTucPhanHoiClient(u, vao),
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
 * Cửa xác thực của các tuyến có phạm vi: token ⇒ quyền AI ⇒ phạm vi (`apply` | `chat`) ⇒ trần theo token. Trả người dùng,
 * hoặc `null` khi ĐÃ trả lời từ chối (fail-closed: mọi nhánh hỏng dừng tại đây).
 */
async function xacThucPhamVi(
  req: express.Request,
  res: express.Response,
  pt: Required<PhuThuocBearer>,
  cua: { phamVi: "apply" | "chat"; xo: string; tran: number },
): Promise<CopilotUser | null> {
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
  if (!kq.phamVi.includes(cua.phamVi)) {
    loi(res, 403, "insufficient_scope", `This token lacks the '${cua.phamVi}' scope.`);
    return null;
  }
  const choMs = await quaTran(kq.userId, `${cua.xo}:${kq.tokenId}`, cua.tran);
  if (choMs !== null) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(choMs / 1000))));
    loi(res, 429, "rate_limit_exceeded", "Rate limit exceeded for this token.");
    return null;
  }
  pt.ghiDung(kq.tokenId);
  return { id: kq.userId, role: kq.role, name: kq.name ?? null };
}

const CUA_APPLY = { phamVi: "apply", xo: "gw-token-apply", tran: TRAN_APPLY_MOI_PHUT_TOKEN } as const;
const CUA_PHAN_HOI = { phamVi: "chat", xo: "gw-token-phan-hoi", tran: TRAN_PHAN_HOI_MOI_PHUT_TOKEN } as const;

/** Thân `POST /api/ai/client-feedback` — khoá ngoài lạ (`userId`, `nguon`…) bị BỎ (zod strip): người = chủ token. */
export const phanHoiClientSchema = z.object({
  luotId: z.string().uuid(),
  chiSoKhoi: z.number().int().min(0).max(10_000),
  danhGia: z.union([z.literal(1), z.literal(-1)]).nullable(),
  lyDo: z.string().max(TRAN_KY_TU_LY_DO).nullable().optional(),
  cauHoi: z.string().min(1).max(TRAN_KY_TU_CAU_HOI_CLIENT),
  traLoi: z.string().min(1).max(TRAN_KY_TU_TRA_LOI_CLIENT),
  duAn: z.string().max(64).nullable().optional(),
});

/** Từ chối sớm (KHÔNG chạm CSDL, KHÔNG đọc thân) khi không trình Bearer `avgw_` — đứng TRƯỚC bộ đọc thân lớn. */
const canBearerSom: express.RequestHandler = (req, res, next) => {
  if (!bearerNguoiDung(req)) {
    loi(res, 401, "invalid_api_key", "Missing personal API token. Provide 'Authorization: Bearer avgw_…'.");
    return;
  }
  next();
};

/** Bộ đọc thân JSON trả lỗi bằng KHUNG OpenAI (413 quá lớn · 400 JSON hỏng) thay vì trang lỗi mặc định của Express. */
function docThanJson(limit: string): express.RequestHandler {
  const parser = express.json({ limit });
  return (req, res, next) =>
    parser(req, res, (err?: unknown) => {
      if (!err) return next();
      const e = err as { type?: string; status?: number };
      if (e.type === "entity.too.large" || e.status === 413) loi(res, 413, "body_too_large", `Request body exceeds ${limit}.`);
      else loi(res, 400, "invalid_body", "Request body is not valid JSON.");
    });
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
      const nguoi = await xacThucPhamVi(req, res, pt, CUA_APPLY);
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
      const nguoi = await xacThucPhamVi(req, res, pt, CUA_APPLY);
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

  // ★ Đợt 5.1 VSCode — phiếu cho câu trả lời cuối của lượt agent chạy cục bộ trong extension.
  app.post(
    "/api/ai/client-feedback",
    canBearerSom,
    docThanJson(TRAN_THAN_PHAN_HOI),
    anToan(async (req, res) => {
      const nguoi = await xacThucPhamVi(req, res, pt, CUA_PHAN_HOI);
      if (!nguoi) return;
      const vao = phanHoiClientSchema.safeParse(req.body ?? {});
      if (!vao.success) {
        loi(res, 400, "invalid_body", `Invalid body: ${vao.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
        return;
      }
      const kq = await pt.phanHoiClient(nguoi, vao.data);
      if (!kq.ok) {
        if (kq.note === "PERMISSION_DENIED") loi(res, 403, "permission_denied", "The token owner cannot record feedback.");
        else loi(res, 503, "db_unavailable", "Feedback store unavailable.");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, phieu: kq.phieu });
    }),
  );
}
