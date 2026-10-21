/**
 * ★★★ H2 (audit bảo mật 2026-10-21) — QUYỀN DUYỆT của `flow.duyet` (bước `nguoi.duyet`).
 *
 * Lỗ: `vaiTroDuyet` ("supervisor"…) chỉ được GÁN (nut/nguoi.ts, ot/congOtLuong.ts) và HIỂN THỊ (danh sách chờ) — không ai so nó với vai
 * người duyệt; `duyet` chỉ cần `ghiProcedure` (mọi vai trừ viewer/user). Hệ quả: operator/maintenance duyệt bước ghi "trưởng ca duyệt",
 * và tác giả luồng tự duyệt lượt của chính mình (không có tách người làm / người duyệt).
 *
 * Luật (quyết định của dieu-phoi 2026-10-21):
 *   1. VAI: người duyệt phải đủ thứ bậc so với `vaiTroDuyet`; admin duyệt được mọi bước; vai lạ ⇒ chỉ đúng vai đó (và admin).
 *   2. TÁCH NGƯỜI (không miễn trừ cho admin — cùng tiền lệ "four-eyes" của FOE): người duyệt phải KHÁC
 *        • người BẬT phiên bản (ai_flow_versions."enabledBy") — của luồng chứa bước chờ VÀ của các luồng cha (luồng con trong cây lượt);
 *        • người KÍCH HOẠT lượt bằng tay (ai_flow_runs."startedBy") — của lượt chứa bước chờ VÀ của lượt gốc (cây lượt con).
 *      Lượt từ lịch / webhook / MCP / luồng con có startedBy NULL ⇒ chỉ còn ràng buộc "khác người bật".
 *      Dữ liệu CŨ chưa ghi người bật (NULL) ⇒ không có gì để so ⇒ chỉ áp luật vai (không khoá cả hàng chờ có trước bản vá).
 *   3. Sai ⇒ FORBIDDEN + dòng kiểm toán FLOW_DUYET_TU_CHOI (router), hàng chờ GIỮ NGUYÊN.
 *
 * ⚠ Thứ bậc vai dưới đây là của MODULE NÀY: repo chưa có bảng thứ bậc vai dùng chung (chỉ các tập PRIVILEGED_ROLES / ACTUATION_ROLES).
 *   Quy ước: viewer/user (0, không ghi được) < operator = maintenance (1) < quality_inspector = engineer (2) < supervisor (3) < admin (4).
 */
import { sql } from "drizzle-orm";
import type { getDb } from "../../db/connection";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const THU_BAC_VAI_DUYET: Readonly<Record<string, number>> = {
  viewer: 0, user: 0, operator: 1, maintenance: 1, quality_inspector: 2, engineer: 2, supervisor: 3, admin: 4,
};

/** Vai của người duyệt có đủ so với vai yêu cầu của bước không. */
export function vaiDuDeDuyet(vaiNguoiDuyet: string, vaiYeuCau: string): boolean {
  const a = String(vaiNguoiDuyet ?? "").trim().toLowerCase();
  const b = String(vaiYeuCau ?? "").trim().toLowerCase();
  if (a === "admin") return true;
  const ra = THU_BAC_VAI_DUYET[a];
  const rb = THU_BAC_VAI_DUYET[b];
  if (ra === undefined || rb === undefined) return a !== "" && a === b; // vai lạ ⇒ fail-closed: chỉ đúng vai ấy
  return ra >= rb && ra >= 1; // viewer/user không bao giờ duyệt
}

export type MaTuChoiDuyet = "VAI_THAP" | "TRUNG_NGUOI_BAT" | "TRUNG_NGUOI_CHAY";
export type KetQuaQuyenDuyet = { ok: true } | { ok: false; ma: MaTuChoiDuyet; lyDo: string };

export interface NguoiLienQuanLuot {
  /** Người BẬT phiên bản của luồng chứa bước chờ và của mọi luồng cha (null = chưa ghi nhận — bỏ qua). */
  nguoiBat: readonly (number | null)[];
  /** Người kích hoạt lượt bằng tay của lượt chứa bước chờ và của mọi lượt cha (null = lịch/webhook/MCP/luồng con). */
  nguoiChay: readonly (number | null)[];
}

/** Thuần: phán quyết cho một lượt duyệt. */
export function kiemQuyenDuyet(y: {
  nguoiDuyet: { id: number; role: string };
  vaiTroDuyet: string;
  lienQuan: NguoiLienQuanLuot;
}): KetQuaQuyenDuyet {
  if (!vaiDuDeDuyet(y.nguoiDuyet.role, y.vaiTroDuyet)) {
    return { ok: false, ma: "VAI_THAP", lyDo: `Bước này chỉ vai '${y.vaiTroDuyet}' trở lên (hoặc admin) được duyệt — vai của bạn: '${y.nguoiDuyet.role}'.` };
  }
  if (y.lienQuan.nguoiBat.some((id) => id !== null && id === y.nguoiDuyet.id)) {
    return { ok: false, ma: "TRUNG_NGUOI_BAT", lyDo: "Bạn đã BẬT phiên bản luồng này — người duyệt phải là người khác (tách người làm / người duyệt)." };
  }
  if (y.lienQuan.nguoiChay.some((id) => id !== null && id === y.nguoiDuyet.id)) {
    return { ok: false, ma: "TRUNG_NGUOI_CHAY", lyDo: "Bạn đã kích hoạt lượt chạy này — người duyệt phải là người khác (tách người làm / người duyệt)." };
  }
  return { ok: true };
}

/** Đọc người bật + người chạy của lượt và các lượt cha (tối đa 8 cấp). */
export async function layNguoiLienQuan(db: Db, runId: string): Promise<NguoiLienQuanLuot> {
  const rows = (await db.execute(sql`
    WITH RECURSIVE c AS (
      SELECT id, "flowId", version, "startedBy", "parentRunId", 0 AS d FROM ai_flow_runs WHERE id = ${runId}::uuid
      UNION ALL
      SELECT r.id, r."flowId", r.version, r."startedBy", r."parentRunId", c.d + 1
        FROM ai_flow_runs r JOIN c ON r.id = c."parentRunId" WHERE c.d < 8
    )
    SELECT c."startedBy" AS "startedBy", v."enabledBy" AS "enabledBy"
      FROM c LEFT JOIN ai_flow_versions v ON v."flowId" = c."flowId" AND v.version = c.version`)) as unknown as { startedBy: number | null; enabledBy: number | null }[];
  return { nguoiBat: rows.map((r) => r.enabledBy), nguoiChay: rows.map((r) => r.startedBy) };
}
