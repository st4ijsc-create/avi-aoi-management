/**
 * ★★★ AI Local Đợt 5.1 (2026-10-17) — tầng dữ liệu của `ai_agent_feedback` (mig 0397): phiếu 👍/👎 + lý do cho câu trả
 * lời của lượt agent và cho diff đã duyệt/bác, cùng quyết định duyệt/bác ghi từ cửa duyệt thật.
 *
 * ⚠⚠ PHẠM VI CHỦ — `"userId" = <người phiên>` nằm trong MỌI mệnh đề WHERE / khoá xung đột của các hàm ghi/đọc theo
 *   người (khuôn `aiAgentRuns.ts`). Hai ngoại lệ CÓ TÊN, chỉ cho thủ tục admin: `tongHopPhanHoi()` (đếm, không nội
 *   dung) và `docHangChoXuat(null)` (xuất bộ dữ liệu mọi người). Thủ tục gọi chúng tự kiểm vai admin.
 * ⚠ Upsert theo chỉ mục UNIQUE MỘT PHẦN (`… WHERE loai = 'tra-loi' | 'diff'`) — viết SQL tay vì `ON CONFLICT` phải nêu
 *   đúng vị từ của chỉ mục. Mốc giờ ghi bằng `now()` phía SQL (cột `timestamptz`).
 * ⚠ Hỏng CSDL ⇒ suy giảm (`{ ok:false }` / rỗng / null + cảnh báo), KHÔNG ném: phản hồi là phụ, không được làm hỏng
 *   lượt duyệt/bác đang gọi nó.
 * ⚠ Nội dung (`cauHoi`, `noiDung`, `lyDo`…) phải được CHE bí mật ở tầng gọi TRƯỚC khi tới đây (`thuTucPhanHoi.ts`).
 * ★ Đợt 5.1 VSCode (mig 0398): cột `nguon` (`web` | `vscode`) + `luotClient`. Phiếu `vscode` = lượt agent CHẠY CỤC BỘ
 *   trong extension — KHÔNG có hàng `ai_agent_runs`, văn bản do CLIENT gửi (máy chủ chỉ che + cắt). Khoá riêng
 *   (`ai_agent_feedback_vscode_uq`: người × lượt client × khối). KHÔNG trộn mức tin: tổng hợp đếm tách nguồn; bộ đọc
 *   xuất mang `nguon` và chỉ đọc `web`; `mauBoDuLieuTuHang` cũng chỉ nhận `web`.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./connection";
import { isMissingTable } from "../_core/dbErrors";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_ID_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;
export const TRAN_DANH_SACH_PHAN_HOI = 200;
export const TRAN_XUAT = 5_000;
const TRAN_TRICH = 500;

export type DanhGia = -1 | 1;

export interface TomTatPhanHoi {
  id: string;
  loai: "tra-loi" | "diff";
  /** `web` (văn bản từ sổ máy chủ) | `vscode` (văn bản client tự khai — mig 0398). */
  nguon: "web" | "vscode";
  /** vscode: id lượt do extension sinh (uuid); web: null. */
  luotClient: string | null;
  runId: string | null;
  chiSoTin: number | null;
  actionId: string | null;
  projectId: string | null;
  danhGia: number | null;
  lyDo: string | null;
  quyetDinh: string | null;
  lyDoBac: string | null;
  duongDan: string | null;
  /** 500 ký tự đầu của câu trả lời / diff (đã che lúc ghi). */
  trichNoiDung: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KetQuaGhi = { ok: true; hang: TomTatPhanHoi | null } | { ok: false };

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) console.warn(`[aiAgentFeedback] ${cho} hỏng (degrade):`, err);
}

const laUser = (u: number) => Number.isInteger(u) && u > 0;
const duAnHopLe = (p: string | null | undefined) => (p && RE_ID_DU_AN.test(p) ? p : null);
const iso = (d: unknown) => (d instanceof Date ? d : new Date(String(d))).toISOString();
const catNgan = (s: string | null | undefined, n: number) => (s == null ? null : s.length > n ? s.slice(0, n) : s);

type HangTho = Record<string, unknown>;

