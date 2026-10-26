/**
 * ★ Đợt 10.3 — phần dùng chung của các bản cài nhà cung cấp: lỗi HTTP ⇒ `LoiNgoai` (thông điệp THÔ — cổng che bằng `cheChuoi` trước
 * khi ném / ghi), số token, lịch sử chữ (công cụ cũ đã là dòng chữ — giới hạn đã ghi: model ngoài KHÔNG thấy tool_use gốc).
 */
import { LoiNgoai } from "../loi";
import type { TinNhanNgoai } from "./kieu";

export function loiHttp(status: number, json: unknown): LoiNgoai {
  const j = json as { error?: { message?: unknown; type?: unknown } | string; message?: unknown } | null;
  const thongDiep = typeof j?.error === "string" ? j.error : String((j?.error as { message?: unknown })?.message ?? j?.message ?? "");
  return new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", `${status} ${thongDiep}`.slice(0, 800), { thuLai: status === 429 || status >= 500 });
}

export const so = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** System gộp; còn lại user / assistant xen kẽ (tin `tool` thành user "Kết quả công cụ …"); hai tin cùng vai liền nhau thì nối. */
export function lichSuXenKe(tinNhan: readonly TinNhanNgoai[]): { system: string; ds: Array<{ vai: "user" | "assistant"; chu: string }> } {
  const system = tinNhan.filter((m) => m.vaiTro === "system").map((m) => m.noiDung).join("\n\n");
  const ds: Array<{ vai: "user" | "assistant"; chu: string }> = [];
  for (const m of tinNhan) {
    if (m.vaiTro === "system") continue;
    const vai = m.vaiTro === "assistant" ? "assistant" : "user";
    const chu = m.vaiTro === "tool" ? `Kết quả công cụ ${m.tenTool ?? ""}:\n${m.noiDung}` : m.noiDung;
    const cuoi = ds[ds.length - 1];
    if (cuoi && cuoi.vai === vai) cuoi.chu += `\n\n${chu}`;
    else ds.push({ vai, chu });
  }
  if (!ds.length || ds[0]!.vai !== "user") ds.unshift({ vai: "user", chu: "(bắt đầu)" });
  return { system, ds };
}
