/**
 * ★★★ SỔ PHẠM VI NODE LUỒNG AI (lô Luồng-1, 2026-10-25; dieu-phoi duyệt) — cạnh `KHOA_PHAM_VI_DOC_TOOL` của tool trợ lý.
 * MỌI loại node đã đăng ký phải có MỘT dòng: `loc` = node đọc / ghi dữ liệu thuộc nhà máy và khai TRỤC LỌC (`phamVi`); `khong` = không chạm dữ liệu nhà máy,
 * kèm lý do ≥ 20 ký tự. Node vắng dòng ⇒ `phamViNut.census.test.ts` ĐỎ. Node hạng `doc` / `ngoai-ghi` / `ot` mà khai `khong` phải có lý do NÊU TÊN cơ chế bảo vệ khác.
 */
export type LuatPhamViNut = { kieu: "loc"; phamVi: string } | { kieu: "khong"; lyDo: string };

const KHONG_CHAM_DU_LIEU = "Chỉ xử lý item đầu vào của luồng; không đọc bảng dữ liệu nhà máy nào.";

export const KHOA_PHAM_VI_NUT: Readonly<Record<string, LuatPhamViNut>> = {
  // ── đọc / ghi dữ liệu nhà máy
  "du-lieu.so-lieu": { kieu: "loc", phamVi: "máy trong phạm vi CHỦ LƯỢT lúc chạy (idsTrongPhamVi) ∩ máy của nhà máy luồng; phạm vi rỗng ⇒ ném" },
  "tich-hop.thong-bao": { kieu: "loc", phamVi: "người nhận phải thấy nhà máy của luồng (nhaMayChoPhep của CHÍNH họ); luồng toàn hệ thống ⇒ người nhận toàn quyền" },
  "ot.doc-tag": { kieu: "loc", phamVi: "máy qua BoKiemPhamVi.may của chủ lượt (cổng OT census riêng)" },
  "ot.de-xuat-lenh": { kieu: "loc", phamVi: "máy qua BoKiemPhamVi.may + aiControlGate" },
  "ot.de-xuat-luong": { kieu: "loc", phamVi: "FOE workflow qua luongFoeTrongPhamVi của chủ lượt + aiControlGate" },
  "luong.goi-con": { kieu: "loc", phamVi: "luồng con qua BoKiemPhamVi.luong của chủ lượt" },
  "bao-tri.tao-phieu": { kieu: "loc", phamVi: "máy qua BoKiemPhamVi.may của chủ lượt + máy thuộc nhà máy của luồng + checkPermission(machine_monitoring/canCreate) của chủ lượt; ghi qua ghiPhieuBaoTri" },
  "ai.tra-tri-thuc": { kieu: "loc", phamVi: "kho tri thức hãng / Studio, không có dữ liệu nhà máy; trục lọc = VAI chủ lượt lúc chạy (canAccessStudioCorpus, fail-closed)" },
  "ai.agent": { kieu: "loc", phamVi: "tool = luồng con qua BoKiemPhamVi.luong; tra_tai_lieu dùng KB hiện có" },
  // ── không chạm dữ liệu nhà máy
  "kich-hoat.thu-cong": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "kich-hoat.su-kien": { kieu: "khong", lyDo: "Phạm vi kiểm LÚC BẮN trong suKien.ts: máy→nhà máy tra CSDL, chủ luồng HIỆN TẠI phải thấy máy, nhà máy khớp luồng; mặc định tắt theo node." },
  "kich-hoat.lich": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "kich-hoat.webhook": { kieu: "khong", lyDo: "Nhận item từ yêu cầu ngoài có token băm; không đọc bảng dữ liệu nhà máy." },
  "kich-hoat.mcp": { kieu: "khong", lyDo: "Nhận item từ yêu cầu MCP có danh tính; luồng chỉ hạng thuần / đọc; không đọc bảng dữ liệu nhà máy." },
  "logic.neu": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.chon": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.gom": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.cho": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "nguoi.bieu-mau": { kieu: "khong", lyDo: "Ghi hàng chờ nội bộ khoá (runId,nodeId) như nguoi.duyet; người điền kiểm quyền ở flow.duyet; giá trị điền không chạm bảng dữ liệu nhà máy." },
  "logic.dung-loi": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.loc": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.sap-xep": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "logic.gop": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "du-lieu.dat": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "du-lieu.ma": { kieu: "khong", lyDo: "Chạy mã trong Docker cách ly (không mạng, không đĩa); chỉ nhận item đầu vào." },
  "ai.llm": { kieu: "khong", lyDo: "Gọi model qua Cổng AI theo vai trò với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.kiem-dinh-ngoai": { kieu: "khong", lyDo: "Gửi chữ do luồng cấp tới CỔNG AI NGOÀI (goiAiNgoai): cổng kiểm nhà máy chủ luồng + duyệt phiên bản + mức dữ liệu theo lượt; node không đọc bảng dữ liệu nhà máy." },
  "ai.trich-xuat": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.phan-loai": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.tom-tat": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.sinh-ma": { kieu: "khong", lyDo: "Sinh mã ST và biên dịch trong Docker cách ly; không đọc bảng dữ liệu nhà máy, không tải xuống thiết bị." },
  "nguoi.duyet": { kieu: "khong", lyDo: "Ghi hàng chờ duyệt nội bộ khoá (runId,nodeId); người duyệt kiểm quyền ở flow.duyet theo phạm vi luồng." },
  "tich-hop.http-doc": { kieu: "khong", lyDo: "Gọi HTTP tới host trong danh sách trắng AI_FLOW_HTTP_HOST_CHO_PHEP (chặn SSRF, ghim IP); không đọc bảng dữ liệu nhà máy." },
  "tich-hop.mcp-goi": { kieu: "khong", lyDo: "Gọi tool của MCP server trong danh sách trắng AI_FLOW_MCP_CHO_PHEP (mặc định rỗng ⇒ tắt; chặn SSRF, ghim IP, atMostOnce); không đọc bảng dữ liệu nhà máy." },
  "tich-hop.http-gui": { kieu: "khong", lyDo: "Gửi HTTP tới host trong danh sách trắng (chặn SSRF, atMostOnce + Idempotency-Key); không đọc bảng dữ liệu nhà máy." },
};

/**
 * ★★★ SỔ "THAM SỐ MANG ID THEO NHÀ MÁY" (lô nhập/xuất luồng, 2026-10-25): mỗi loại node đã đăng ký khai những tham số có thể mang ID/chuỗi thuộc MỘT nhà máy
 * (id máy, người nhận, luồng con, FOE workflow…). Lúc XUẤT (và lúc NHẬP — không tin gói) các tham số này bị đưa về chỗ TRỐNG và ghi vào "việc phải điền"; biểu thức `{{ … }}`
 * KHÔNG phải ID nên giữ nguyên. Loại node mới mang ID theo nhà máy mà quên khai ⇒ `phamViNut.census.test.ts` ĐỎ (mọi loại đã đăng ký phải có dòng).
 *   thanh: "chuoi-rong" (→ "") · "mang-rong" (→ []) · "bo" (xoá khoá) · "tat" (→ false) · "luong-con" (mảng đối tượng có flowId → flowId "").
 *   Cấp NODE (mọi loại): `credentialRef` luôn bị xoá; cấp LUỒNG: id · chủ · nhà máy · `settings.errorFlowId` · `pinData` (dữ liệu ghim thật) luôn bị bỏ.
 */
export type CachLamTrong = "chuoi-rong" | "mang-rong" | "bo" | "tat" | "luong-con";
export interface ThamSoNhaMay {
  truong: string;
  thanh: CachLamTrong;
  /** nhãn việc phải điền (khoá i18n phía giao diện) */
  viec: "may" | "nguoi-nhan" | "luong-con" | "workflow-ot" | "bat-su-kien" | "chon-model";
}
export interface DongThamSoNhaMay {
  truong: ThamSoNhaMay[];
  /** bắt buộc khi `truong` rỗng (≥ 20 ký tự): vì sao loại node này không mang ID theo nhà máy */
  lyDo?: string;
}

const KHONG_ID = (ly: string): DongThamSoNhaMay => ({ truong: [], lyDo: ly });
const CHI_ITEM = "Tham số là chữ / số / biểu thức của luồng; không mang id máy, người dùng hay luồng khác.";

export const THAM_SO_THEO_NHA_MAY: Readonly<Record<string, DongThamSoNhaMay>> = {
  "kich-hoat.thu-cong": KHONG_ID(CHI_ITEM),
  "kich-hoat.lich": KHONG_ID("Chỉ cron + múi giờ; không mang id theo nhà máy."),
  "kich-hoat.webhook": KHONG_ID("Token webhook nằm ở bảng riêng theo luồng, không trong định nghĩa."),
  "kich-hoat.mcp": KHONG_ID("Chỉ khai tool (tên, mô tả, tham số kiểu); không mang id theo nhà máy."),
  "kich-hoat.su-kien": { truong: [{ truong: "bat", thanh: "tat", viec: "bat-su-kien" }] },
  "logic.neu": KHONG_ID(CHI_ITEM),
  "logic.chon": KHONG_ID(CHI_ITEM),
  "logic.gom": KHONG_ID(CHI_ITEM),
  "logic.cho": KHONG_ID(CHI_ITEM),
  "nguoi.bieu-mau": KHONG_ID("Chỉ vai trò điền (supervisor…) và định nghĩa trường; không phải id người dùng."),
  "logic.dung-loi": KHONG_ID(CHI_ITEM),
  "logic.loc": KHONG_ID(CHI_ITEM),
  "logic.sap-xep": KHONG_ID(CHI_ITEM),
  "logic.gop": KHONG_ID(CHI_ITEM),
  "du-lieu.dat": KHONG_ID(CHI_ITEM),
  "du-lieu.ma": KHONG_ID("Mã chạy cách ly trên item đầu vào; không mang id (văn bản tự do được quét cảnh báo lúc xuất)."),
  "du-lieu.so-lieu": KHONG_ID("Truy vấn trong danh mục có tên; phạm vi lấy từ chủ luồng lúc chạy, không từ tham số."),
  "ai.llm": KHONG_ID("Prompt / vai trò; không mang id (văn bản tự do được quét cảnh báo lúc xuất)."),
  "ai.trich-xuat": KHONG_ID("Prompt / schema trích xuất; không mang id."),
  "ai.phan-loai": KHONG_ID("Danh sách nhãn / hướng dẫn; không mang id."),
  "ai.tom-tat": KHONG_ID("Yêu cầu tóm tắt; không mang id."),
  "ai.sinh-ma": KHONG_ID("Mô tả + ngôn ngữ; không mang id."),
  "ai.tra-tri-thuc": KHONG_ID("Câu hỏi + kho + k; không mang id theo nhà máy."),
  "ai.agent": { truong: [{ truong: "luongCon", thanh: "luong-con", viec: "luong-con" }] },
  // ★ 10.4 — model ngoài là danh mục CỦA MỘT NHÀ MÁY (khoá + giá + trần) ⇒ xuất/nhập đưa về trống, người nhập chọn lại.
  "ai.kiem-dinh-ngoai": { truong: [{ truong: "chonModel", thanh: "chuoi-rong", viec: "chon-model" }] },
  "nguoi.duyet": KHONG_ID("Chỉ vai trò duyệt (supervisor…), không phải id người dùng."),
  "luong.goi-con": { truong: [{ truong: "flowId", thanh: "chuoi-rong", viec: "luong-con" }, { truong: "version", thanh: "bo", viec: "luong-con" }] },
  "tich-hop.http-doc": KHONG_ID("URL + tên trường; bí mật (credentialRef cấp node) luôn bị xoá khi xuất."),
  "tich-hop.mcp-goi": KHONG_ID("Chỉ TÊN máy chủ MCP + TÊN tool + đối số biểu thức (không URL/host/id nhà máy); bí mật (credentialRef cấp node) luôn bị xoá khi xuất."),
  "tich-hop.http-gui": KHONG_ID("URL + thân; bí mật (credentialRef cấp node) luôn bị xoá khi xuất."),
  "tich-hop.thong-bao": { truong: [{ truong: "nguoiNhan", thanh: "mang-rong", viec: "nguoi-nhan" }] },
  "bao-tri.tao-phieu": { truong: [{ truong: "may", thanh: "chuoi-rong", viec: "may" }] },
  "ot.doc-tag": { truong: [{ truong: "may", thanh: "chuoi-rong", viec: "may" }] },
  "ot.de-xuat-lenh": { truong: [{ truong: "may", thanh: "chuoi-rong", viec: "may" }] },
  "ot.de-xuat-luong": { truong: [{ truong: "workflowId", thanh: "bo", viec: "workflow-ot" }, { truong: "version", thanh: "bo", viec: "workflow-ot" }] },
};
