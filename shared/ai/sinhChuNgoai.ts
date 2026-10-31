/**
 * Đợt 10.4b L0a' — HỢP ĐỒNG máy chủ ↔ client cho SINH CHỮ bằng model NGOÀI (chat / KB / coding / agent). MỘT nguồn kiểu cho cả hai phía
 * (chốt với luong-ui 2026-10-27, kế hoạch `docs/superpowers/plans/2026-10-27-dot10-4b-sinh-chu-model-ngoai.md` §5).
 *
 *   • `aiChonModel.thongTinNgoai` — CHỈ THÔNG TIN (không giữ chỗ, không gọi mạng), quyền tối thiểu (dieu-phoi Q2b): số tuyệt đối token / USD
 *     của NHÀ MÁY chỉ có khi admin.
 *   • Lỗi biết được TRƯỚC khi gọi nhà cung cấp ⇒ JSON trước khi mở SSE (`LoiTruocSse`). `CAN_XAC_NHAN_VAN_HANH` (428) — client hỏi người
 *     dùng MỘT lần mỗi hội thoại rồi gửi lại với `context.xacNhanVanHanh: true` ở MỌI lượt sau (máy chủ không giữ trạng thái; cờ chỉ là UX,
 *     không hạ được mức, không vượt được 403 `NGOAI_DU_LIEU_VAN_HANH`).
 *   • SSE: khung `meta.ngoai`, `done.vet`, `error.{code,tranVuot,vet}` — KHÔNG thêm loại sự kiện mới. Nhịp sống: dòng comment `: ping`.
 *   • Lịch sử: `aiChat.getMessages` trả `nguonModel` + `vetNgoai` (máy chủ ghi, client KHÔNG khai). `saveStreamedMessage` nhận `ngoaiCallId`.
 */
import { z } from "zod";

export const BE_MAT_SINH_CHU_NGOAI = ["chat", "coding", "agent"] as const;
export type BeMatSinhChuNgoai = (typeof BE_MAT_SINH_CHU_NGOAI)[number];

export const MUC_DU_LIEU = ["ky-thuat", "van-hanh"] as const;
export type MucDuLieuChung = (typeof MUC_DU_LIEU)[number];

/** Trần nào bị vượt (cho UI nói đúng): mỗi lượt · ngày nhà máy · ngày người · ngày luồng · số lần / phút. */
export const TRAN_VUOT = ["luot", "nha-may", "nguoi", "luong", "lan-phut"] as const;
export type TranVuot = (typeof TRAN_VUOT)[number];

/** Chuỗi chọn model ngoài: `ngoai:<nhà cung cấp>:<model>` — CÙNG hình dạng nhánh `ngoai:` của `CHON_MODEL_RE` (server/services/ai/chonModel/kieu.ts; lưới ghim). */
export const RE_CHON_MODEL_NGOAI = /^ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:-]{1,96}$/;

export const thongTinNgoaiInput = z
  .object({
    chonModel: z.string().max(120).regex(RE_CHON_MODEL_NGOAI),
    beMat: z.enum(BE_MAT_SINH_CHU_NGOAI),
  })
  .strict();
export type ThongTinNgoaiInput = z.infer<typeof thongTinNgoaiInput>;

export interface ConLaiTranNgay {
  nguoi: { token: number | null };
  /** `token` / `usd` CHỈ khi admin (vắng ⇒ client không hiện số). */
  nhaMay: { duTranChoLuotNay: boolean; token?: number | null; usd?: number | null };
}

export interface ThongTinNgoai {
  nhaCungCap: string;
  model: string;
  duocPhep: boolean;
  /** Mã `MaLoiNgoai` khi không được phép (vd `NGOAI_DU_LIEU_VAN_HANH`, `NGOAI_VUOT_TRAN`, `NGOAI_KHONG_TON_TAI`). */
  lyDo?: string;
  tranVuot?: TranVuot;
  /** Mức máy chủ suy cho bề mặt: chat ⇒ luôn `van-hanh` (câu người gõ ở trợ lý vận hành). */
  mucDuLieu: MucDuLieuChung;
  /** Nhà máy của người gọi đã cho dữ liệu vận hành ra ngoài chưa (chính sách — mọi người dùng trong phạm vi được biết). */
  choDuLieuVanHanh: boolean;
  conLaiTranNgay: ConLaiTranNgay;
  dinhKemBiCam: true;
}

/** Mã lỗi trước SSE riêng của sinh chữ (ngoài `MaLoiNgoai` của cổng). */
export const MA_CAN_XAC_NHAN_VAN_HANH = "CAN_XAC_NHAN_VAN_HANH" as const;

/** Thân JSON lỗi TRƯỚC khi mở SSE. HTTP: 428 xác nhận · 403 vận hành chưa cho / chưa duyệt · 404 không tồn tại / tắt · 429 vượt trần · 409 đang bay. */
export interface LoiTruocSse {
  success: false;
  code: typeof MA_CAN_XAC_NHAN_VAN_HANH | string;
  error?: string;
  muc?: MucDuLieuChung;
  tranVuot?: TranVuot;
}

export const HTTP_LOI_TRUOC_SSE: Readonly<Record<string, number>> = Object.freeze({
  CAN_XAC_NHAN_VAN_HANH: 428,
  NGOAI_DU_LIEU_VAN_HANH: 403,
  NGOAI_CHUA_DUYET: 403,
  NGOAI_TAT: 404,
  NGOAI_KHONG_TON_TAI: 404,
  NGOAI_VUOT_TRAN: 429,
  NGOAI_DANG_CHAY: 409,
  NGOAI_CAM_DINH_KEM: 400,
  NGOAI_QUA_LON: 413,
});

/** Vết lượt ngoài do MÁY CHỦ trả (huy hiệu `<model> · ~N token · ~$X`); `callId` chuyển vào `saveStreamedMessage.ngoaiCallId`. */
export interface VetNgoai {
  nhaCungCap: string;
  model: string;
  tokenVao: number | null;
  tokenRa: number | null;
  chiPhiUocUsd: number | null;
  callId: number;
}

/** Vết hiển thị lịch sử (`getMessages`) — JOIN sổ cổng; không có `callId` (client không cần). */
export type VetNgoaiLichSu = Omit<VetNgoai, "callId">;

/** `ngoai:<nhà cung cấp>:<model>` khi tin trợ lý do model ngoài sinh (máy chủ đã xác minh), `null` = cục bộ. */
export type NguonModel = string | null;

/**
 * Hình dạng `nguonModel` — MỘT nguồn cho mã ghi và CHECK `ai_chat_messages_nguon_model_chk` (migration 0417; lưới ghim chuỗi trong SQL).
 * Rộng hơn `RE_CHON_MODEL_NGOAI` ở phần model: thêm `/` và `@` (id OpenAI-compatible `meta-llama/Llama-3.3-70B`, Vertex `claude-…@2025…`).
 */
export const MAU_NGUON_MODEL = "^ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:/@-]{1,96}$";
export const RE_NGUON_MODEL = new RegExp(MAU_NGUON_MODEL);
