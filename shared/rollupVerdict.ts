/** Kết quả một nút trong cây kiểm tra. `result` là phán quyết, `ntf` là CỜ THÔ máy gửi. */
export type ResultVerdict = "OK" | "NG" | "NTF";

/** NTF đến từ đâu: máy tự khai, người xác nhận, hay cả hai. */
export type NtfSource = "machine" | "human" | "both";

export interface NutKetQua {
  result: ResultVerdict;
  ntf: boolean;
  ntfSource?: NtfSource | null;
}

/**
 * Cuộn kết quả từ các nút con lên nút cha. **NG > NTF > OK.**
 *
 * Hai giá trị trả về CỐ Ý tách rời:
 *  - `result`: phán quyết theo thứ tự ưu tiên nghiệp vụ.
 *  - `ntf`: cờ THÔ, OR của các con. Một bo có thể vừa NG vừa bị máy đánh dấu ntf —
 *    `result` cho NG thắng, nhưng mất cờ thô là mất dữ kiện "máy cũng nghi báo giả".
 *
 * Mảng rỗng trả OK/false/null, KHÔNG ném lỗi: một capture không có component nào là
 * hình dạng HỢP LỆ trong payload máy (đèn chụp mà vùng không có linh kiện).
 *
 * ⚠ Hàm này KHÔNG chạy spec-gate. Thứ tự bắt buộc ở tầng gọi (spec §4.3):
 * chạy `evaluatePointResult` cho TỪNG component TRƯỚC, rồi mới cuộn lên. Cuộn trước
 * rồi mới gate sẽ để cấp trên chốt OK trong khi cấp lá đã bị nâng thành NG.
 */
export function rollupVerdict(
  con: readonly NutKetQua[],
): { result: ResultVerdict; ntf: boolean; ntfSource: NtfSource | null } {
  let coNg = false;
  let coNtf = false;
  let ntfTho = false;
  let coMachine = false;
  let coHuman = false;

  for (const c of con) {
    if (c.result === "NG") coNg = true;
    else if (c.result === "NTF") coNtf = true;
    if (c.ntf) ntfTho = true;
    if (c.ntfSource === "machine") coMachine = true;
    else if (c.ntfSource === "human") coHuman = true;
    else if (c.ntfSource === "both") { coMachine = true; coHuman = true; }
  }

  const result: ResultVerdict = coNg ? "NG" : coNtf ? "NTF" : "OK";
  const ntfSource: NtfSource | null =
    coMachine && coHuman ? "both" : coMachine ? "machine" : coHuman ? "human" : null;

  return { result, ntf: ntfTho, ntfSource };
}
