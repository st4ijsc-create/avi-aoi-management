/**
 * ★★★ ĐỢT G / TASK G3 — VỊ TỪ THUẦN CHO BA MỨC QUYỀN (CHẾ ĐỘ TỰ TRỊ).
 *
 * KHÔNG import `vscode` (quy ước `src/loi/`, đo được bằng vitest thường, không cần dựng cửa sổ
 * VSCode thật). Tệp này chỉ biết BA chuỗi và hai câu hỏi THUẦN về chúng — "mức này có được ghi
 * không" và "mức này có bỏ bước hỏi không". Nó KHÔNG biết gì về webview, `workspaceState`, hay
 * `apBanVa` — hai nơi GỌI vào đây mới là nơi có Ý NGHĨA THẬT:
 *   · `ui/apBanVa.ts` (BƯỚC 0, đã import `vscode`) gọi `duocPhepGhiTheoMucQuyen` làm **HÀNG RÀO
 *     THẬT** — đây là điểm ghi DUY NHẤT của cả extension, có census canh, nên đây là nơi DUY NHẤT
 *     mà một lượt chặn ở đây thật sự CHẶN được byte rơi xuống đĩa.
 *   · `ui/bangChat.ts` (`xuLyDeXuatCucBo`) gọi LẠI ĐÚNG hàm đó ở lớp UI — KHÔNG PHẢI một hàng rào
 *     THỨ HAI, mà chỉ để báo sớm/khỏi dựng một thẻ duyệt vô ích cho một lượt CHẮC CHẮN sẽ bị
 *     `apBanVa` từ chối — và gọi `boQuaBuocHoi` để quyết có tự áp bản vá (bỏ đợi cú bấm) hay không.
 *
 * ⚠⚠⚠ VÌ SAO "chi_doc" PHẢI CHẶN Ở `apBanVa.ts`, KHÔNG PHẢI CHỈ Ở GIAO DIỆN (B2). Một webview vẽ
 * sai theo mức đang chọn (lỗi lập trình), một lời gọi `apDungCucBo` tới từ một đường khác sau này,
 * hay một đề xuất TỰ ĐỘNG (Đợt H, MCP/bộ nhớ) đều phải bị chặn — ẩn nút chỉ chặn được CÚ BẤM THẤY
 * ĐƯỢC, không chặn được một lời gọi hàm. Đặt hàng rào bên trong `apBanVa` (điểm ghi DUY NHẤT) là
 * cách DUY NHẤT một lỗi ở TẦNG TRÊN không thể vượt qua được.
 */

export type MucQuyen = "chi_doc" | "hoi_truoc_khi_ghi" | "tu_ghi";

/**
 * ★★★ B4 — MẶC ĐỊNH AN TOÀN. Workspace MỚI (chưa từng lưu gì) hoặc kho HỎNG (giá trị sai kiểu —
 * một phiên bản trước ghi hình dạng khác, hoặc ai đó chỉnh tay `workspaceState` bằng công cụ
 * ngoài) đều phải rơi về ĐÚNG giá trị này — **KHÔNG BAO GIỜ** rơi về `tu_ghi` (mức mạnh nhất).
 * "Không biết mức nào" phải được xử như "mức cần XÁC NHẬN trước khi ghi", đúng khuôn `cheDoHienTai`
 * (`loi/kiemTraCheDo.ts`) đã áp cho việc suy chế độ LOCAL/SERVER — không biết ⇒ rơi về nhánh AN
 * TOÀN NHẤT, không phải nhánh có hậu quả nặng nhất.
 */
export const MUC_QUYEN_MAC_DINH: MucQuyen = "hoi_truoc_khi_ghi";

const CAC_MUC_HOP_LE: readonly MucQuyen[] = ["chi_doc", "hoi_truoc_khi_ghi", "tu_ghi"];

/** Vị từ hình dạng THUẦN — không đoán một giá trị lạ thành một trong ba mức. */
export function laMucQuyenHopLe(gt: unknown): gt is MucQuyen {
  return typeof gt === "string" && (CAC_MUC_HOP_LE as readonly string[]).includes(gt);
}

