/**
 * Đợt 10.4b L4 — phần THUẦN của bong bóng trợ lý khi dùng model NGOÀI (hợp đồng docs/HOP_DONG_10_4B_L4_BONG_BONG.md).
 *   • `dungNguCanhNgoai`: `context` gửi `/api/ai/local-kb/stream` ở nhánh ngoài CHỈ gồm tập khoá L1 cho phép — KHÔNG máy/nhà máy đang chọn, KHÔNG tên trang,
 *     KHÔNG đính kèm/ảnh/selection (rà kiem-dinh L4 (a)). `route` là HẰNG của bề mặt `/ai-chat` (không phải trang người dùng đang đứng).
 *   • `lichSuNgoai`: lịch sử gửi kèm = CHỈ các lượt thuộc ĐÚNG hội thoại ngoài hiện tại (hội thoại ngoài bắt đầu SẠCH; lượt cục bộ trước đó không sang nhà cung cấp — T16).
 *   • `catVanBan`: trần 16 KB theo BYTE UTF-8 trên TỔNG `cauHoi`+`traLoi` (do-model 2026-11-03), không cắt giữa ký tự nhiều byte; ưu tiên giữ `traLoi`.
 */
import { tachMaNgoai } from "@/lib/dongYNgoai";
import type { KbConversationTurn, KbStreamContext } from "@/hooks/useKbChatStream";

/** Trần byte của nguồn `van-ban` (tổng cauHoi+traLoi). */
export const TRAN_VAN_BAN_BYTE = 16 * 1024;
/** Bề mặt cố định gửi lên máy chủ (không phải trang người dùng đang đứng). */
export const ROUTE_BE_MAT_NGOAI = "/ai-chat";
/** Tập khoá `context` được phép ở nhánh ngoài của bong bóng (T3b so `toEqual`). */
export const KHOA_NGU_CANH_NGOAI = ["route", "uiLanguage", "chonModel", "conversationId", "xacNhanVanHanh"] as const;

export const laModelNgoai = (ma: string): boolean => ma !== "auto" && tachMaNgoai(ma) !== null;

export function dungNguCanhNgoai(a: { chonModel: string; conversationId: number; uiLanguage: string; xacNhanVanHanh: boolean }): KbStreamContext {
  return {
    route: ROUTE_BE_MAT_NGOAI,
    uiLanguage: a.uiLanguage,
    chonModel: a.chonModel,
    conversationId: a.conversationId,
    ...(a.xacNhanVanHanh ? { xacNhanVanHanh: true } : {}),
  };
}

/** Lượt của bong bóng đủ để dựng lịch sử: có `ngoaiConvId` đúng hội thoại, đã xong, có nội dung. */
export interface LuotBongBong {
  type: "user" | "assistant";
  content: string;
  streaming?: boolean;
  ngoaiConvId?: number;
}
export function lichSuNgoai(messages: readonly LuotBongBong[], conversationId: number, toiDa = 10): KbConversationTurn[] {
  return messages
    .filter((m) => !m.streaming && m.ngoaiConvId === conversationId && m.content.trim() !== "")
    .slice(-toiDa)
    .map((m) => ({ role: m.type === "user" ? "user" : "assistant", content: m.content }));
}

const mahoa = new TextEncoder();
const giaima = new TextDecoder("utf-8", { fatal: false });
export const demByte = (s: string): number => mahoa.encode(s).length;

/** Cắt `s` còn ≤ `toiDa` byte UTF-8, KHÔNG cắt giữa ký tự (cả cặp thay thế/emoji). */
export function catTheoByte(s: string, toiDa: number): { text: string; daCat: boolean } {
  if (toiDa <= 0) return { text: "", daCat: s.length > 0 };
  const b = mahoa.encode(s);
  if (b.length <= toiDa) return { text: s, daCat: false };
  let ket = toiDa;
  // lùi khỏi byte tiếp nối (10xxxxxx) để dừng ở ranh giới ký tự
  while (ket > 0 && (b[ket]! & 0xc0) === 0x80) ket--;
  return { text: giaima.decode(b.subarray(0, ket)), daCat: true };
}

