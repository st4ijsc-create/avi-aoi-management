/**
 * ★★★ ĐỢT 10.4b-E — MODEL NGOÀI trong extension, CHỈ ở đường HỎI (Trợ lý = L1): logic THUẦN (không biết `vscode`).
 *
 * Ràng buộc đã chốt (kế hoạch 10.4b D8/D6, dieu-phoi 2026-10-30):
 *   · CHỈ Hỏi — Agent KHÔNG dùng model ngoài (`laChonNgoai` ⇒ bangChat từ chối chạy agent); chưa có bằng chứng live trên host.
 *   · Thân gửi đi TỐI GIẢN: câu hỏi + lịch sử cuộc trò chuyện + cờ — KHÔNG ngữ cảnh workspace (tệp đang mở/vùng chọn/@mention/đính kèm/git
 *     diff/Problems/terminal), KHÔNG dạy giao thức công cụ, KHÔNG MCP, KHÔNG bộ nhớ dài hạn ⇒ không có tệp nào để lọc, deny-list vì thế
 *     không thể bị lách (và `shared/aiNgoaiDenyList.ts` vẫn là bộ dùng chung nếu sau này mở tool đọc).
 *   · Đồng ý theo PHIÊN: máy chủ trả 428 `CAN_XAC_NHAN_VAN_HANH` ở lượt đầu ⇒ hỏi người dùng MỘT lần cho (hội thoại, model); đổi model ⇒ hỏi lại.
 *   · Huy hiệu NGUỒN (`meta.ngoai`, `done.vet`) và bộ render KHÔNG TIN CẬY: liên kết thành chữ + tên miền, mã điều khiển hai chiều bị bỏ.
 */
import { CHON_MODEL_RE } from "./chonModel";
import type { NutMd } from "./markdownAnToan";
import type { LuotChat } from "./yeuCau";

export const MA_CAN_XAC_NHAN_VAN_HANH = "CAN_XAC_NHAN_VAN_HANH";

export function laChonNgoai(ma: unknown): ma is string {
  return typeof ma === "string" && ma.startsWith("ngoai:") && CHON_MODEL_RE.test(ma);
}

/** Thân `/api/ai/local-kb/stream` cho model ngoài. KHÔNG có `nguCanh`, KHÔNG `codingMode`, KHÔNG `projectId`. */
export function dungThanNgoai(dv: {
  cauHoi: string;
  lichSu: readonly LuotChat[];
  ngonNgu: string;
  chonModel: string;
  conversationId: number;
  xacNhanVanHanh: boolean;
}): Record<string, unknown> {
  const context: Record<string, unknown> = {
    route: "vscode",
    uiLanguage: dv.ngonNgu,
    chonModel: dv.chonModel,
    conversationId: dv.conversationId,
  };
  if (dv.xacNhanVanHanh) context.xacNhanVanHanh = true;
  return { question: dv.cauHoi, history: dv.lichSu.map((l) => ({ role: l.role, content: l.content })), userRole: "engineer", context };
}

export interface LoiTruocSseNgoai {
  status: number;
  code: string;
  tranVuot?: string;
}

/** Đọc thân JSON lỗi TRƯỚC SSE. Không phải hình dạng `LoiTruocSse` (`code` chuỗi in hoa) ⇒ `null`. */
export function docLoiTruocSse(status: number, than: unknown): LoiTruocSseNgoai | null {
  if (!than || typeof than !== "object") return null;
  const o = than as Record<string, unknown>;
  if (typeof o.code !== "string" || !/^[A-Z_]{3,48}$/.test(o.code)) return null;
  return { status, code: o.code, ...(typeof o.tranVuot === "string" ? { tranVuot: o.tranVuot } : {}) };
}

export const canXacNhanVanHanh = (l: LoiTruocSseNgoai | null): boolean => !!l && l.status === 428 && l.code === MA_CAN_XAC_NHAN_VAN_HANH;

const TEN_TRAN: Record<string, string> = {
  luot: "trần của mỗi lượt",
  "nha-may": "trần trong ngày của nhà máy",
  nguoi: "trần trong ngày của bạn",
  luong: "trần trong ngày của luồng",
  "lan-phut": "số lần gọi mỗi phút",
};

