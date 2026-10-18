/**
 * ★★★ AI Local Đợt 5.1 (2026-10-17) — THÂN các thủ tục PHẢN HỒI của vòng agent: `aiAgent.{phanHoi, phanHoiCuaToi,
 * phanHoiTongHop, xuatBoDuLieu}` + `ghiQuyetDinhTuCuaDuyet` (gọi từ `thuTucLuotChay.thuTucDuyet/thuTucBac`).
 * Router chỉ khai lược đồ + gọi vào đây (khuôn `agent/thuTucLuotChay.ts`), để lưới đo được thân thủ tục không cần tRPC.
 *
 * Nguyên tắc — VÌ SAO máy chủ không tin chữ client:
 *   • Văn bản lưu (câu trả lời / diff / chỉ dẫn) lấy từ SỔ MÁY CHỦ: khối trả lời thứ `chiSoTin` của `ai_agent_runs`
 *     (theo luật gộp của dòng thời gian client — `shared/phanHoiAgent.ts#khoiTraLoiTuSuKien`) và `argsJson` của hàng
 *     `ai_pending_actions`. Client chỉ gửi định danh + phiếu + lý do. Bộ dữ liệu huấn luyện vì thế không nhồi được chữ lạ.
 *   • Che bí mật (`redactSecretsOnly`) TRƯỚC khi ghi, và che LẦN HAI lúc xuất. Tệp bị chính sách hộp cát từ chối
 *     (`phanQuyetDuongDan` ≠ null: .env*, khoá, chứng thư, thư mục cấm) ⇒ KHÔNG lưu nội dung, và không bao giờ xuất.
 *   • Phạm vi CHỦ: lượt chạy (`chiTiet(runId, userId)`), đề xuất (`getAction(actionId, user)`) và lượt chạy theo đề xuất
 *     (`timRunTheoAction(userId, …)`) đều lọc theo người phiên ⇒ của người khác = NOT_FOUND (cùng mã với "không có").
 *   • Quyết định duyệt/bác đi từ CỬA thật, không từ nút: chỉ `executed` (áp TRỌN) ⇒ `duyet`; `ap_mot_phan` (người chọn
 *     một phần khối) KHÔNG ghi — diff đầy đủ trong args khác thứ đã áp, đưa vào bộ dữ liệu là dạy sai.
 *
 * ⚠ Quyền: `ai_repo_read/canView` (cùng bit các thủ tục lượt chạy) — fail-closed khi `checkPermission` ném. Tổng hợp và
 *   xuất MỌI người đòi vai `admin` (kiểm ở đây VÀ ở sàn thủ tục). Từ chối ⇒ `{ ok:false, note }`, không ném lỗi thô.
 * ⚠ `ghiQuyetDinhTuCuaDuyet` KHÔNG BAO GIỜ ném: phản hồi là phụ, không được làm hỏng một lượt duyệt/bác thật.
 *
 * ★ Đợt 5.1 VSCode — `thuTucPhanHoiClient`: phiếu cho câu trả lời cuối của lượt agent CHẠY CỤC BỘ trong extension (cửa
 *   REST Bearer `avgw_` phạm vi `chat`, `routes/aiGatewayTokenBearerApi.ts`). NGOẠI LỆ CÓ TÊN của nguyên tắc "không tin chữ
 *   client" ở trên: lượt cục bộ KHÔNG có hàng `ai_agent_runs` nên không có sổ để tra ⇒ client gửi văn bản, máy chủ che bí
 *   mật + cắt trần + ghi `nguon = 'vscode'` (mức tin THẤP hơn, không trộn với phiếu web — xem `db/aiAgentFeedback.ts`).
 */
