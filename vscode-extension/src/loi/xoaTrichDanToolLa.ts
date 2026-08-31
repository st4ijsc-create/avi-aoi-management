/**
 * ★★★ PDCA vòng 4 (round 4, `pdca5-report.md`) — xoá **TRÍCH DẪN CỦA MỘT TOOL LẠ**, KHÔNG PHẢI
 * hàng rào ```avi-tool```.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * GỐC RỄ ĐO ĐƯỢC (BƯỚC 1 của vòng này — đọc mã + ablation LIVE, không đoán)
 * ══════════════════════════════════════════════════════════════════════════════
 * Giả thuyết "model nhận HAI BỘ TỪ VỰNG TOOL XUNG ĐỘT" ĐÚNG, nhưng hình dạng THẬT khác giả định ban
 * đầu: đây KHÔNG PHẢI một mô hình bịa tên tool hư cấu trong lời văn của chính nó. `question` mà
 * `dayGiaoThucDoc.ts` dựng lên (dạy `doc_tep`/`liet_ke`/`grep`) được gửi NGUYÊN VĂN cho
 * `/api/ai/local-kb/stream`, và MÁY CHỦ chạy nó qua **một hệ thống chọn-tool THẬT SỰ, ĐỘC LẬP**
 * (`server/services/aiLocalTools/intentClassifier.ts::chonToolVong1`, gọi từ
 * `aiLocalKnowledgeService.ts::tryExecuteToolLoop` — **VÔ ĐIỀU KIỆN trên MỌI câu hỏi**, không riêng
 * câu hỏi vận hành) — hệ thống này có ~30 tool THẬT (`get_ng_compare`, `read_file`, `grep_repo`,
 * `list_files`, `daily_statistics`…) và một bộ chọn LLM dự phòng khi luật heuristic không khớp.
 *
 * Đo LIVE (`pdca5-*-sse.txt`, cùng câu hỏi CHỈ khác phần bọc): câu hỏi THÔ (không bọc) ⇒
 * `tool_loop stop:"khong_co_tool"`, sạch. Y HỆT câu hỏi đó, bọc bằng ĐÚNG đoạn dạy `doc_tep`/
 * `liet_ke`/`grep` của extension (kể cả chỉ MỘT câu dẫn 403 ký tự, không kèm ví dụ JSON nào) ⇒ máy
 * chủ chọn NHẦM một tool THẬT (`get_ng_compare`, có lúc `grep_repo`/`list_files`) — tool đó THỰC SỰ
 * CHẠY (không phải hallucination), và kết quả của nó được `server/services/ai/dataCitation.ts`
 * (`themChanNguonSoLieu`/`cauGhiChuVongLap`) DÁN THẲNG vào cuối câu trả lời mà người dùng thấy.
 * Đo trên 9/11 tác vụ vòng 3 (`pdca4-*-raw.json`) xác nhận: dòng `_Nguồn số liệu: ...daily_
 * statistics...` xuất hiện ở CẢ những tác vụ đang ĐẠT (T01/T02/T06/T08/T10/T11) — người chấm ba vòng
 * trước đã ĐỌC XUYÊN QUA nó mà không biết nguồn gốc, đúng là NHIỄU chứ không phải TÍN HIỆU.
 *
 * ⇒ Gốc rễ THẬT nằm NGOÀI `vscode-extension/` (không vá được từ phía client — xem báo cáo vòng này,
 * mục "gốc rễ thật", cho đề xuất đổi chính xác cái gì ở `aiLocalKnowledgeService.ts`). Nhưng HẬU QUẢ
 * hiển thị — hai mẫu văn bản CỐ ĐỊNH, đo được từ CHÍNH mã nguồn máy chủ (`dataCitation.ts`) — là thứ
 * client CÓ THỂ lọc AN TOÀN trước khi vẽ lên webview: `buildDataCitation` chỉ bao giờ gán `tool` là
 * một tên tool NATIVE đã đăng ký phía máy chủ (`get_ng_compare`, `read_file`…) — KHÔNG BAO GIỜ là
 * `doc_tep`/`liet_ke`/`grep` (ba tên đó không phải `Tool` thật, chỉ là quy ước VĂN BẢN của
 * `khoiAviTool.ts`, máy chủ không hề biết tới), nên MỌI trích dẫn khớp hai mẫu dưới đây, khi hiển thị
 * trong panel chat của extension này, chắc chắn đến từ vòng tool VẬN HÀNH độc lập nói trên — không
 * bao giờ là một phần câu trả lời thật mà xoá nhầm.
 *
 * Hàm THUẦN (không `import "vscode"`, không đọc đĩa/mạng) — cùng quy ước `null` = "không đổi gì" với
 * `xoaRacGiaoThuc.ts` (người gọi coi `null` là GIỮ NGUYÊN hành vi cũ).
 */

