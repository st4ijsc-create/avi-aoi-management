/** Khai báo kiểu cho `rawErrorMessageScan.mjs` — xem ghi chú ở `dataErrorStringScan.d.mts`. */
export interface MucRawMessage {
  file: string;
  dong: number;
  cau: string;
}

export declare function demRawMessage(goc?: string): MucRawMessage[];
export declare function duyetFile(goc: string): string[];
export declare const DAU_MIEN_TRU: RegExp;
