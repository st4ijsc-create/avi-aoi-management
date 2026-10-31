/**
 * ★★★ Đợt 12 · H5.4 (2026-10-31) — CHUẨN BỊ BẢN LƯU lịch sử model của lượt agent (để "tiếp tục" lượt gián đoạn). Cờ host `AI_AGENT_TIEP_TUC=1` (MẶC ĐỊNH TẮT).
 *
 * BẤT BIẾN:
 *  1. Bản lưu do MÁY CHỦ dựng từ lịch sử vòng agent; không bao giờ nhận từ client (móc nội bộ, thủ tục tiếp tục chỉ đọc CSDL theo userId phiên).
 *  2. Che bí mật HAI lớp: kết quả tool đã qua `lamSachChoModel` của bộ thực thi; ở đây chạy lại `redactSecretsOnly` lên MỌI chuỗi (content · reasoning_content ·
 *     arguments của tool_calls) trước khi ghi.
 *  3. Trần: ≤ 400 tin và ≤ 400 000 byte serialize. Vượt byte ⇒ nén mạnh (`nenManh`: bỏ nghĩ cũ, rút kết quả tool cũ) rồi thử lại; vẫn vượt (hoặc quá 400 tin) ⇒
 *     `{ok:false}` và host XOÁ bản lưu của lượt (không giữ bản cũ lạc hậu — bản cũ + "kết cục không rõ" sẽ nói sai về trạng thái).
 */
import { nenManh, type TinNhan } from "@shared/agentCore";
import { redactSecretsOnly } from "../aiSafety";

export const TRAN_TIN_BAN_LUU = 400;
export const TRAN_BYTE_BAN_LUU = 400_000;

/** Công tắc `AI_AGENT_TIEP_TUC`: chỉ "1" bật (MẶC ĐỊNH TẮT). */
export function tiepTucBat(giaTri: string | undefined): boolean {
  return giaTri === "1";
}

const che = (s: string): string => redactSecretsOnly(s).text;

function cheTin(m: TinNhan): TinNhan {
  const ra: TinNhan = { ...m, content: che(String(m.content ?? "")) };
  if (typeof m.reasoning_content === "string") ra.reasoning_content = che(m.reasoning_content);
  if (m.tool_calls) ra.tool_calls = m.tool_calls.map((t) => ({ ...t, function: { ...t.function, arguments: che(t.function.arguments) } }));
  return ra;
}

export type KetQuaBanLuu = { ok: true; tinNhan: TinNhan[]; soByte: number } | { ok: false; ly: "qua-nhieu-tin" | "qua-lon" };

const kichThuoc = (ds: readonly TinNhan[]): number => Buffer.byteLength(JSON.stringify(ds), "utf8");

export function chuanBiBanLuu(tinNhan: readonly TinNhan[]): KetQuaBanLuu {
  let ds = tinNhan.filter((m) => m.role !== "system").map(cheTin);
  if (ds.length > TRAN_TIN_BAN_LUU) return { ok: false, ly: "qua-nhieu-tin" };
  let byte = kichThuoc(ds);
  if (byte > TRAN_BYTE_BAN_LUU) {
    ds = nenManh(ds).tinNhan;
    byte = kichThuoc(ds);
  }
  if (byte > TRAN_BYTE_BAN_LUU) return { ok: false, ly: "qua-lon" };
  return { ok: true, tinNhan: ds, soByte: byte };
}