/**
 * Dòng trích dẫn nguồn dữ liệu — mẫu CỐ ĐỊNH từ `dataCitation.ts::moTaTrichDanDuLieu`:
 * `` `${nhan}: ${parts.join(" · ")}` `` bọc trong `_..._` (in nghiêng markdown), nhãn ba ngôn ngữ
 * (`Nguồn số liệu`/`Data source`/`数据来源`), LUÔN nằm trọn một dòng (không xuống dòng bên trong).
 */
const RE_TRICH_DAN_NGUON = /^_(?:Nguồn số liệu|Data source|数据来源):[^\n]*_[ \t]*$/gm;

/**
 * Ghi chú "đa bước" — mẫu CỐ ĐỊNH từ `dataCitation.ts::cauGhiChuVongLap` (chỉ phát khi vòng tool
 * VẬN HÀNH của máy chủ chạy ≥2 vòng TRONG MỘT lượt gọi): `<sub>Đa bước: N lượt gọi tool (...), M
 * ms.</sub>` (VI/EN dùng dấu `:` thường, ZH dùng dấu `：` toàn chiều rộng).
 */
const RE_GHI_CHU_DA_BUOC = /<sub>(?:Đa bước|Multi-step|多步)[:：][^<]*<\/sub>/g;

/** Câu dự phòng — chỉ dùng khi TOÀN BỘ văn bản chỉ gồm (các) trích dẫn tool-lạ, không còn văn xuôi
 *  nào khác sau khi xoá (chưa từng thấy ở dữ liệu thật, nhưng không được để bong bóng RỖNG — cùng
 *  quy ước với `xoaRacGiaoThuc.ts::CAU_DU_PHONG_KHI_RONG`). */
const CAU_DU_PHONG_KHI_RONG =
  "Đã xử lý xong các bước cần thiết ở hậu trường (đọc tệp/tìm kiếm) — không còn nội dung nào khác để hiển thị.";

/**
 * Xoá MỌI trích dẫn tool-lạ (hai mẫu ở trên) khỏi `vanBan`, dọn khoảng trắng thừa còn sót lại theo
 * ĐÚNG quy ước của `xoaRacGiaoThuc.ts::vanBanKhongRacGiaoThuc` (gộp ≥2 dòng trống liên tiếp thành 1,
 * gọt hai đầu). Trả `null` nếu KHÔNG có gì bị xoá — người gọi PHẢI coi `null` là "giữ nguyên hành vi
 * cũ", không phải "văn bản rỗng".
 */
export function vanBanKhongTrichDanToolLa(vanBan: string): string | null {
  const sauBuoc1 = vanBan.replace(RE_TRICH_DAN_NGUON, "");
  const sauBuoc2 = sauBuoc1.replace(RE_GHI_CHU_DA_BUOC, "");
  if (sauBuoc2 === vanBan) return null;

  const gonGang = sauBuoc2.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();
  return gonGang.length > 0 ? gonGang : CAU_DU_PHONG_KHI_RONG;
}