const LOI_TEXT: Record<string, string> = {
  NGOAI_DU_LIEU_VAN_HANH: "Nhà máy của bạn chưa cho phép gửi dữ liệu vận hành ra model ngoài — nhờ quản trị bật, hoặc chọn model nội bộ.",
  NGOAI_CHUA_DUYET: "Model ngoài này chưa được duyệt cho bạn — chọn model nội bộ hoặc nhờ quản trị duyệt.",
  NGOAI_TAT: "Model ngoài này đang tắt.",
  NGOAI_KHONG_TON_TAI: "Model ngoài này không còn trong danh mục — chọn lại model.",
  NGOAI_DANG_CHAY: "Một lượt gọi model ngoài của hội thoại này đang chạy — đợi xong rồi hỏi tiếp.",
  NGOAI_CAM_DINH_KEM: "Model ngoài không nhận đính kèm — bỏ đính kèm hoặc chọn model nội bộ.",
  NGOAI_QUA_LON: "Câu hỏi + lịch sử quá dài cho model ngoài — mở chat mới hoặc rút gọn.",
};

/** Câu thân thiện (chữ thuần) cho mã lỗi model ngoài; mã lạ ⇒ câu chung KÈM mã (không bịa nguyên nhân). */
export function thongDiepLoiNgoai(code: string, tranVuot?: string): string {
  if (code === "NGOAI_VUOT_TRAN") return `Đã vượt ${(tranVuot && TEN_TRAN[tranVuot]) || "một trần sử dụng"} của model ngoài — thử lại sau hoặc chọn model nội bộ.`;
  return LOI_TEXT[code] ?? `Model ngoài báo lỗi (${code.slice(0, 48)}).`;
}

export interface VetNgoaiRut {
  nhaCungCap: string;
  model: string;
  tokenVao: number | null;
  tokenRa: number | null;
  chiPhiUocUsd: number | null;
}

const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const chu = (v: unknown, tran: number): string => (typeof v === "string" ? v.slice(0, tran) : "");

/** `done.vet` của máy chủ → vết sạch; thiếu/sai ⇒ `null` (huy hiệu rơi về `meta.ngoai`). */
export function docVet(v: unknown): VetNgoaiRut | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ncc = chu(o.nhaCungCap, 32);
  const model = chu(o.model, 96);
  if (!ncc || !model) return null;
  return { nhaCungCap: ncc, model, tokenVao: so(o.tokenVao), tokenRa: so(o.tokenRa), chiPhiUocUsd: so(o.chiPhiUocUsd) };
}

/** Huy hiệu nguồn: «Model ngoài · <ncc>/<model>» + «~N token · ~$X» khi có. Chữ thuần. */
export function huyHieuNguon(ncc: string, model: string, vet?: VetNgoaiRut | null): string {
  const phan = [`Model ngoài · ${ncc}/${model}`];
  const tong = vet && vet.tokenVao !== null && vet.tokenRa !== null ? vet.tokenVao + vet.tokenRa : null;
  if (tong !== null) phan.push(`~${tong} token`);
  if (vet && vet.chiPhiUocUsd !== null) phan.push(`~$${vet.chiPhiUocUsd.toFixed(vet.chiPhiUocUsd < 0.01 ? 4 : 2)}`);
  return phan.join(" · ");
}

/** Khoá đồng ý: theo (hội thoại cục bộ, model). Đổi model/nhà cung cấp ⇒ khoá khác ⇒ hỏi lại. */
export const khoaDongY = (maHoiThoai: string, chonModel: string): string => `${maHoiThoai}\u0000${chonModel}`;

// eslint-disable-next-line no-misleading-character-class
const MA_DIEU_KHIEN_HAI_CHIEU = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
/** Bỏ ký tự điều khiển hai chiều / độ rộng bằng không (che lừa đảo bằng đảo chiều chữ). */
export const lamSachVanBanNgoai = (s: string): string => s.replace(MA_DIEU_KHIEN_HAI_CHIEU, "");

function tenMien(href: string): string {
  try {
    return new URL(href).hostname || "";
  } catch {
    return "";
  }
}

/** Cây markdown KHÔNG TIN CẬY: mọi liên kết thành chữ «nhãn (miền)» — không có nút bấm nào dẫn ra ngoài. */
export function lamKhongTinCay(cay: NutMd[]): NutMd[] {
  const di = (ds: NutMd[]): NutMd[] =>
    ds.flatMap((n): NutMd[] => {
      if (n.t === "a") {
        const mien = tenMien(n.href);
        return [...di(n.con), { t: "text", chu: mien ? ` (${mien})` : "" }];
      }
      if ("con" in n) return [{ ...n, con: di(n.con) } as NutMd];
      if (n.t === "table") return [{ ...n, dau: n.dau.map(di), hang: n.hang.map((h) => h.map(di)) }];
      return [n];
    });
  return di(cay);
}