function tomTat(h: HangTho): TomTatPhanHoi {
  const nd = h.noiDung == null ? null : String(h.noiDung);
  return {
    id: String(h.id),
    loai: h.loai === "diff" ? "diff" : "tra-loi",
    nguon: h.nguon === "vscode" ? "vscode" : "web",
    luotClient: h.luotClient == null ? null : String(h.luotClient),
    runId: h.runId == null ? null : String(h.runId),
    chiSoTin: h.chiSoTin == null ? null : Number(h.chiSoTin),
    actionId: h.actionId == null ? null : String(h.actionId),
    projectId: h.projectId == null ? null : String(h.projectId),
    danhGia: h.danhGia == null ? null : Number(h.danhGia),
    lyDo: h.lyDo == null ? null : String(h.lyDo),
    quyetDinh: h.quyetDinh == null ? null : String(h.quyetDinh),
    lyDoBac: h.lyDoBac == null ? null : String(h.lyDoBac),
    duongDan: h.duongDan == null ? null : String(h.duongDan),
    trichNoiDung: nd == null ? null : nd.length > TRAN_TRICH ? `${nd.slice(0, TRAN_TRICH)}…` : nd,
    createdAt: iso(h.createdAt),
    updatedAt: iso(h.updatedAt),
  };
}

const rows = (r: unknown) => r as unknown as HangTho[];

// ─── phiếu câu trả lời ─────────────────────────────────────────────────────────────────────────

export interface PhieuTraLoi {
  userId: number;
  runId: string;
  chiSoTin: number;
  projectId: string | null;
  /** null ⇒ BỎ PHIẾU (xoá hàng của chính người này). */
  danhGia: DanhGia | null;
  lyDo: string | null;
  cauHoi: string | null;
  noiDung: string | null;
}

export async function ghiPhieuTraLoi(p: PhieuTraLoi): Promise<KetQuaGhi> {
  if (!laUser(p.userId) || !RE_UUID.test(p.runId) || !Number.isInteger(p.chiSoTin) || p.chiSoTin < 0) return { ok: false };
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    if (p.danhGia === null) {
      await db.execute(sql`
        DELETE FROM ai_agent_feedback
         WHERE "userId" = ${p.userId} AND loai = 'tra-loi' AND "runId" = ${p.runId} AND "chiSoTin" = ${p.chiSoTin}`);
      return { ok: true, hang: null };
    }
    const ra = rows(
      await db.execute(sql`
        INSERT INTO ai_agent_feedback ("userId", loai, "runId", "chiSoTin", "projectId", "danhGia", "lyDo", "cauHoi", "noiDung")
        VALUES (${p.userId}, 'tra-loi', ${p.runId}, ${p.chiSoTin}, ${duAnHopLe(p.projectId)}, ${p.danhGia},
                ${catNgan(p.lyDo, 2000)}, ${p.cauHoi}, ${p.noiDung})
        ON CONFLICT ("userId", "runId", "chiSoTin") WHERE loai = 'tra-loi'
        DO UPDATE SET "danhGia" = EXCLUDED."danhGia", "lyDo" = EXCLUDED."lyDo", "updatedAt" = now()
        RETURNING *`),
    );
    return { ok: true, hang: ra[0] ? tomTat(ra[0]) : null };
  } catch (err) {
    canhBao("ghiPhieuTraLoi", err);
    return { ok: false };
  }
}

// ─── phiếu câu trả lời của lượt agent CHẠY CỤC BỘ (extension VSCode, mig 0398) ────────────────────

export interface PhieuTraLoiClient {
  userId: number;
  /** id lượt do extension sinh (uuid) — không phải `ai_agent_runs.id`. */
  luotClient: string;
  chiSoTin: number;
  projectId: string | null;
  /** null ⇒ BỎ PHIẾU (xoá hàng của chính người này). */
  danhGia: DanhGia | null;
  lyDo: string | null;
  cauHoi: string | null;
  /** Câu trả lời CLIENT gửi — đã che + cắt ở `thuTucPhanHoiClient`. Bắt buộc khi bỏ phiếu (CHECK 0398). */
  noiDung: string | null;
}

/**
 * Upsert phiếu `nguon = 'vscode'` theo (người, lượt client, khối). Bấm lại = SỬA phiếu/lý do; văn bản của LẦN ĐẦU được
 * GIỮ (cùng luật ảnh chụp đầu của diff) — một lượt gửi sau với chữ khác cho cùng khoá không viết lại lịch sử.
 */
