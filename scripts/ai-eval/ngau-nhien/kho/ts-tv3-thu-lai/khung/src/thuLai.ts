export type HamCho = (ms: number, signal?: AbortSignal) => Promise<void>;

export type TuyChonThuLai = {
  lanToiDa?: number;
  choMs?: number;
  heSo?: number;
  choToiDaMs?: number;
  signal?: AbortSignal;
  nenThuLai?: (loi: unknown, lan: number) => boolean;
  cho?: HamCho;
};

export async function thuLai<T>(
  fn: (lan: number, signal?: AbortSignal) => T | Promise<T>,
  tuyChon: TuyChonThuLai = {},
): Promise<T> {
  throw new Error("chưa làm");
}
