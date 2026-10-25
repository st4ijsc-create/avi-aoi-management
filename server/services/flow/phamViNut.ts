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
  "logic.gop": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "du-lieu.dat": { kieu: "khong", lyDo: KHONG_CHAM_DU_LIEU },
  "du-lieu.ma": { kieu: "khong", lyDo: "Chạy mã trong Docker cách ly (không mạng, không đĩa); chỉ nhận item đầu vào." },
  "ai.llm": { kieu: "khong", lyDo: "Gọi model qua Cổng AI theo vai trò với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.trich-xuat": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.phan-loai": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.tom-tat": { kieu: "khong", lyDo: "Gọi model qua Cổng AI với chữ do luồng cấp; không đọc bảng dữ liệu nhà máy." },
  "ai.sinh-ma": { kieu: "khong", lyDo: "Sinh mã ST và biên dịch trong Docker cách ly; không đọc bảng dữ liệu nhà máy, không tải xuống thiết bị." },
  "nguoi.duyet": { kieu: "khong", lyDo: "Ghi hàng chờ duyệt nội bộ khoá (runId,nodeId); người duyệt kiểm quyền ở flow.duyet theo phạm vi luồng." },
  "tich-hop.http-doc": { kieu: "khong", lyDo: "Gọi HTTP tới host trong danh sách trắng AI_FLOW_HTTP_HOST_CHO_PHEP (chặn SSRF, ghim IP); không đọc bảng dữ liệu nhà máy." },
  "tich-hop.http-gui": { kieu: "khong", lyDo: "Gửi HTTP tới host trong danh sách trắng (chặn SSRF, atMostOnce + Idempotency-Key); không đọc bảng dữ liệu nhà máy." },
};