export async function ghiPhieuTraLoiClient(p: PhieuTraLoiClient): Promise<KetQuaGhi> {
  if (!laUser(p.userId) || !RE_UUID.test(p.luotClient) || !Number.isInteger(p.chiSoTin) || p.chiSoTin < 0) return { ok: false };
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    if (p.danhGia === null) {
      await db.execute(sql`
        DELETE FROM ai_agent_feedback
         WHERE "userId" = ${p.userId} AND loai = 'tra-loi' AND nguon = 'vscode'
           AND "luotClient" = ${p.luotClient} AND "chiSoTin" = ${p.chiSoTin}`);
      return { ok: true, hang: null };
    }
    if (!p.noiDung) return { ok: false };
    const ra = rows(
      await db.execute(sql`
        INSERT INTO ai_agent_feedback ("userId", loai, nguon, "luotClient", "chiSoTin", "projectId", "danhGia", "lyDo", "cauHoi", "noiDung")
        VALUES (${p.userId}, 'tra-loi', 'vscode', ${p.luotClient}, ${p.chiSoTin}, ${duAnHopLe(p.projectId)}, ${p.danhGia},
                ${catNgan(p.lyDo, 2000)}, ${p.cauHoi}, ${p.noiDung})
        ON CONFLICT ("userId", "luotClient", "chiSoTin") WHERE loai = 'tra-loi' AND nguon = 'vscode'
        DO UPDATE SET "danhGia" = EXCLUDED."danhGia", "lyDo" = EXCLUDED."lyDo", "updatedAt" = now()
        RETURNING *`),
    );
    return { ok: true, hang: ra[0] ? tomTat(ra[0]) : null };
  } catch (err) {
    canhBao("ghiPhieuTraLoiClient", err);
    return { ok: false };
  }
}

// ─── diff: phiếu (nút) + quyết định (cửa duyệt) ───────────────────────────────────────────────

export interface AnhChupDiff {
  userId: number;
  actionId: string;
  runId: string | null;
  projectId: string | null;
  cauHoi: string | null;
  noiDung: string | null;
  duongDan: string | null;
}

export async function ghiPhieuDiff(p: AnhChupDiff & { danhGia: DanhGia | null; lyDo: string | null }): Promise<KetQuaGhi> {
  if (!laUser(p.userId) || !p.actionId || p.actionId.length > 64) return { ok: false };
  const db = await getDb();
  if (!db) return { ok: false };
  const runId = p.runId && RE_UUID.test(p.runId) ? p.runId : null;
  try {
    if (p.danhGia === null) {
      // Hàng chỉ có phiếu ⇒ xoá; hàng còn mang quyết định ⇒ giữ, chỉ gỡ phiếu (CHECK: diff cần phiếu HOẶC quyết định).
      await db.execute(sql`
        DELETE FROM ai_agent_feedback
         WHERE "userId" = ${p.userId} AND loai = 'diff' AND "actionId" = ${p.actionId} AND "quyetDinh" IS NULL`);
      const ra = rows(
        await db.execute(sql`
          UPDATE ai_agent_feedback SET "danhGia" = NULL, "lyDo" = NULL, "updatedAt" = now()
           WHERE "userId" = ${p.userId} AND loai = 'diff' AND "actionId" = ${p.actionId}
          RETURNING *`),
      );
      return { ok: true, hang: ra[0] ? tomTat(ra[0]) : null };
    }
    const ra = rows(
      await db.execute(sql`
        INSERT INTO ai_agent_feedback ("userId", loai, "actionId", "runId", "projectId", "danhGia", "lyDo", "cauHoi", "noiDung", "duongDan")
        VALUES (${p.userId}, 'diff', ${p.actionId}, ${runId}, ${duAnHopLe(p.projectId)}, ${p.danhGia}, ${catNgan(p.lyDo, 2000)},
                ${p.cauHoi}, ${p.noiDung}, ${catNgan(p.duongDan, 1000)})
        ON CONFLICT ("userId", "actionId") WHERE loai = 'diff'
        DO UPDATE SET "danhGia" = EXCLUDED."danhGia", "lyDo" = EXCLUDED."lyDo",
                      "runId" = COALESCE(ai_agent_feedback."runId", EXCLUDED."runId"),
                      "projectId" = COALESCE(ai_agent_feedback."projectId", EXCLUDED."projectId"),
                      "cauHoi" = COALESCE(ai_agent_feedback."cauHoi", EXCLUDED."cauHoi"),
                      "noiDung" = COALESCE(ai_agent_feedback."noiDung", EXCLUDED."noiDung"),
                      "duongDan" = COALESCE(ai_agent_feedback."duongDan", EXCLUDED."duongDan"),
                      "updatedAt" = now()
        RETURNING *`),
    );
    return { ok: true, hang: ra[0] ? tomTat(ra[0]) : null };
  } catch (err) {
    canhBao("ghiPhieuDiff", err);
    return { ok: false };
  }
}