export interface VanBanKiemDinh {
  cauHoi: string;
  traLoi: string;
  /** true nếu bất kỳ phần nào bị cắt (UI phải nói rõ + xem trước đúng chuỗi sẽ gửi). */
  daCat: boolean;
}
/** Tổng ≤ `tran` byte; giữ `traLoi` (tối đa `tran`), `cauHoi` lấy phần còn lại. */
export function catVanBan(a: { cauHoi: string; traLoi: string }, tran = TRAN_VAN_BAN_BYTE): VanBanKiemDinh {
  const tl = catTheoByte(a.traLoi, tran);
  const ch = catTheoByte(a.cauHoi, tran - demByte(tl.text));
  return { cauHoi: ch.text, traLoi: tl.text, daCat: tl.daCat || ch.daCat };
}

/**
 * Nhánh `van-ban` của nút kiểm định ở bong bóng (hợp đồng §7.3/§9, T9): cờ MẶC ĐỊNH TẮT — chỉ bật khi triển khai đặt `VITE_AI_BONG_BONG_VAN_BAN=true`
 * (nhà máy đã bật nguồn `van-ban` + bề mặt `bong-bong` phía máy chủ). Tắt ⇒ lượt chưa lưu KHÔNG có nút (hành vi L4 gốc).
 */
export function vanBanBongBongBat(): boolean {
  return import.meta.env.VITE_AI_BONG_BONG_VAN_BAN === "true";
}

/** Lượt trợ lý + lượt người dùng liền trước (đủ để dựng nguồn `van-ban`). */
export interface LuotVanBan extends LuotBongBong {
  id?: number | string;
  tinTraLoiId?: number;
}

/**
 * Dựng nguồn `van-ban` cho lượt `chi` của bong bóng, hoặc `null` (T13):
 *   • chỉ lượt trợ lý do model NGOÀI sinh (`ngoaiConvId` có), KHÔNG đang stream (kể cả đã abort giữa chừng — `streaming` còn true thì không gửi `traLoi` dở),
 *     nội dung không rỗng;
 *   • lượt ĐÃ LƯU (`tinTraLoiId`) đi nhánh `chat` theo ID — KHÔNG dùng `van-ban`;
 *   • `cauHoi` = lượt người dùng liền trước (rỗng nếu không có); cắt theo TỔNG byte UTF-8 (`catVanBan`), nói rõ `daCat`.
 */
export function dungNguonVanBan(messages: readonly LuotVanBan[], chi: number): { nguon: { loai: "van-ban"; beMat: "bong-bong"; cauHoi: string; traLoi: string }; daCat: boolean } | null {
  const m = messages[chi];
  if (!m || m.type !== "assistant" || m.streaming || m.ngoaiConvId === undefined || m.tinTraLoiId !== undefined) return null;
  if (m.content.trim() === "") return null;
  const truoc = messages[chi - 1];
  const cauHoi = truoc && truoc.type === "user" ? truoc.content : "";
  const c = catVanBan({ cauHoi, traLoi: m.content });
  if (c.traLoi.trim() === "") return null;
  return { nguon: { loai: "van-ban", beMat: "bong-bong", cauHoi: c.cauHoi, traLoi: c.traLoi }, daCat: c.daCat };
}

/**
 * Câu báo lỗi cho nhánh `van-ban` theo MÃ tRPC (T14) — KHÔNG bao giờ in `error.message` thô (thân lỗi có thể mang chữ nhà cung cấp).
 * Mã khác ⇒ `null` để nơi gọi dùng bộ dịch chung.
 */
export function maLoiVanBan(error: unknown): "loiQuaLon" | "loiKhongCo" | "loiVuotTran" | "loiDangChay" | null {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  switch (typeof data?.code === "string" ? data.code : "") {
    case "PAYLOAD_TOO_LARGE":
      return "loiQuaLon";
    case "NOT_FOUND":
    case "FORBIDDEN":
      return "loiKhongCo";
    case "TOO_MANY_REQUESTS":
      return "loiVuotTran";
    case "CONFLICT":
      return "loiDangChay";
    default:
      return null;
  }
}
