/**
 * ★ Đợt 10.4b L3 — ĐƯỜNG VÀO lượt agent máy chủ với model NGOÀI (`chonModel: "ngoai:<ncc>:<model>"`), hợp đồng
 * `docs/superpowers/plans/2026-10-30-dot10-4b-L3-agent-ngoai-hop-dong.md` §1 + §0 (n1). Mọi kiểm ở đây chạy TRƯỚC khi giữ chỗ lượt chạy /
 * tạo hàng sổ / gọi mạng — từ chối = mã + HTTP, không SSE, không phí:
 *   (a) bề mặt `agent` phải nằm trong `BE_MAT_NGOAI_DUOC_DUNG` ⇒ 404 `CHON_MODEL_KHONG_CO` (như trước L3; k7: CHƯA mở tới khi L3b xong);
 *   (b) chỉ `cheDo: "hoi"` ⇒ 400 `NGOAI_CHI_HOI` (`sua` / `tu-dong` khoá với model ngoài);
 *   (c) đúng MỘT nhà máy · model có trong danh mục nhà máy · `sessionId` (nếu có) là phiên của CHÍNH người gọi, cùng dự án ⇒ 404
 *       `NGOAI_KHONG_TON_TAI` (dự án danh sách trắng đã kiểm ở `taoLuotChay`);
 *   (d) `kiemTruocNgoai` (cổng tắt / trần / nhà máy / mức dữ liệu) ⇒ mã cổng theo `HTTP_LOI_TRUOC_SSE`, kèm `tranVuot` khi vượt trần;
 *   (e) mức: KHÔNG lịch sử client VÀ phiên chưa có lượt ⇒ `ky-thuat`; ngược lại `van-hanh` ⇒ đòi `xacNhanVanHanh === true`, thiếu ⇒ 428
 *       `CAN_XAC_NHAN_VAN_HANH` (k3: lịch sử của PHIÊN phía máy chủ tính như lịch sử client — mọi nguồn lịch sử);
 *   (f) `DANG_CO_LUOT_CHAY` — kiểm ở `taoLuotChay` ngay sau bước này (chung với đường cục bộ).
 * Định nghĩa agent từ repo (`.thoca/agents`, `tuRepo`) chỉ vào được qua `delegate`; lượt ngoài KHÔNG có `delegate` (`choPhepGiaoViec`) và
 * yêu cầu tạo lượt KHÔNG có trường chọn agent ⇒ không đường nào đưa định nghĩa repo vào thân gửi ra (k2 — lưới ghim).
 * ⚠ n7 (giới hạn CÓ GHI): `YeuCauGoiNgoai` chưa nhận `signal` ⇒ huỷ chỉ chặn TRƯỚC mỗi vòng (bộ chuyển `vongAgentNgoai`); một cuộc gọi đang
 *   bay chạy hết (tính phí, khoá bay nhả ở `finally` của cổng) rồi lõi dừng `huy`. L2 cùng giới hạn.
 */
import type { TinNhan } from "@shared/agentCore";
import { HTTP_LOI_TRUOC_SSE, MA_CAN_XAC_NHAN_VAN_HANH, type MucDuLieuChung, type TranVuot } from "../../../../shared/ai/sinhChuNgoai";
import type { KetQuaGoiNgoai, KiemTruocNgoai, YeuCauGoiNgoai } from "../ngoai/congNgoai";
import type { KetQuaTool, NguoiGoi, TrongThaiDoc } from "../ngoai/congCuDocNgoai";
import { ghepPhan, type TinGhep } from "../ngoai/ghepPhan";
import { LoiNgoai } from "../ngoai/loi";
import { MAX_TOKENS_AGENT_NGOAI } from "../ngoai/vongAgentNgoai";
import { NGUON_MUC_LUOT_AGENT } from "../chonModel/kieu";

/** Bề mặt trong `BE_MAT_NGOAI_DUOC_DUNG` cho lượt agent máy chủ (nguồn mức ở cổng: `NGUON_MUC_LUOT_AGENT`, `chonModel/kieu.ts`). */
export const BE_MAT_AGENT = "agent";