/** Quyết định duyệt/bác — gọi TỪ cửa duyệt thật (`thuTucLuotChay`), không từ client. Ảnh chụp đầu tiên được GIỮ. */
export async function ghiQuyetDinhDiff(p: AnhChupDiff & { quyetDinh: "duyet" | "bac"; lyDoBac: string | null }): Promise<KetQuaGhi> {
  if (!laUser(p.userId) || !p.actionId || p.actionId.length > 64) return { ok: false };
  const db = await getDb();
  if (!db) return { ok: false };
  const runId = p.runId && RE_UUID.test(p.runId) ? p.runId : null;
  const lyDoBac = p.quyetDinh === "bac" ? catNgan(p.lyDoBac, 2000) : null;
  try {
    const ra = rows(
      await db.execute(sql`
        INSERT INTO ai_agent_feedback ("userId", loai, "actionId", "runId", "projectId", "quyetDinh", "lyDoBac", "cauHoi", "noiDung", "duongDan")
        VALUES (${p.userId}, 'diff', ${p.actionId}, ${runId}, ${duAnHopLe(p.projectId)}, ${p.quyetDinh}, ${lyDoBac},
                ${p.cauHoi}, ${p.noiDung}, ${catNgan(p.duongDan, 1000)})
        ON CONFLICT ("userId", "actionId") WHERE loai = 'diff'
        DO UPDATE SET "quyetDinh" = EXCLUDED."quyetDinh", "lyDoBac" = EXCLUDED."lyDoBac",
                      "runId" = COALESCE(ai_agent_feedback."runId", EXCLUDED."runId"),
                      "projectId" = COALESCE(ai_agent_feedback."projectId", EXCLUDED."projectId"),
                      "cauHoi" = COALESCE(ai_agent_feedback."cauHoi", EXCLUDED."cauHoi"),
                      "noiDung" = COALESCE(ai_agent_feedback."noiDung", EXCLUDED."noiDung"),
                      "duongDan" = COALESCE(ai_agent_feedback."duongDan", EXCLUDED."duongDan"),
                      "updatedAt" = now()
        RETURNING *`),
    );
    return { ok: true, hang: ra[0] ? tomTat(ra[0]) : null };
  } catch (err) {
    canhBao("ghiQuyetDinhDiff", err);
    return { ok: false };
  }
}

// ─── đọc ──────────────────────────────────────────────────────────────────────────────────────

/** Phiếu CỦA MỘT người, mới nhất trước. */
export async function danhSachPhanHoiCuaToi(userId: number, gioiHan = 50): Promise<TomTatPhanHoi[]> {
  if (!laUser(userId)) return [];
  const db = await getDb();
  if (!db) return [];
  const n = Math.max(1, Math.min(Math.trunc(gioiHan) || 50, TRAN_DANH_SACH_PHAN_HOI));
  try {
    return rows(
      await db.execute(sql`
        SELECT * FROM ai_agent_feedback WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC, id LIMIT ${n}`),
    ).map(tomTat);
  } catch (err) {
    canhBao("danhSachPhanHoiCuaToi", err);
    return [];
  }
}

export interface TongHopPhanHoi {
  /** Phiếu câu trả lời của lượt máy chủ (`nguon = 'web'`, văn bản từ sổ). */
  traLoi: { len: number; xuong: number };
  /** Phiếu câu trả lời của lượt chạy cục bộ trong extension (`nguon = 'vscode'`, văn bản client tự khai) — TÁCH RIÊNG. */
  traLoiVscode: { len: number; xuong: number };
  diff: { len: number; xuong: number; duyet: number; bac: number };
  soNguoi: number;
}