import {
  khoiTraLoiTuSuKien,
  diffHopNhat,
  mauBoDuLieuTuHang,
  TRAN_KY_TU_NOI_DUNG,
  TRAN_KY_TU_CAU_HOI_CLIENT,
  TRAN_KY_TU_TRA_LOI_CLIENT,
  TRAN_KY_TU_LY_DO,
} from "@shared/phanHoiAgent";
import { checkPermission } from "../../../_core/accessControl";
import { redactSecretsOnly } from "../aiSafety";
import { phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";
import type {
  KetQuaGhi,
  TomTatPhanHoi,
  TongHopPhanHoi,
  HangXuat,
  PhieuTraLoi,
  PhieuTraLoiClient,
  AnhChupDiff,
  DanhGia,
} from "../../../db/aiAgentFeedback";

type NguoiPhien = { id: number; role: string; name?: string | null };

export interface PhuThuocPhanHoi {
  kiemQuyen(u: NguoiPhien): Promise<boolean>;
  /** Lượt chạy CỦA người này (bộ nhớ hoặc sổ) — null khi không có / của người khác. */
  chiTietLuot(runId: string, userId: number): Promise<{ projectId: string; cauHoi: string; suKien: unknown[] } | null>;
  /** Hàng `ai_pending_actions` CỦA người này — null khi không có / của người khác. */
  layAction(actionId: string, userId: number): Promise<{ tool: string; status: string; argsJson: unknown } | null>;
  timRun(userId: number, actionId: string): Promise<{ id: string; projectId: string; cauHoi: string } | null>;
  ghiPhieuTraLoi(p: PhieuTraLoi): Promise<KetQuaGhi>;
  ghiPhieuDiff(p: AnhChupDiff & { danhGia: DanhGia | null; lyDo: string | null }): Promise<KetQuaGhi>;
  ghiQuyetDinhDiff(p: AnhChupDiff & { quyetDinh: "duyet" | "bac"; lyDoBac: string | null }): Promise<KetQuaGhi>;
  danhSachCuaToi(userId: number): Promise<TomTatPhanHoi[]>;
  tongHop(): Promise<TongHopPhanHoi | null>;
  docHangChoXuat(userId: number | null): Promise<HangXuat[]>;
}

async function phuThuocThat(): Promise<PhuThuocPhanHoi> {
  const db = await import("../../../db/aiAgentFeedback");
  const { getAction } = await import("../../aiCopilotActions");
  const { quanLyLuotChay } = await import("../agent/quanLyLuotChay");
  const { docHangLuotChay } = await import("../../../db/aiAgentRuns");
  return {
    kiemQuyen: async (u) => checkPermission(u.id, u.role, "ai_repo_read", "canView"),
    chiTietLuot: async (runId, userId) => {
      // Sự kiện: bộ nhớ (lượt còn sống — đầy đủ) rồi tới sổ. Câu hỏi: lấy TRỌN từ sổ — `chiTiet` đọc sổ thì cắt 300 ký tự
      // (`tomTatTuHang`), và một chỉ dẫn bị cắt là một mẫu huấn luyện sai.
      const r = await quanLyLuotChay().chiTiet(runId, userId);
      if (!r) return null;
      const hang = await docHangLuotChay(userId, runId);
      return { projectId: r.projectId, cauHoi: hang?.cauHoi ?? r.cauHoi, suKien: r.suKien };
    },
    layAction: async (actionId, userId) => {
      // `getAction` lọc chủ (`row.userId !== user.id` ⇒ null); vai không dùng ở đó.
      const h = await getAction(actionId, { id: userId, role: "", name: null });
      return h ? { tool: h.tool, status: String(h.status), argsJson: h.argsJson } : null;
    },
    timRun: db.timRunTheoAction,
    ghiPhieuTraLoi: db.ghiPhieuTraLoi,
    ghiPhieuDiff: db.ghiPhieuDiff,
    ghiQuyetDinhDiff: db.ghiQuyetDinhDiff,
    danhSachCuaToi: (userId) => db.danhSachPhanHoiCuaToi(userId),
    tongHop: db.tongHopPhanHoi,
    docHangChoXuat: (userId) => db.docHangChoXuat(userId),
  };
}

/** Trần ký tự của MỘT lượt xuất (≈ 16 MB) — 5.000 hàng × diff 200k ký tự sẽ là 1 GB trong một phản hồi tRPC. */
export const TRAN_KY_TU_XUAT = 16_000_000;

const che = (s: string) => redactSecretsOnly(s).text;
const cheCat = (s: string | null | undefined) => (s == null ? null : che(s).slice(0, TRAN_KY_TU_NOI_DUNG));
const duongDuocPhep = (d: string) => phanQuyetDuongDan(d) === null;
const lyDoSach = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? che(t).slice(0, TRAN_KY_TU_LY_DO) : null;
};

