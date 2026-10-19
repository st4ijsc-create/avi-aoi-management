// Tệp CHO SẴN — không sửa. Kiểu miền, giao diện kho và lỗi nghiệp vụ.

export type Ban = { ma: string; sucChua: number };

export type TrangThai = "hieu-luc" | "da-huy";

export type DatBan = {
  id: string; // "DB-0001", "DB-0002", …
  maBan: string;
  ten: string;
  soKhach: number;
  ngay: string; // "YYYY-MM-DD"
  batDau: string; // "HH:MM"
  ketThuc: string; // "HH:MM"
  trangThai: TrangThai;
};

export type YeuCauDat = {
  ten: string;
  soKhach: number;
  ngay: string; // "YYYY-MM-DD"
  gio: string; // "HH:MM" — giờ bắt đầu
  soPhut?: number; // mặc định 90
  maBan?: string; // không có ⇒ dịch vụ tự chọn bàn
};

export type CauHinhNhaHang = { moCua: string; dongCua: string }; // "HH:MM"

export interface KhoDatBan {
  layBan(ma: string): Ban | undefined;
  dsBan(): Ban[];
  luuBan(ban: Ban): void;
  layDat(id: string): DatBan | undefined;
  dsDat(): DatBan[];
  luuDat(dat: DatBan): void;
}

export type MaLoi =
  | "DU_LIEU_SAI"
  | "BAN_TRUNG"
  | "KHONG_TIM_THAY"
  | "VUOT_SUC_CHUA"
  | "TRUNG_GIO"
  | "HET_BAN"
  | "NGOAI_GIO"
  | "DA_HUY";

export class LoiNghiepVu extends Error {
  readonly ma: MaLoi;

  constructor(ma: MaLoi, thongDiep?: string) {
    super(thongDiep ?? ma);
    this.name = "LoiNghiepVu";
    this.ma = ma;
  }
}
