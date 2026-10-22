/** Khai kiểu cho `shared/stNhacSua.mjs` (lời nhắc sửa theo lỗi biên dịch ST — một nguồn cho bộ đo M và sản phẩm). */
export declare const TEN_TRINH_DICH_ST: { readonly rusty: string; readonly matiec: string };
export declare const TRAN_DONG_LOI_ST: number;
export declare function dongLoiST(d: {
  tep: string | null;
  dong: number | null;
  cot: number | null;
  ma: string | null;
  thongDiep: string;
}): string;
export declare function cauNhacSuaST(y: { trinhDich: string; laScl: boolean; loi: string[]; dinhDangTep: boolean }): string;