async function coQuyen(u: NguoiPhien, pt: PhuThuocPhanHoi): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    return await pt.kiemQuyen(u);
  } catch {
    return false;
  }
}

/** Ảnh chụp diff ĐÃ CHE của một đề xuất `apply_diff` (null nếu không phải diff). Tệp cấm ⇒ nội dung null. */
function anhChupTuAction(a: { tool: string; argsJson: unknown }): { duongDan: string; noiDung: string | null } | null {
  if (a.tool !== "apply_diff") return null;
  const g = (a.argsJson ?? {}) as { path?: unknown; original?: unknown; modified?: unknown };
  if (typeof g.path !== "string" || typeof g.modified !== "string") return null;
  const duong = g.path.replace(/\\/g, "/");
  if (!duongDuocPhep(duong)) return { duongDan: duong, noiDung: null };
  // Che TỪNG phía trước khi diff: mẫu bí mật nhiều dòng (khoá riêng) không khớp được sau khi mỗi dòng mang tiền tố +/-.
  const d = diffHopNhat(duong, che(typeof g.original === "string" ? g.original : ""), che(g.modified));
  return { duongDan: duong, noiDung: d ? d : null };
}

export type DauVaoPhanHoi =
  | { loai: "tra-loi"; runId: string; chiSoTin: number; danhGia: DanhGia | null; lyDo?: string | null }
  | { loai: "diff"; actionId: string; danhGia: DanhGia | null; lyDo?: string | null };

export async function thuTucPhanHoi(u: NguoiPhien, y: DauVaoPhanHoi, ptVao?: PhuThuocPhanHoi) {
  const pt = ptVao ?? (await phuThuocThat());
  if (!(await coQuyen(u, pt))) return { ok: false as const, note: "PERMISSION_DENIED" as const, phieu: null };

  if (y.loai === "tra-loi") {
    const run = await pt.chiTietLuot(y.runId, u.id);
    const khoi = run ? khoiTraLoiTuSuKien(run.suKien as never) : [];
    if (!run || !Number.isInteger(y.chiSoTin) || y.chiSoTin < 0 || y.chiSoTin >= khoi.length) {
      return { ok: false as const, note: "NOT_FOUND" as const, phieu: null };
    }
    const kq = await pt.ghiPhieuTraLoi({
      userId: u.id,
      runId: y.runId,
      chiSoTin: y.chiSoTin,
      projectId: run.projectId,
      danhGia: y.danhGia,
      lyDo: lyDoSach(y.lyDo),
      cauHoi: cheCat(run.cauHoi),
      noiDung: cheCat(khoi[y.chiSoTin]),
    });
    return kq.ok ? { ok: true as const, note: null, phieu: kq.hang } : { ok: false as const, note: "DB_LOI" as const, phieu: null };
  }

  const a = await pt.layAction(y.actionId, u.id);
  if (!a) return { ok: false as const, note: "NOT_FOUND" as const, phieu: null };
  const anh = anhChupTuAction(a);
  if (!anh) return { ok: false as const, note: "KHONG_PHAI_DIFF" as const, phieu: null };
  const run = await pt.timRun(u.id, y.actionId);
  const kq = await pt.ghiPhieuDiff({
    userId: u.id,
    actionId: y.actionId,
    runId: run?.id ?? null,
    projectId: run?.projectId ?? null,
    cauHoi: cheCat(run?.cauHoi),
    noiDung: anh.noiDung,
    duongDan: anh.duongDan,
    danhGia: y.danhGia,
    lyDo: lyDoSach(y.lyDo),
  });
  return kq.ok ? { ok: true as const, note: null, phieu: kq.hang } : { ok: false as const, note: "DB_LOI" as const, phieu: null };
}