export function laChonModelNgoai(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().toLowerCase().startsWith("ngoai:");
}

export interface PhuThuocLuotNgoai {
  beMatMo: () => Promise<readonly string[]>;
  nhaMayCua: (user: NguoiGoi) => Promise<number[] | null>;
  coTrongDanhMuc: (chonModel: string, factoryId: number) => Promise<{ nhaCungCap: string; model: string } | null>;
  /** Phiên của CHÍNH người gọi: dự án + số lượt đã có; không phải của người này / không tồn tại ⇒ `null`. */
  phien: (userId: number, sessionId: string) => Promise<{ projectId: string | null; soLuot: number } | null>;
  /** Đặt `ai_coding_sessions."coLuotNgoai" = true` (lọc userId). */
  datCoPhien: (userId: number, sessionId: string) => Promise<void>;
  kiemTruoc: (yc: YeuCauGoiNgoai) => Promise<KiemTruocNgoai>;
  goi: (yc: YeuCauGoiNgoai) => Promise<KetQuaGoiNgoai>;
  chayTool: (ten: string, thamSo: Record<string, unknown>, o: { goc: string; user: NguoiGoi; doc: TrongThaiDoc }) => Promise<KetQuaTool>;
}

export interface LuotNgoaiSanSang {
  ok: true;
  chonModel: string;
  dich: { nhaCungCap: string; model: string };
  nhaMay: number;
  muc: MucDuLieuChung;
  doc: TrongThaiDoc;
}
export interface LuotNgoaiTuChoi {
  ok: false;
  ma: string;
  http: number;
  thongDiep?: string;
  muc?: MucDuLieuChung;
  tranVuot?: TranVuot;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tuChoi = (ma: string, them: Partial<LuotNgoaiTuChoi> = {}): LuotNgoaiTuChoi => ({ ok: false, ma, http: HTTP_LOI_TRUOC_SSE[ma] ?? 400, ...them });

/** Bước (a)–(e) của §1. `lichSu` = ĐÚNG lịch sử sẽ đưa vào vòng (đã lọc `locLichSu`). */
export async function chuanBiLuotNgoai(
  y: {
    user: NguoiGoi;
    chonModel: string;
    cheDo: string;
    projectId: string;
    sessionId: string | null;
    cauHoi: string;
    lichSu: readonly TinNhan[];
    xacNhanVanHanh: unknown;
  },
  dep: PhuThuocLuotNgoai,
): Promise<LuotNgoaiSanSang | LuotNgoaiTuChoi> {
  // (a)
  if (!(await dep.beMatMo()).includes(BE_MAT_AGENT)) return { ok: false, ma: "CHON_MODEL_KHONG_CO", http: 404, thongDiep: "model ngoài chưa được cài đặt" };
  // (b)
  if (y.cheDo !== "hoi") return tuChoi("NGOAI_CHI_HOI", { http: 400 });
  // (c)
  let soLuotPhien = 0;
  if (y.sessionId !== null) {
    if (!RE_UUID.test(y.sessionId)) return tuChoi("NGOAI_KHONG_TON_TAI");
    const p = await dep.phien(y.user.id, y.sessionId);
    if (!p || (p.projectId !== null && p.projectId !== y.projectId)) return tuChoi("NGOAI_KHONG_TON_TAI");
    soLuotPhien = p.soLuot;
  }
  const nm = await dep.nhaMayCua(y.user);
  if (!nm || nm.length !== 1) return tuChoi("NGOAI_KHONG_TON_TAI");
  const F = nm[0]!;
  const dich = await dep.coTrongDanhMuc(y.chonModel, F);
  if (!dich) return tuChoi("NGOAI_KHONG_TON_TAI");
  // (d) — yêu cầu kiểm trước dựng QUA bộ dựng, đúng nguồn gốc như vòng đầu (hướng dẫn tĩnh · lịch sử · câu gõ).
  const ds: TinGhep[] = [
    { vaiTro: "system", phan: [{ loai: "huong-dan-tinh", noiDung: "agent" }] },
    ...y.lichSu.map((m) => ({ vaiTro: m.role, phan: [{ loai: "lich-su-client" as const, noiDung: m.content }] })),
    { vaiTro: "user", phan: [{ loai: "cau-go-lap-trinh", noiDung: y.cauHoi }] },
  ];
  const coLichSu = y.lichSu.length > 0 || soLuotPhien > 0;
  const g = ghepPhan(ds);
  // phiên đã có lượt mà client không gửi lịch sử ⇒ vẫn khai `van-hanh` với cổng (sàn mức — không hạ được bằng cách bỏ lịch sử)
  const phanDaGhep = coLichSu ? [...g.phanDaGhep, "van-hanh" as const] : [...g.phanDaGhep];
  let k: KiemTruocNgoai;
  try {
    k = await dep.kiemTruoc({
      dich,
      tinNhan: g.tinNhan,
      maxTokens: MAX_TOKENS_AGENT_NGOAI,
      mucDich: "agent",
      ngu: {
        userId: y.user.id,
        flowId: null,
        runId: null,
        tuDong: false,
        nhaMayNguoiGoi: [F],
        nhaMayChuDuLieu: [F],
        nguonMuc: { loai: "be-mat", beMat: NGUON_MUC_LUOT_AGENT, phanDaGhep },
      },
    });
  } catch (e) {
    if (!(e instanceof LoiNgoai)) throw e;
    return tuChoi(e.ma, e.ma === "NGOAI_VUOT_TRAN" && e.chiTiet ? { tranVuot: e.chiTiet as TranVuot } : {});
  }
  // (e)
  const muc: MucDuLieuChung = coLichSu || g.muc === "van-hanh" || k.muc === "van-hanh" ? "van-hanh" : "ky-thuat";
  if (muc === "van-hanh" && y.xacNhanVanHanh !== true) return tuChoi(MA_CAN_XAC_NHAN_VAN_HANH, { muc });
  const cfg = (k as { cfg?: { tranByteDocLuot?: number; tranTepDocLuot?: number } }).cfg ?? {};
  return {
    ok: true,
    chonModel: y.chonModel,
    dich,
    nhaMay: F,
    muc,
    doc: { byte: 0, tep: 0, tranByte: cfg.tranByteDocLuot ?? 262_144, tranTep: cfg.tranTepDocLuot ?? 50 },
  };
}

/** Phụ thuộc THẬT — dùng lại bộ của L2 (`codingNgoai.ts`) cho danh mục / nhà máy / cổng / bộ đọc; phiên qua `aiPhien` (lọc chủ). */
export async function phuThuocLuotNgoaiThat(): Promise<PhuThuocLuotNgoai> {
  const [{ phuThuocCodingNgoaiThat }, phienKho] = await Promise.all([import("../../../routes/codingNgoai"), import("../../../db/aiPhien")]);
  return {
    beMatMo: phuThuocCodingNgoaiThat.beMatMo,
    nhaMayCua: phuThuocCodingNgoaiThat.nhaMayCua,
    coTrongDanhMuc: phuThuocCodingNgoaiThat.coTrongDanhMuc,
    phien: async (userId, sessionId) => {
      const m = await phienKho.mo(userId, sessionId);
      return m.ok ? { projectId: m.phien.projectId, soLuot: m.phien.turnCount } : null;
    },
    datCoPhien: async (userId, sessionId) => {
      const [{ getDb }, { aiCodingSessions }, { and, eq }] = await Promise.all([
        import("../../../db/connection"),
        import("../../../../drizzle/schema/aiCodingSession"),
        import("drizzle-orm"),
      ]);
      const db = await getDb();
      if (db) await db.update(aiCodingSessions).set({ coLuotNgoai: true }).where(and(eq(aiCodingSessions.id, sessionId), eq(aiCodingSessions.userId, userId)));
    },
    kiemTruoc: phuThuocCodingNgoaiThat.kiemTruoc,
    goi: phuThuocCodingNgoaiThat.goi,
    chayTool: phuThuocCodingNgoaiThat.chayTool,
  };
}