/** ADMIN — chỉ ĐẾM (không nội dung, không danh tính). Thủ tục gọi tự kiểm vai. */
export async function tongHopPhanHoi(): Promise<TongHopPhanHoi | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [h] = rows(
      await db.execute(sql`
        SELECT count(*) FILTER (WHERE loai = 'tra-loi' AND nguon = 'web' AND "danhGia" = 1)::int  AS tl_len,
               count(*) FILTER (WHERE loai = 'tra-loi' AND nguon = 'web' AND "danhGia" = -1)::int AS tl_xuong,
               count(*) FILTER (WHERE loai = 'tra-loi' AND nguon = 'vscode' AND "danhGia" = 1)::int  AS tlv_len,
               count(*) FILTER (WHERE loai = 'tra-loi' AND nguon = 'vscode' AND "danhGia" = -1)::int AS tlv_xuong,
               count(*) FILTER (WHERE loai = 'diff' AND "danhGia" = 1)::int     AS d_len,
               count(*) FILTER (WHERE loai = 'diff' AND "danhGia" = -1)::int    AS d_xuong,
               count(*) FILTER (WHERE loai = 'diff' AND "quyetDinh" = 'duyet')::int AS d_duyet,
               count(*) FILTER (WHERE loai = 'diff' AND "quyetDinh" = 'bac')::int   AS d_bac,
               count(DISTINCT "userId")::int AS so_nguoi
          FROM ai_agent_feedback`),
    );
    const n = (k: string) => Number(h?.[k] ?? 0);
    return {
      traLoi: { len: n("tl_len"), xuong: n("tl_xuong") },
      traLoiVscode: { len: n("tlv_len"), xuong: n("tlv_xuong") },
      diff: { len: n("d_len"), xuong: n("d_xuong"), duyet: n("d_duyet"), bac: n("d_bac") },
      soNguoi: n("so_nguoi"),
    };
  } catch (err) {
    canhBao("tongHopPhanHoi", err);
    return null;
  }
}

export interface HangXuat {
  loai: string;
  quyetDinh: string | null;
  danhGia: number | null;
  cauHoi: string | null;
  noiDung: string | null;
  duongDan: string | null;
  projectId: string | null;
  runId: string | null;
  actionId: string | null;
  nguon: string;
}

/**
 * Hàng ứng viên cho bộ dữ liệu: diff ĐƯỢC DUYỆT, không 👎. `userId = null` ⇒ MỌI người (chỉ thủ tục ADMIN được truyền
 * null); số ⇒ chỉ người đó. Lọc đường cấm + che lần hai ở `mauBoDuLieuTuHang`.
 */
export async function docHangChoXuat(userId: number | null, gioiHan = TRAN_XUAT): Promise<HangXuat[]> {
  if (userId !== null && !laUser(userId)) return [];
  const db = await getDb();
  if (!db) return [];
  const n = Math.max(1, Math.min(Math.trunc(gioiHan) || TRAN_XUAT, TRAN_XUAT));
  try {
    const ra = rows(
      await db.execute(sql`
        SELECT loai, nguon, "quyetDinh", "danhGia", "cauHoi", "noiDung", "duongDan", "projectId", "runId", "actionId"
          FROM ai_agent_feedback
         WHERE loai = 'diff' AND nguon = 'web' AND "quyetDinh" = 'duyet' AND "danhGia" IS DISTINCT FROM -1
           ${userId === null ? sql`` : sql`AND "userId" = ${userId}`}
         ORDER BY "createdAt", id
         LIMIT ${n}`),
    );
    return ra.map((h) => ({
      loai: String(h.loai),
      quyetDinh: h.quyetDinh == null ? null : String(h.quyetDinh),
      danhGia: h.danhGia == null ? null : Number(h.danhGia),
      cauHoi: h.cauHoi == null ? null : String(h.cauHoi),
      noiDung: h.noiDung == null ? null : String(h.noiDung),
      duongDan: h.duongDan == null ? null : String(h.duongDan),
      projectId: h.projectId == null ? null : String(h.projectId),
      runId: h.runId == null ? null : String(h.runId),
      actionId: h.actionId == null ? null : String(h.actionId),
      nguon: h.nguon == null ? "web" : String(h.nguon),
    }));
  } catch (err) {
    canhBao("docHangChoXuat", err);
    return [];
  }
}

/**
 * Lượt chạy CỦA `userId` có thẻ `can-duyet` mang `pendingActionId = actionId` (sổ `ai_agent_runs.suKien`, jsonb `@>`).
 * Không tìm thấy / của người khác ⇒ null (cùng giá trị).
 */
export async function timRunTheoAction(userId: number, actionId: string): Promise<{ id: string; projectId: string; cauHoi: string } | null> {
  if (!laUser(userId) || !actionId || actionId.length > 64) return null;
  const db = await getDb();
  if (!db) return null;
  const mau = JSON.stringify([{ suKien: { loai: "can-duyet", deXuat: { pendingActionId: actionId } } }]);
  try {
    const [h] = rows(
      await db.execute(sql`
        SELECT id, "projectId", "cauHoi" FROM ai_agent_runs
         WHERE "userId" = ${userId} AND "suKien" @> ${mau}::jsonb
         ORDER BY "createdAt" DESC LIMIT 1`),
    );
    return h ? { id: String(h.id), projectId: String(h.projectId), cauHoi: String(h.cauHoi) } : null;
  } catch (err) {
    canhBao("timRunTheoAction", err);
    return null;
  }
}
