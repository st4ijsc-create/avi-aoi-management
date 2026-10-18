/**
 * ★★★ Đợt 3c (2026-10-17) — `GET /api/ai/preview/:projectId[/*]`: CỬA VÀO xem trước trên ỨNG DỤNG CHÍNH.
 *
 * Tuyến này KHÔNG proxy một byte nào trên origin của ứng dụng (đó là toàn bộ điểm của thiết kế — xem khối an ninh ở
 * `services/ai/chayUngDung/proxyXemTruoc.ts`). Nó chỉ:
 *   1. xác thực PHIÊN (`thuXacThucRest` — cùng phân loại 401/403/500 của mọi tuyến REST);
 *   2. hỏi lại `ai_repo_read/canView` (fail-closed — quyền bị thu sau khi chạy thì không xem được nữa);
 *   3. kiểm dự án ĐANG CHẠY và người hỏi CHÍNH LÀ người đã chạy nó — sai ⇒ 404 (không tiết lộ dự án nào đang chạy);
 *   4. ★★★ (vá cookie-tossing) origin xem trước = `AI_PREVIEW_PUBLIC_ORIGIN` (BẮT BUỘC, không suy từ host yêu cầu) và
 *      phải KHÁC SITE với host ứng dụng của CHÍNH yêu cầu (`cungSite`) — cùng site ⇒ 409 `PREVIEW_SAME_SITE`, 0 vé;
 *   5. cấp VÉ MỘT LẦN (60 s) và 302 sang `<origin xem trước>/__ai_xem_truoc/vao?t=<vé>&p=<đường con>`.
 * `iframe src` của bảng "Chạy & Xem trước" trỏ vào đây (same-origin ⇒ cookie phiên ứng dụng đi kèm ĐÚNG MỘT lần,
 * tới đúng tuyến này); sau 302, khung ở origin proxy với cookie RIÊNG.
 *
 * ⚠ Cổng giấy phép MOD_AI do `app.use("/api/ai", chanTuyenAiTheoGiayPhep())` đứng TRƯỚC lượt đăng ký này.
 */
import type express from "express";
import type { Request, Response } from "express";
import { RE_ID_DU_AN } from "@shared/aiCodingSession";
import { checkPermission } from "../_core/accessControl";
import { thuXacThucRest, thanTuChoiRest, type KetQuaXacThucRest } from "./_xacThucRest";
import { DUONG_VAO, type KhoVeXemTruoc } from "../services/ai/chayUngDung/proxyXemTruoc";
import { phanGiaiGoc, type NguoiGoiDuAn } from "../services/aiLocalTools/repoProjects";
import { docCauHinhXemTruoc, khoVeXemTruoc, quanLyUngDung, type CauHinhXemTruoc } from "../services/ai/chayUngDung";
import { GOI_Y_CAU_HINH_ORIGIN_RIENG, cungSite } from "../services/ai/chayUngDung/cungSite";

export interface PhuThuocTuyenXemTruoc {
  xacThuc: (req: Request) => Promise<KetQuaXacThucRest>;
  coQuyenXem: (userId: number, role: string) => Promise<boolean>;
  /** Dự án CÁ NHÂN chỉ phân giải cho chủ/admin (`repoProjects.phanGiaiGoc`) — lớp thứ hai cạnh phép "chủ tiến trình". */
  phanGiaiGoc: (projectId: unknown, nguoiGoi: NguoiGoiDuAn | null) => { ok: boolean };
  kho: KhoVeXemTruoc;
  ungDung: {
    trangThai: (projectId: string) => { chuSoHuu: number } | null;
    congCuaDuAn: (projectId: string) => number | null;
  };
  cauHinh: () => Pick<CauHinhXemTruoc, "bat" | "cong" | "originCongKhai" | "lyDoTat">;
}

function macDinh(): PhuThuocTuyenXemTruoc {
  return {
    xacThuc: thuXacThucRest,
    coQuyenXem: async (userId, role) => {
      try {
        return await checkPermission(userId, role, "ai_repo_read", "canView");
      } catch {
        return false;
      }
    },
    phanGiaiGoc,
    kho: khoVeXemTruoc,
    ungDung: {
      trangThai: (id) => quanLyUngDung().trangThai(id),
      congCuaDuAn: (id) => quanLyUngDung().congCuaDuAn(id),
    },
    cauHinh: () => docCauHinhXemTruoc(),
  };
}

export function registerAiXemTruocRoutes(app: express.Express, deps: PhuThuocTuyenXemTruoc = macDinh()): void {
  const xuLy = async (req: Request, res: Response): Promise<void> => {
    const xt = await deps.xacThuc(req);
    if (!xt.ok) {
      res.status(xt.ma).json({ success: false, ...thanTuChoiRest(xt) });
      return;
    }
    const userId = Number(xt.user.id);
    if (!(await deps.coQuyenXem(userId, String(xt.user.role ?? "")))) {
      res.status(403).json({ success: false, code: "PERMISSION_DENIED" });
      return;
    }
    const projectId = String((req.params as Record<string, string>)?.projectId ?? "");
    const thayDuAn = RE_ID_DU_AN.test(projectId) && deps.phanGiaiGoc(projectId, { id: userId, role: String(xt.user.role ?? "") }).ok;
    const tt = thayDuAn ? deps.ungDung.trangThai(projectId) : null;
    if (!tt || deps.ungDung.congCuaDuAn(projectId) === null || tt.chuSoHuu !== userId) {
      res.status(404).json({ success: false, code: "NOT_FOUND" });
      return;
    }
    const ch = deps.cauHinh();
    // ★★★ Vá cookie-tossing (rà f4b504dc5): KHÔNG còn suy origin từ `req.hostname` (= CÙNG host ứng dụng ⇒ cùng site,
    // cookie không tách theo cổng). Origin RIÊNG do cấu hình quyết, thiếu ⇒ TẮT.
    if (!ch.bat || ch.cong === null || !ch.originCongKhai) {
      res.status(503).json({ success: false, code: "PREVIEW_DISABLED", lyDo: ch.lyDoTat ?? "THIEU_ORIGIN_RIENG" });
      return;
    }
    const origin = ch.originCongKhai;
    // So với host ỨNG DỤNG mà CHÍNH yêu cầu này dùng (người dùng có thể mở ứng dụng bằng đúng host xem trước) — cùng
    // site ⇒ 409, KHÔNG cấp vé. Host vắng/méo ⇒ coi là cùng (fail-closed, `cungSite`).
    let hostXemTruoc: string | null = null;
    try {
      hostXemTruoc = new URL(origin).hostname;
    } catch {
      hostXemTruoc = null;
    }
    if (cungSite(typeof req.hostname === "string" ? req.hostname : null, hostXemTruoc)) {
      res.setHeader("Cache-Control", "no-store");
      res.status(409).json({ success: false, code: "PREVIEW_SAME_SITE", goiY: GOI_Y_CAU_HINH_ORIGIN_RIENG });
      return;
    }
    const ve = deps.kho.capVe(userId, projectId);
    const con = String((req.params as Record<string, string>)?.[0] ?? "");
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) if (typeof v === "string") q.append(k, v);
    const duong = `/${con}${q.toString() ? `?${q.toString()}` : ""}`;
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, `${origin}${DUONG_VAO}?t=${encodeURIComponent(ve)}&p=${encodeURIComponent(duong)}`);
  };
  app.get("/api/ai/preview/:projectId", xuLy);
  app.get("/api/ai/preview/:projectId/*", xuLy);
}
