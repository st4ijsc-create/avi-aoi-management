/**
 * ★★★ Đợt 12 · H5.4 (2026-10-31) — phần THUẦN của "TIẾP TỤC LƯỢT": chuẩn hoá lịch sử đã lưu thành lịch sử HỢP LỆ cho model, trung thực về những gì
 * KHÔNG biết. Bản lưu được chụp ở ranh giới an toàn của vòng: (a) ngay sau khi tin assistant (kèm tool_calls) được thêm, TRƯỚC khi tool chạy;
 * (b) sau khi mọi kết quả tool của lượt đó đã thêm. Lượt chết giữa chừng ⇒ có thể còn lời gọi tool CHƯA có kết quả (tool có thể đã chạy, đã đổi tệp, mà
 * kết quả chưa kịp ghi) ⇒ KHÔNG BAO GIỜ giả định "chưa chạy": mỗi lời gọi như vậy nhận kết quả `[outcome unknown …]` và model được dặn kiểm tra lại
 * trạng thái thật trước khi lặp. Lõi KHÔNG tự chạy lại tool nào.
 */
import type { TinNhan } from "./kieu";

/** Kết quả giả cho lời gọi tool mà lượt chết trước khi ghi kết quả. Tiếng Anh như prompt/tool. */
export const KET_CUC_KHONG_RO =
  "[outcome unknown: the run was interrupted while this tool call was in progress. Do not assume it ran or that it did not run — " +
  "check the current state (read the file, list the directory, run git status) before you repeat or build on it.]";

/** Tin user cố định đặt cuối lịch sử tiếp tục. */
export const CAU_TIEP_TUC =
  "The previous run was interrupted. Continue the task from where it stopped. Re-check the current state of anything you were changing before you repeat it.";

/**
 * Chuẩn hoá bản lưu ⇒ lịch sử gửi model (KHÔNG gồm system — lõi dựng lại; KHÔNG gồm tin "tiếp tục" — host thêm bằng `cauHoi`). Thuần, không đột biến.
 *  1. bỏ tin `system`;
 *  2. kết quả tool mồ côi (id không khớp lời gọi đứng trước) bị bỏ;
 *  3. lời gọi tool chưa có kết quả ⇒ thêm tin tool \`KET_CUC_KHONG_RO\` NGAY SAU các kết quả đã có của cùng tin assistant;
 *  4. đuôi: tin user "lơ lửng" (nhắc của vòng chưa có assistant đáp) và assistant rỗng (không chữ, không tool_calls) bị cắt — để phiên mới không bắt đầu từ lời nhắc dở.
 */
export function chuanHoaLichSuTiepTuc(banLuu: readonly TinNhan[]): TinNhan[] {
  const nguon = banLuu.filter((m) => m && typeof m === "object" && m.role !== "system");
  const ra: TinNhan[] = [];
  const idDaCo = new Set<string>(); // id lời gọi của các tin assistant đã duyệt
  for (let i = 0; i < nguon.length; i++) {
    const m = nguon[i]!;
    if (m.role === "tool") {
      if (m.tool_call_id && idDaCo.has(m.tool_call_id)) ra.push(m);
      continue; // mồ côi ⇒ bỏ
    }
    ra.push(m);
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const idCuaTin = m.tool_calls.map((t) => t.id);
    for (const id of idCuaTin) idDaCo.add(id);
    // gom các kết quả tool ĐỨNG LIỀN sau tin assistant này
    const coKetQua = new Set<string>();
    let j = i + 1;
    while (j < nguon.length && nguon[j]!.role === "tool") {
      const t = nguon[j]!;
      if (t.tool_call_id && idCuaTin.includes(t.tool_call_id) && !coKetQua.has(t.tool_call_id)) {
        coKetQua.add(t.tool_call_id);
        ra.push(t);
      }
      j++;
    }
    for (const c of m.tool_calls) {
      if (coKetQua.has(c.id)) continue;
      ra.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: KET_CUC_KHONG_RO });
    }
    i = j - 1;
  }
  // cắt đuôi dở
  while (ra.length > 0) {
    const cuoi = ra[ra.length - 1]!;
    if (cuoi.role === "user" && ra.length > 1) {
      ra.pop();
      continue;
    }
    if (cuoi.role === "assistant" && !cuoi.tool_calls?.length && !(cuoi.content ?? "").trim()) {
      ra.pop();
      continue;
    }
    break;
  }
  return ra;
}
