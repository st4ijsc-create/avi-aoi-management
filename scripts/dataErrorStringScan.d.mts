/**
 * Khai báo kiểu cho `dataErrorStringScan.mjs` — để `check:tests` (chặt hơn `check`,
 * có noImplicitAny) đọc được import `.mjs` từ cổng `dataErrorStringCensus.test.ts`.
 *
 * ⚠ Kiểu ở đây là HỢP ĐỒNG của bộ đếm: đổi hình dạng trả về trong `.mjs` thì phải đổi
 * file này CÙNG commit — lệch nhau là cổng biên dịch đỏ ngay (đó là chủ đích).
 */
export interface MucDataError {
  file: string;
  dong: number;
  cau: string;
  kenh: "trpc" | "rest" | "log" | "service";
}

export declare function demDataError(goc?: string): MucDataError[];
export declare function duyetTs(goc: string): string[];
export declare const DAU_MIEN_TRU: RegExp;
