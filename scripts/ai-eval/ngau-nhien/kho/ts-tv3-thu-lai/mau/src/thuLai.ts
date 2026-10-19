import { setTimeout as ngu } from "node:timers/promises";

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

const choMacDinh: HamCho = async (ms, signal) => {
  await ngu(ms, undefined, { signal });
};

function loiHuy(signal: AbortSignal): Error {
  const e = new Error("đã huỷ", { cause: signal.reason });
  e.name = "AbortError";
  return e;
}

export async function thuLai<T>(
  fn: (lan: number, signal?: AbortSignal) => T | Promise<T>,
  tuyChon: TuyChonThuLai = {},
): Promise<T> {
  const {
    lanToiDa = 3,
    choMs = 100,
    heSo = 2,
    choToiDaMs = Infinity,
    signal,
    nenThuLai,
    cho = choMacDinh,
  } = tuyChon;
  if (!Number.isInteger(lanToiDa) || lanToiDa < 1) throw new RangeError(`lanToiDa không hợp lệ: ${lanToiDa}`);
  if (!Number.isFinite(choMs) || choMs < 0) throw new RangeError(`choMs không hợp lệ: ${choMs}`);
  if (!Number.isFinite(heSo) || heSo < 1) throw new RangeError(`heSo không hợp lệ: ${heSo}`);
  if (typeof choToiDaMs !== "number" || Number.isNaN(choToiDaMs) || choToiDaMs < 0) {
    throw new RangeError(`choToiDaMs không hợp lệ: ${choToiDaMs}`);
  }

  const dsLoi: unknown[] = [];
  for (let lan = 1; ; lan++) {
    if (signal?.aborted) throw loiHuy(signal);
    try {
      return await fn(lan, signal);
    } catch (loi) {
      if (signal?.aborted) throw loiHuy(signal);
      if (nenThuLai && !nenThuLai(loi, lan)) throw loi;
      dsLoi.push(loi);
      if (lan >= lanToiDa) throw new AggregateError(dsLoi, `thất bại sau ${lanToiDa} lần`);
    }
    const ms = Math.min(choMs * heSo ** (lan - 1), choToiDaMs);
    try {
      await cho(ms, signal);
    } catch (loi) {
      if (signal?.aborted) throw loiHuy(signal);
      throw loi;
    }
  }
}
