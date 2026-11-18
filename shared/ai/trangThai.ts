/**
 * Kế hoạch cải tiến Thợ Cả v1.0 · E1 (UX-C11) — TRẠNG THÁI DÙNG CHUNG cho web + extension.
 * DỮ LIỆU THUẦN: không import máy chủ/React/vscode, không đọc env. Cả hai bề mặt vẽ từ cùng một bảng
 * nên một lỗi không thể có thông điệp khác nhau (hoặc chỉ có nút "Đóng") ở hai nơi.
 *
 * Bất biến (ghim ở `trangThai.test.ts`):
 *  - đúng 9 trạng thái, mã duy nhất;
 *  - mỗi trạng thái LỖI/CẢNH BÁO có ≥ 1 hành động KHÁC "dong";
 *  - mỗi trạng thái có đúng một hành động chính và nó không phải "dong".
 */

export type MucDoTrangThai = "loi" | "canhBao" | "thongTin" | "thanhCong";

/** Mã hành động: bề mặt tự nối vào việc cụ thể (nút web / lệnh extension). */
export type MaHanhDong =
  | "ket-noi-lai"
  | "thu-lai"
  | "xem-nhat-ky"
  | "doi-model"
  | "giai-phong-vram"
  | "tom-tat-phien"
  | "phien-moi"
  | "dung-tac-nhan"
  | "doi-huong"
  | "xem-nguon"
  | "bo-qua-du-lieu"
  | "xem-ket-qua"
  | "bat-dau-nhap"
  | "dong";

export interface HanhDongTrangThai {
  ma: MaHanhDong;
  nhan: string;
  /** Đúng một hành động chính mỗi trạng thái. */
  chinh?: true;
}

export type MaTrangThai =
  | "mat-ket-noi"
  | "dang-nap"
  | "het-bo-nho"
  | "ngu-canh-day"
  | "vong-lap"
  | "dau-ra-hong"
  | "chi-thi-nhung"
  | "hoan-tat"
  | "phien-trong";

export interface TrangThaiAi {
  ma: MaTrangThai;
  mucDo: MucDoTrangThai;
  tieuDe: string;
  /** Một câu: chuyện gì xảy ra + hệ quả với người dùng (không thuật ngữ nội bộ). */
  moTa: string;
  hanhDong: readonly HanhDongTrangThai[];
}

const DONG: HanhDongTrangThai = { ma: "dong", nhan: "Đóng" };

export const TRANG_THAI_AI: readonly TrangThaiAi[] = [
  {
    ma: "mat-ket-noi",
    mucDo: "loi",
    tieuDe: "Mất kết nối tới máy chủ AI",
    moTa: "Không nói chuyện được với máy chủ AI cục bộ; phần đang làm dở chưa mất.",
    hanhDong: [{ ma: "ket-noi-lai", nhan: "Kết nối lại", chinh: true }, { ma: "xem-nhat-ky", nhan: "Xem nhật ký" }, DONG],
  },
  {
    ma: "dang-nap",
    mucDo: "thongTin",
    tieuDe: "Model đang nạp",
    moTa: "Model đang được đưa vào GPU; yêu cầu sẽ chạy ngay khi nạp xong.",
    hanhDong: [{ ma: "xem-nhat-ky", nhan: "Xem tiến độ", chinh: true }],
  },
  {
    ma: "het-bo-nho",
    mucDo: "loi",
    tieuDe: "Hết bộ nhớ GPU",
    moTa: "Không đủ VRAM để chạy yêu cầu này; chưa có thay đổi nào được ghi.",
    hanhDong: [
      { ma: "giai-phong-vram", nhan: "Giải phóng VRAM", chinh: true },
      { ma: "doi-model", nhan: "Dùng model nhẹ hơn" },
      { ma: "thu-lai", nhan: "Thử lại" },
      DONG,
    ],
  },
  {
    ma: "ngu-canh-day",
    mucDo: "canhBao",
    tieuDe: "Ngữ cảnh gần đầy",
    moTa: "Cuộc trò chuyện đã dùng gần hết ngữ cảnh; tiếp tục có thể làm model quên phần đầu.",
    hanhDong: [{ ma: "tom-tat-phien", nhan: "Tóm tắt và tiếp tục", chinh: true }, { ma: "phien-moi", nhan: "Mở phiên mới" }, DONG],
  },
  {
    ma: "vong-lap",
    mucDo: "canhBao",
    tieuDe: "Tác nhân đang lặp lại",
    moTa: "Tác nhân lặp cùng một thao tác mà không tiến triển; nên dừng để tránh tốn công vô ích.",
    hanhDong: [
      { ma: "dung-tac-nhan", nhan: "Dừng tác nhân", chinh: true },
      { ma: "doi-huong", nhan: "Đổi hướng yêu cầu" },
      { ma: "xem-nhat-ky", nhan: "Xem các bước đã làm" },
    ],
  },
  {
    ma: "dau-ra-hong",
    mucDo: "loi",
    tieuDe: "Kết quả của model không đọc được",
    moTa: "Model trả về định dạng sai nên không áp dụng được; chưa có thay đổi nào được ghi.",
    hanhDong: [
      { ma: "thu-lai", nhan: "Thử lại", chinh: true },
      { ma: "doi-model", nhan: "Đổi model" },
      { ma: "xem-nhat-ky", nhan: "Xem phản hồi gốc" },
      DONG,
    ],
  },
  {
    ma: "chi-thi-nhung",
    mucDo: "canhBao",
    tieuDe: "Dữ liệu chứa chỉ thị nghi vấn",
    moTa: "Một tệp hoặc kết quả công cụ có đoạn giống mệnh lệnh cho AI; tác nhân KHÔNG làm theo.",
    hanhDong: [{ ma: "xem-nguon", nhan: "Xem nguồn", chinh: true }, { ma: "bo-qua-du-lieu", nhan: "Bỏ dữ liệu này" }, DONG],
  },
  {
    ma: "hoan-tat",
    mucDo: "thanhCong",
    tieuDe: "Đã hoàn tất",
    moTa: "Tác nhân làm xong; kiểm tra kết quả trước khi áp dụng.",
    hanhDong: [{ ma: "xem-ket-qua", nhan: "Xem kết quả", chinh: true }, { ma: "phien-moi", nhan: "Việc mới" }, DONG],
  },
  {
    ma: "phien-trong",
    mucDo: "thongTin",
    tieuDe: "Chưa có cuộc trò chuyện",
    moTa: "Phiên này chưa có nội dung; mô tả việc cần làm để bắt đầu.",
    hanhDong: [{ ma: "bat-dau-nhap", nhan: "Bắt đầu nhập", chinh: true }],
  },
];

export function trangThaiAi(ma: MaTrangThai): TrangThaiAi {
  const t = TRANG_THAI_AI.find(x => x.ma === ma);
  if (!t) throw new Error(`trạng thái AI không có: ${ma}`);
  return t;
}

/** Hành động chính (luôn có — bất biến ghim ở test). */
export function hanhDongChinh(ma: MaTrangThai): HanhDongTrangThai {
  return trangThaiAi(ma).hanhDong.find(h => h.chinh)!;
}
