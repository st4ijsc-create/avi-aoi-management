/**
 * shared/agentCore — quản lý ngữ cảnh (spec Đợt 1 §3 "Ngữ cảnh 64k").
 *
 * - `catDauDuoi`: cắt một kết quả tool dài, giữ ĐẦU + ĐUÔI (lỗi thường ở cuối đầu ra lệnh, khai báo ở đầu tệp).
 * - `nenLichSu`: khi tổng ước lượng > ngưỡng (70 %) ngân sách ⇒ thay nội dung kết quả tool CŨ (cũ nhất trước, trừ 2
 *   lượt gần nhất) bằng một dòng `[compacted: <tool> <đường> — <n> chars]`, chỉ tới khi xuống dưới ngưỡng.
 *   Bất biến: KHÔNG bỏ/sửa system và câu hỏi gốc (mọi tin không phải `tool`); KHÔNG xoá tin (tool_call_id luôn khớp);
 *   2 lượt (assistant + kết quả tool của nó) gần nhất giữ nguyên văn; không đột biến đầu vào.
 * - Ước lượng token được TIÊM (server truyền `uocLuongSoToken` của aiLlamaServerClient); mặc định cùng công thức
 *   2,8 ký tự/token để lõi tự đứng được ở extension VSCode.
 */
import type { TinNhan } from "./kieu";

export type UocLuongToken = (s: string) => number;

/** Mặc định: 2,8 ký tự / token, làm tròn lên, số nguyên (cùng công thức `uocLuongSoToken` của server). */
export const uocLuongTokenMacDinh: UocLuongToken = (s) => {
  const n = String(s ?? "").length;
  return n === 0 ? 0 : Math.ceil((n * 10) / 28);
};

/** Phụ phí khung chat mỗi tin (role, dấu phân tách của chat template) — ước lượng thô, cố định. */
const PHU_PHI_MOI_TIN = 4;

export function uocLuongTinNhan(ds: TinNhan[], uocLuong: UocLuongToken = uocLuongTokenMacDinh): number {
  let tong = 0;
  for (const m of ds) {
    tong += PHU_PHI_MOI_TIN + uocLuong(m.content ?? "");
    for (const t of m.tool_calls ?? []) tong += uocLuong(t.function.name) + uocLuong(t.function.arguments);
  }
  return tong;
}

/** Cắt chuỗi dài: giữ ~60 % trần ở đầu + ~40 % ở đuôi, chèn dấu cắt nêu số ký tự bỏ. */
export function catDauDuoi(s: string, tran: number): string {
  if (s.length <= tran) return s;
  const dau = Math.ceil(tran * 0.6);
  const duoi = Math.max(0, tran - dau);
  const bo = s.length - dau - duoi;
  return `${s.slice(0, dau)}\n…[${bo} chars omitted]…\n${duoi > 0 ? s.slice(-duoi) : ""}`;
}

export interface TuyChonNen {
  nganSachToken: number;
  uocLuong?: UocLuongToken;
  /** tỉ lệ ngân sách kích hoạt nén (mặc định 0,7) */
  nguong?: number;
  /** số lượt assistant gần nhất giữ nguyên (mặc định 2) */
  soLuotGiu?: number;
}

export interface KetQuaNen {
  tinNhan: TinNhan[];
  soNen: number;
  tokenTruoc: number;
  tokenSau: number;
}

function duongTuThamSo(args: string): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>;
    const d = o?.path ?? o?.from ?? o?.pattern ?? o?.command ?? o?.name ?? o?.query;
    return typeof d === "string" ? d : "";
  } catch {
    return "";
  }
}

export function nenLichSu(tinNhan: TinNhan[], tc: TuyChonNen): KetQuaNen {
  const uoc = tc.uocLuong ?? uocLuongTokenMacDinh;
  const nguong = Math.floor(tc.nganSachToken * (tc.nguong ?? 0.7));
  const soLuotGiu = tc.soLuotGiu ?? 2;
  const tokenTruoc = uocLuongTinNhan(tinNhan, uoc);
  if (tokenTruoc <= nguong) return { tinNhan: tinNhan.slice(), soNen: 0, tokenTruoc, tokenSau: tokenTruoc };

  // ranh giới bảo vệ: chỉ số của assistant thứ `soLuotGiu` tính từ cuối — mọi tin từ đó trở đi giữ nguyên
  const chiSoAssistant = tinNhan.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  const ranhGioi = chiSoAssistant.length >= soLuotGiu ? chiSoAssistant[chiSoAssistant.length - soLuotGiu] : 0;

  const goiTheoId = new Map<string, { ten: string; duong: string }>();
  for (const m of tinNhan)
    for (const t of m.tool_calls ?? []) goiTheoId.set(t.id, { ten: t.function.name, duong: duongTuThamSo(t.function.arguments) });

  const ra = tinNhan.slice();
  let tong = tokenTruoc;
  let soNen = 0;
  for (let i = 0; i < ranhGioi && tong > nguong; i++) {
    const m = ra[i];
    if (m.role !== "tool" || m.content.startsWith("[compacted:")) continue;
    const goi = m.tool_call_id ? goiTheoId.get(m.tool_call_id) : undefined;
    const ten = goi?.ten ?? m.name ?? "tool";
    const nhan = `[compacted: ${ten}${goi?.duong ? ` ${goi.duong}` : ""} — ${m.content.length} chars; call the tool again if you need it]`;
    if (nhan.length >= m.content.length) continue;
    tong += uoc(nhan) - uoc(m.content);
    ra[i] = { ...m, content: nhan };
    soNen++;
  }
  return { tinNhan: ra, soNen, tokenTruoc, tokenSau: tong };
}
