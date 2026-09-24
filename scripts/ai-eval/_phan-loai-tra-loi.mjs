// Phân loại HÌNH DẠNG câu trả lời cho bộ chấm đầu–cuối (`kb-dau-cuoi.mjs`) — không chấm ĐÚNG/SAI, chỉ nói câu trả lời có
// phải là một LỜI KHÔNG TRẢ LỜI không. Theo thứ tự ưu tiên:
//   "tu-choi"     — câu từ chối CHUẨN của hệ thống ("không có thông tin chính xác…"), ở BẤT KỲ đâu (như bộ chấm cũ).
//   "tu-choi-mem" — CÂU ĐẦU TIÊN tuyên bố TÀI LIỆU không có điều được hỏi ("Tài liệu hiện tại không mô tả…", "Không có
//                   thông tin về…", "X không được liệt kê trong tài liệu"). Đo được ở model 35B (N21 N31, vòng 7): từ chối
//                   về nội dung nhưng khác chữ câu chuẩn ⇒ bộ chấm cũ đếm là "trả lời".
//   "hoi-lai"     — câu trả lời CHỈ là một câu hỏi lại ngắn ("Bạn muốn xem trạng thái máy nào…?") — không trả lời, không bịa.
//   null          — còn lại: một câu trả lời thật (đúng/sai do regex đáp án quyết).
// ⚠ Chủ ngữ phải là TÀI LIỆU, không phải DỮ LIỆU sống: "Không có dữ liệu OEE cho line 1" là câu trả lời SỐ LIỆU (rỗng).
// ⚠ Chỉ CÂU ĐẦU: câu trả lời đúng hay có một vế "tài liệu không nêu X" ở giữa bài (S07 S09 TL03 — kiểm bằng census).
// ⚠ Không dùng \b với chữ Việt (xem server/services/ai/cauHoiQuyTac.ts).
export const TU_CHOI_CHUAN = /không có thông tin chính xác/i;

const MO_DAU = 220;
const phang = (s) => String(s ?? "").replace(/[*`#>_]/g, " ").replace(/\s+/g, " ").trim();
/** Bỏ khung "(1) Tóm tắt", "1.", "Tóm tắt:" ở đầu để phần còn lại bắt đầu bằng CÂU thật. */
const boKhung = (s) => s.replace(/^(?:\(?\d+[.)]\s*)?(?:tóm tắt\s*:?\s*)?/i, "");
/** Câu đầu: tới dấu kết câu đầu tiên, hoặc tới khung "(2)". */
const cauDauCua = (s) => boKhung(s).slice(0, MO_DAU).split(/(?<=[.?!])\s|\s\(2\)\s/)[0];

const MEM = [
  /^[^.?!]{0,40}?(?:tài liệu|ngữ cảnh|các đoạn trích)(?: hiện tại| hiện có| được cung cấp| tham khảo| kỹ thuật)?\s+(?:không|chưa)\s+(?:cung cấp|liệt kê|đề cập|nêu|chứa|ghi|mô tả|nói|có thông tin|có hướng dẫn)/i,
  /^không (?:có|tìm thấy) (?:thông tin|hướng dẫn|tài liệu)(?: cụ thể| chi tiết)? (?:về|cho|liên quan)/i,
  /^[^.?!]{0,80}?không được (?:liệt kê|đề cập|mô tả|nêu|ghi) (?:trong|ở) (?:tài liệu|ngữ cảnh|các phần)/i,
];
const HOI_LAI = /^(?:bạn|anh|chị)\s+(?:muốn|cần|đang hỏi|hãy cho biết|vui lòng)[^?]{0,200}\?/i;

// Bỏ định dạng markdown (**đậm**, `mã`) TRƯỚC khi so mẫu đáp án: "**không** được tính" là câu trả lời đúng mà mẫu
// /không được tính/ trượt (đo được ở T67). KHÔNG bỏ "_": production_manager, quality_engineer…
const phangDapAn = (s) => String(s ?? "").replace(/[*`]/g, "");

/**
 * Chấm MỘT câu: câu trong corpus đạt theo đáp án (`dapAn` bảng nguồn HOẶC `dapAnTraLoi` cách người trả lời) TRƯỚC — câu
 * trả lời có đáp án đúng là ĐẠT dù mở đầu bằng lời từ chối (T16 T18 T43) — rồi mới tới hình dạng.
 * @returns {"dung"|"tu-choi"|"tu-choi-mem"|"hoi-lai"|"sai"|"tra-loi"}
 */
export function chamMot(cau, text) {
  const ngoai = (cau.nguon ?? []).length === 0;
  if (!ngoai && [cau.dapAn, cau.dapAnTraLoi].some((d) => d && new RegExp(d.regex, d.flags ?? "i").test(phangDapAn(text)))) return "dung";
  return phanLoaiTraLoi(text) ?? (ngoai ? "tra-loi" : "sai");
}

/** Tóm tắt một lượt. `ngoai.traLoi` CHỈ đếm câu trả lời THẬT (từ 2026-09-24; trước đó gộp tu-choi-mem/hoi-lai). */
export function tomTat(ra) {
  const dem = (f) => ra.filter(f).length;
  const tr = (k) => dem((x) => !x.ngoai && x.kq === k);
  const ng = (k) => dem((x) => x.ngoai && x.kq === k);
  return {
    trong: { n: dem((x) => !x.ngoai), dung: tr("dung"), tuChoi: tr("tu-choi"), tuChoiMem: tr("tu-choi-mem"), hoiLai: tr("hoi-lai"), sai: tr("sai") },
    ngoai: { n: dem((x) => x.ngoai), tuChoi: ng("tu-choi"), tuChoiMem: ng("tu-choi-mem"), hoiLai: ng("hoi-lai"), traLoi: ng("tra-loi") },
    loi: dem((x) => x.kq === "loi"),
  };
}

/** @returns {"tu-choi"|"tu-choi-mem"|"hoi-lai"|null} */
export function phanLoaiTraLoi(text) {
  const t = phang(text);
  if (!t) return null;
  if (TU_CHOI_CHUAN.test(t)) return "tu-choi";
  if (MEM.some((re) => re.test(cauDauCua(t)))) return "tu-choi-mem";
  if (t.length < 400 && HOI_LAI.test(boKhung(t))) return "hoi-lai";
  return null;
}
