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

/**
 * Cầu nối giữa HAI bảng chữ cái khác nhau:
 *   · Hợp đồng máy v2.0 — `result` chỉ `OK|NG`, NTF là cờ BOOL RIÊNG.
 *   · Cột lưu trữ `product_inspections.overallResult` — BA giá trị `OK|NG|NTF`,
 *     và `shared/kpiYield.ts` tính final yield bằng `["OK","NTF"]` trên chính cột đó.
 *
 * NTF có HAI NGUỒN ĐỘC LẬP, hàm này PHẢI nhận CẢ HAI:
 *   1. Cờ `ntf` — đường v2.0 mang NTF trong cờ bool riêng (`result` chỉ OK|NG ở đường đó).
 *   2. `result === "NTF"` — chữ ký `ResultVerdict` có BA giá trị, và `rollupVerdict` (xem
 *      docblock dòng 16-19: `result` và cờ `ntf` là hai tín hiệu ĐỘC LẬP, được phép LỆCH
 *      nhau) có thể trả thẳng `result: "NTF"` khi dữ liệu đến từ đường khác (v1.x, hoặc
 *      một cuộn hỗn hợp không đi qua cờ `ntf`). Bỏ nhánh này hạ NTF xuống OK ÂM THẦM —
 *      ĐÚNG lỗi 6,55% mà hàm này sinh ra để chống, chỉ khác cửa vào.
 *      (Vòng sửa 1, 2026-08-26 — người review đo được `verdictLuuTru({result:"NTF",
 *      ntf:false})` trả "OK" ở bản đầu tiên: bản đó chỉ đọc cờ `ntf`, quên mất `result`
 *      tự nó cũng có thể đã là "NTF".)
 *
 * Thiếu hàm này (hoặc thiếu MỘT trong hai nhánh trên) thì 6,55% bo (2.760/42.147 đo trên
 * DB test ngày 2026-08-26) chuyển từ PASS sang NG lặng lẽ vào đúng ngày cắt sang v2.0 —
 * không lưới nào đỏ, vì enum DB vẫn NHẬN "NTF", chỉ là không ai ghi vào nữa.
 *
 * CỐ Ý TÁCH KHỎI `rollupVerdict`: cuộn cây và ánh xạ bảng chữ cái là hai việc khác nhau.
 *
 * ⚠ CHƯA nối vào đường ingest thật (`server/db/inspection.ts` / `aoiPackageRouter.ts`) —
 * tính tới vòng sửa 1, hàm này chỉ xuất hiện trong hai file test (đã kiểm bằng grep toàn
 * repo). Lỗ 6,55% VẪN MỞ trên production cho tới khi Task 4/5 của Pha 1B nối dây gọi hàm
 * này. Test xanh ở đây KHÔNG chứng minh đường ghi thật đã an toàn — cùng khuôn "test xanh
 * gây hiểu nhầm" mà Pha 1A đã dính với `loiMayChuaNangCap`.
 */
export function verdictLuuTru(x: { result: ResultVerdict; ntf: boolean }): ResultVerdict {
  if (x.result === "NG") return "NG"; // NG thắng NTF — luật cuộn đã chốt với chủ dự án
  if (x.result === "NTF" || x.ntf) return "NTF"; // NTF đến từ HAI nguồn độc lập, nhận cả hai
  return "OK";
}