// ─── phiếu của lượt agent CHẠY CỤC BỘ (extension VSCode) ────────────────────────────────────────

export type GhiPhieuClient = (p: PhieuTraLoiClient) => Promise<KetQuaGhi>;

export interface DauVaoPhanHoiClient {
  /** id lượt do extension sinh (uuid). */
  luotId: string;
  /** Thứ tự khối trả lời trong lượt (`traLoiCuoiTuSuKien`), từ 0. */
  chiSoKhoi: number;
  danhGia: DanhGia | null;
  lyDo?: string | null;
  /** Câu hỏi người gõ — CLIENT gửi (không có sổ máy chủ). */
  cauHoi: string;
  /** Câu trả lời cuối — CLIENT gửi. */
  traLoi: string;
  duAn?: string | null;
}

/** Bỏ NUL (cột `text` Postgres từ chối `\u0000` ⇒ cả lượt ghi hỏng) rồi che, rồi cắt — cắt SAU che (che làm chuỗi dài ra). */
const cheVanBanClient = (s: string, tran: number) => che(s.replace(/\u0000/g, "")).slice(0, tran);

/**
 * Phiếu cho câu trả lời cuối của lượt agent cục bộ. `u` = CHỦ TOKEN (cửa REST đã kiểm token · `ai_repo_read/canView` ·
 * phạm vi `chat` · trần lượt) — thân yêu cầu không mang id người nào. Văn bản client gửi được che + cắt ở ĐÂY trước khi
 * tới tầng dữ liệu; tầng dữ liệu đặt `nguon = 'vscode'`.
 */
export async function thuTucPhanHoiClient(u: NguoiPhien, y: DauVaoPhanHoiClient, ghiVao?: GhiPhieuClient) {
  if (!Number.isInteger(u.id) || u.id <= 0) return { ok: false as const, note: "PERMISSION_DENIED" as const, phieu: null };
  const ghi = ghiVao ?? (await import("../../../db/aiAgentFeedback")).ghiPhieuTraLoiClient;
  const duAn = typeof y.duAn === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(y.duAn) ? y.duAn : null;
  const kq = await ghi({
    userId: u.id,
    luotClient: y.luotId,
    chiSoTin: y.chiSoKhoi,
    projectId: duAn,
    danhGia: y.danhGia,
    lyDo: lyDoSach(y.lyDo),
    cauHoi: cheVanBanClient(y.cauHoi, TRAN_KY_TU_CAU_HOI_CLIENT) || null,
    noiDung: cheVanBanClient(y.traLoi, TRAN_KY_TU_TRA_LOI_CLIENT) || null,
  });
  return kq.ok ? { ok: true as const, note: null, phieu: kq.hang } : { ok: false as const, note: "DB_LOI" as const, phieu: null };
}

/**
 * Ghi quyết định duyệt/bác của một đề xuất `apply_diff` — gọi SAU khi `confirmAction`/`cancelAction` thật đã chạy.
 * Đọc lại TRẠNG THÁI hàng (nguồn sự thật): `duyet` chỉ khi `executed`, `bac` chỉ khi `cancelled`. Không bao giờ ném.
 */
