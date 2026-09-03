/** Khai báo kiểu cho `viStringScan.mjs` — xem ghi chú ở `dataErrorStringScan.d.mts`. */
export interface KetQuaHinhDangBa {
  total: number;
  byFile: Array<[string, number]>;
  chamTran: number;
  dong: string[];
}

export declare function demHinhDangBa(clientSrc?: string, chiTiet?: boolean): KetQuaHinhDangBa;
