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
 * ⚠ Hàm này KHÔNG chạy spec-gate — nó chỉ CUỘN. Cổng chạy Ở NGOÀI, TRƯỚC hàm này.
 *
 * Thứ tự ĐÚNG theo spec §4.3 là: chạy `evaluatePointResult` cho TỪNG component
 * TRƯỚC, rồi mới cuộn lên (cuộn trước rồi mới gate sẽ để cấp trên chốt OK trong
 * khi cấp lá đã bị nâng thành NG).
 *
 * ★★★ BG-92 **ĐÃ ĐÓNG** (Khối B Task 4, 2026-09-03) — và đây là phần phải đọc kỹ,
 * vì bản chú thích ở ĐÚNG chỗ này đã hai lần khai KHÔNG khớp hành vi.
 *
 * SỰ THẬT ĐO ĐƯỢC HÔM NAY — thứ tự trên được thi hành ở **CẢ BA** đường ghi:
 *   · v1.x PHẲNG — `machineApiRouters.processInspectionSubmission` (không đổi).
 *   · v2.0 trực tiếp — `submitInspectionTreeV2` (kể cả lượt PHÁT LẠI từ WAL, vì
 *     `ensureInspectionWalWired` gọi thẳng chính hàm đó).
 *   · v2.0 cửa ZIP — `aoiPackageRouter.commit` (cửa đã mất cổng ở `df20b31c`/BG-85).
 * Hai đường v2 đi qua `dichCayKetQua(payload, { cong })`
 * (`server/services/ingestCayKetQua.ts`): `dichCapture` gọi `cong.cham` cho từng lá
 * **rồi mới** gọi `rollupVerdict(components)` — thứ tự là HỆ QUẢ CẤU TẠO, không phải
 * quy ước mà nơi gọi phải nhớ. Cổng sống ở `server/services/specGateCayV2.ts`; ánh xạ
 * `componentExtId → pointDefId` (+ giới hạn) do `traPointDefCapComponent` cung cấp,
 * lọc theo **máy đã xác thực VÀ sản phẩm** (Khối B Task 2/3/5 — trước đó không có
 * ánh xạ này nên cổng không có gì để tra).
 *
 * ⚠⚠ PHẦN **CHƯA** NỐI — nêu ĐÍCH DANH, vì "đã nối spec-gate" nói trống là L-3:
 *  1. **Giới hạn phải do NGƯỜI soạn.** Hợp đồng cây dạy
 *     (`machineTemplateContract.componentTemplate`) KHÔNG mang trường giới hạn nào,
 *     nên point-def do máy đẩy cây tạo ra có MỌI cột giới hạn NULL. Cổng trả trạng
 *     thái **"không kết luận được"** cho chúng — KHÔNG phải "đạt". Đo 2026-09-03:
 *     16/16 point-def sinh từ mẫu máy thật có `lowerLimit` NULL.
 *  2. **Hôm nay chưa máy nào dạy.** `machine_template_versions` = 0 và
 *     `product_captures` = 0 ở CẢ HAI DB (vai `avi_app`) ⇒ 100% linh kiện "chưa dạy"
 *     ⇒ cổng ĐANG kết luận 0 linh kiện. Nó nói ra điều đó (`specGate.chuaDay`,
 *     `remark='[SG:KHONG_KL]'`, `console.warn`) thay vì trả xanh — đó là khác biệt
 *     giữa một cổng thật và một GIẤY VÔ CAN GIẢ.
 *  3. **Đường v2 KHÔNG có snapshot-gate và KHÔNG có variant override.** v1.x chấm
 *     theo bản cấu hình bo được đo dưới (`SPEC_GATE_SNAPSHOT_ENABLED`, doc 51 P1/P2)
 *     và áp `variant_point_overrides` (doc 55 Item 3); đường v2 chấm theo giới hạn
 *     ĐANG SỐNG, không snapshot, không variant. Bo v2 tồn kho lâu rồi bị siết limit
 *     sẽ bị chấm theo limit MỚI.
 *  4. **Các chiều 3D/SPI/X-ray chưa bao giờ chấm được ở v2.** Lá v2.0 chỉ mang
 *     `value`; `valueHeight/valueVolume/valueVoidPct/…` không có trong hợp đồng, nên
 *     dù bản dạy có `heightMin/volumeMax/…` thì `evaluatePointResult` vẫn bỏ qua
 *     chúng. Chỉ cổng 1D (`lowerLimit`/`upperLimit`) và `criteria` chạy được.
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
 * ⚠ ĐÍNH CHÍNH (Khối B Task 4, 2026-09-03) — bản chú thích cũ ở đúng chỗ này viết
 * *"CHƯA nối vào đường ingest thật … hàm này chỉ xuất hiện trong hai file test"*. Câu đó
 * ĐÃ SAI kể từ Pha 1B/1C: `grep` toàn repo hôm nay cho ba điểm gọi SẢN XUẤT —
 * `server/services/ingestCayKetQua.ts` (hai lần: lời khai cấp bo và cuộn-từ-lá) và
 * `server/db/inspection.ts:ghiCayKetQua` (cấp component, Khối B Task 3). Lỗ 6,55% ở
 * cấp bo đã đóng trên cả hai cửa v2.
 * ⚠ Giữ nguyên bài học của câu cũ, vì nó vẫn đúng ở dạng tổng quát: **test xanh ở đây
 * KHÔNG chứng minh đường ghi thật an toàn** — nghiệm thu phải là `SELECT` trên bo ghi
 * qua CỬA thật (`server/db/capComponentGhiThat.db.test.ts`,
 * `server/db/specGateCayV2.db.test.ts`), không phải lưới đơn vị của file này.
 */
export function verdictLuuTru(x: { result: ResultVerdict; ntf: boolean }): ResultVerdict {
  if (x.result === "NG") return "NG"; // NG thắng NTF — luật cuộn đã chốt với chủ dự án
  if (x.result === "NTF" || x.ntf) return "NTF"; // NTF đến từ HAI nguồn độc lập, nhận cả hai
  return "OK";
}

/**
 * Mức độ nghiêm trọng để so hai phán quyết. NG xấu nhất, OK tốt nhất.
 * NTF ở giữa: bo không lỗi thật, nhưng đã bị máy/người đánh dấu nghi ngờ.
 */
const MUC_DO_NGHIEM_TRONG: Record<ResultVerdict, number> = { OK: 0, NTF: 1, NG: 2 };

/**
 * Trả về phán quyết XẤU HƠN trong hai cái.
 *
 * Dùng để hợp nhất LỜI KHAI của máy với KẾT QUẢ CUỘN từ cây — hai tín hiệu
 * độc lập, được phép lệch nhau, và **không tín hiệu nào được phép làm nhẹ đi**
 * tín hiệu kia:
 *   · máy khai OK nhưng cây có component NG ⇒ NG  (công dụng của phép cuộn)
 *   · máy khai NG nhưng cây rỗng           ⇒ NG  (máy biết thứ nó không gửi lên)
 *
 * Bất biến này khớp đường v1.x: `promoteOverallToNg` chỉ NÂNG OK→NG và
 * `UPDATE` kèm `WHERE overallResult='OK'` — đo trên 42.431 bo lịch sử,
 * số lần `NG→OK` là **0**. Đường v2.0 phải giữ đúng bất biến đó.
 */
export function verdictXauHon(a: ResultVerdict, b: ResultVerdict): ResultVerdict {
  return MUC_DO_NGHIEM_TRONG[a] >= MUC_DO_NGHIEM_TRONG[b] ? a : b;
}