/**
 * ★★★ B4 — kho RỖNG (`undefined`, chưa từng ghi) hoặc HỎNG (sai kiểu: số, `null`, chuỗi lạ, object)
 * ⇒ `MUC_QUYEN_MAC_DINH`. Đây là hàng rào DUY NHẤT giữa dữ liệu THÔ đọc từ `workspaceState` và phần
 * còn lại của hệ thống — mọi chỗ đọc kho PHẢI đi qua nó, không ai được tự tiện `as MucQuyen` một
 * giá trị chưa kiểm (cùng khuôn `laHoiThoaiHopLe`/`docDanhSachHoiThoai` ở `loi/khoHoiThoai.ts`).
 * ⚠ Cũng được gọi lại BÊN TRONG `apBanVa` (BƯỚC 0) như một lớp phòng thủ THỨ HAI trên chính đầu
 *   vào của điểm ghi — idempotent trên một giá trị đã hợp lệ, nên gọi hai lần không đổi gì.
 */
export function chuanHoaMucQuyen(gt: unknown): MucQuyen {
  return laMucQuyenHopLe(gt) ? gt : MUC_QUYEN_MAC_DINH;
}

/**
 * ★★★ B2 — HÀNG RÀO THẬT. Gọi bên trong `ui/apBanVa.ts`, TRƯỚC MỌI bước khác (kể cả bước 1 —
 * xem docblock "BƯỚC 0" ở đó). `chi_doc` chặn TUYỆT ĐỐI, không phụ thuộc đường dẫn/nội dung đề
 * xuất là gì — một đề xuất ghi vào tệp hợp lệ nhất trong workspace vẫn bị từ chối y hệt một đề
 * xuất ghi vào `.git/hooks`.
 */
export function duocPhepGhiTheoMucQuyen(mucQuyen: MucQuyen): { ok: true } | { ok: false; lyDo: string } {
  if (mucQuyen === "chi_doc") {
    return {
      ok: false,
      lyDo:
        `chế độ quyền hiện tại là "Chỉ đọc" — mọi đề xuất ghi bị chặn TẠI ĐIỂM GHI (không chỉ ẩn ` +
        `nút duyệt ở giao diện). Đổi mức quyền ở góc khung nếu muốn cho phép ghi.`,
    };
  }
  return { ok: true };
}

/**
 * ★★★ B3 — CHỈ quyết định có BỎ BƯỚC HỎI hay không (webview có phải dựng thẻ duyệt và chờ người
 * dùng bấm "Ghi vào workspace" hay tự động áp bản vá). KHÔNG liên quan gì tới HÀNG RÀO — `tu_ghi`
 * vẫn đi qua NGUYÊN VẸN `apBanVa` (`duocPhepGhi`/`camGhiRieng`/`duongThat`/`eolLanLon`/kiểm toán
 * TRƯỚC-SAU), chỉ có bước hiện thẻ và chờ cú bấm là bị bỏ qua. Xem `ui/bangChat.ts#xuLyDeXuatCucBo`.
 * ⚠ ĐÂY LÀ CHỖ DỄ SAI NHẤT: "tự trị" rất dễ bị cài thành "bỏ qua mọi kiểm tra" — hàm này CỐ Ý chỉ
 *   trả về một `boolean` về việc HỎI, không có khả năng tắt bất kỳ hàng rào nào (nó không được gọi
 *   ở đâu bên trong `apBanVa` cả, chỉ ở lớp điều phối UI).
 */
export function boQuaBuocHoi(mucQuyen: MucQuyen): boolean {
  return mucQuyen === "tu_ghi";
}

/**
 * Khoá cất mức quyền trong `context.workspaceState` — MỘT khoá THEO TỪNG WORKSPACE, cùng lý do
 * `KHOA_HOI_THOAI` (`loi/khoHoiThoai.ts`) dùng `workspaceState` thay vì `globalState`: mỗi dự án có
 * mức RỦI RO riêng (repo cá nhân khác repo công ty của khách hàng) — một mức "Tự ghi" đặt cho dự
 * án A không được âm thầm áp dụng cho dự án B chỉ vì mở cùng một máy.
 */
export const KHOA_MUC_QUYEN = "aviAiLocal.mucQuyen";

/** Nhãn tiếng Việt hiển thị trong ô chọn — MỘT nơi dựng nhãn, để mọi nơi khác (thông báo, tooltip)
 *  không tự bịa chữ khác nhau cho CÙNG một mức. */
export const NHAN_MUC_QUYEN: Record<MucQuyen, string> = {
  chi_doc: "Chỉ đọc",
  hoi_truoc_khi_ghi: "Hỏi trước khi ghi",
  tu_ghi: "Tự ghi trong workspace",
};