export async function ghiQuyetDinhTuCuaDuyet(
  u: NguoiPhien,
  actionId: string,
  quyetDinh: "duyet" | "bac",
  lyDoBac: string | null,
  ptVao?: PhuThuocPhanHoi,
): Promise<void> {
  try {
    const pt = ptVao ?? (await phuThuocThat());
    const a = await pt.layAction(actionId, u.id);
    if (!a) return;
    if (quyetDinh === "duyet" ? a.status !== "executed" : a.status !== "cancelled") return;
    const anh = anhChupTuAction(a);
    if (!anh) return;
    const run = await pt.timRun(u.id, actionId);
    await pt.ghiQuyetDinhDiff({
      userId: u.id,
      actionId,
      runId: run?.id ?? null,
      projectId: run?.projectId ?? null,
      cauHoi: cheCat(run?.cauHoi),
      noiDung: anh.noiDung,
      duongDan: anh.duongDan,
      quyetDinh,
      lyDoBac: quyetDinh === "bac" ? lyDoSach(lyDoBac) : null,
    });
  } catch (e) {
    console.warn("[phanHoi] ghi quyết định duyệt/bác hỏng (bỏ qua):", e instanceof Error ? e.message : e);
  }
}

export async function thuTucPhanHoiCuaToi(u: NguoiPhien, ptVao?: PhuThuocPhanHoi) {
  const pt = ptVao ?? (await phuThuocThat());
  if (!(await coQuyen(u, pt))) return { ok: false as const, note: "PERMISSION_DENIED" as const, phieu: [] as TomTatPhanHoi[] };
  return { ok: true as const, note: null, phieu: await pt.danhSachCuaToi(u.id) };
}

export async function thuTucTongHopPhanHoi(u: NguoiPhien, ptVao?: PhuThuocPhanHoi) {
  if (u.role !== "admin") return { ok: false as const, note: "PERMISSION_DENIED" as const, tongHop: null };
  const pt = ptVao ?? (await phuThuocThat());
  const t = await pt.tongHop();
  return t ? { ok: true as const, note: null, tongHop: t } : { ok: false as const, note: "DB_LOI" as const, tongHop: null };
}

/**
 * Bộ dữ liệu JSONL "chỉ dẫn → diff ĐƯỢC DUYỆT" (một mẫu mỗi dòng, `MauBoDuLieu`). Mặc định: chỉ của người gọi;
 * `tatCa` (mọi người) đòi admin. `soBoQua` = hàng ứng viên bị loại (tệp cấm / thiếu chỉ dẫn / thiếu diff).
 */
export async function thuTucXuatBoDuLieu(u: NguoiPhien, y: { tatCa?: boolean }, ptVao?: PhuThuocPhanHoi) {
  const pt = ptVao ?? (await phuThuocThat());
  if (y.tatCa && u.role !== "admin") return { ok: false as const, note: "PERMISSION_DENIED" as const, jsonl: "", soMau: 0, soBoQua: 0 };
  if (!(await coQuyen(u, pt))) return { ok: false as const, note: "PERMISSION_DENIED" as const, jsonl: "", soMau: 0, soBoQua: 0 };
  const hang = await pt.docHangChoXuat(y.tatCa ? null : u.id);
  const dong: string[] = [];
  let soByte = 0;
  let catBot = false;
  for (const h of hang) {
    const m = mauBoDuLieuTuHang(h, { duongDuocPhep, che });
    if (!m) continue;
    const s = JSON.stringify(m);
    // Trần một phản hồi tRPC: dừng TRƯỚC khi vượt (không cắt giữa một dòng JSONL) và nói ra là đã cắt.
    if (soByte + s.length + 1 > TRAN_KY_TU_XUAT) {
      catBot = true;
      break;
    }
    soByte += s.length + 1;
    dong.push(s);
  }
  return {
    ok: true as const,
    note: null,
    jsonl: dong.length ? `${dong.join("\n")}\n` : "",
    soMau: dong.length,
    soBoQua: catBot ? 0 : hang.length - dong.length,
    catBot,
  };
}
