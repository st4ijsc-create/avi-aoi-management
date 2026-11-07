/**
 * SCADA 1b — hợp đồng kênh đẩy `scada:*` phía CLIENT (bản chép có kiểm của `server/services/scada/scadaSocket.ts:61-124`, 1a @d980d4844).
 * Máy chủ là nguồn sự thật; tệp này KHÔNG import máy chủ (client không được kéo mã server). `scadaLiveContract.drift.test.ts` đọc tệp máy chủ
 * và đòi: tập `capMs`, mã lỗi, `GIOI_HAN`, tên trường của Subscribe/Snapshot/Delta/Tick KHỚP — lệch ⇒ đỏ.
 */
export const CAP_MS_HOP_LE = [50, 100, 250, 1000] as const;
export type CapMs = (typeof CAP_MS_HOP_LE)[number];

export type MaLoiScada = "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "TOO_MANY_HOT" | "DISABLED" | "BUSY";
export const MA_LOI_SCADA: readonly MaLoiScada[] = ["BAD_REQUEST", "TOO_MANY_TAGS", "TOO_MANY_SUBS", "TOO_MANY_HOT", "DISABLED", "BUSY"];

export type TrangThaiKetNoi = "connecting" | "connected" | "lost" | "disabled";

/** [adapterId, tagKey, v, q, ts, ageMs, stale, reason] — `ageMs = -1` và `ts = 0` khi bộ đệm CHƯA có mẫu. */
export type GiaTriGoi = [
  adapterId: number,
  tagKey: string,
  v: number | string | boolean | null,
  q: "good" | "uncertain" | "bad",
  ts: number,
  ageMs: number,
  stale: boolean,
  reason: string | null,
];

export type KhoaTagScada = `${number}:${string}`;
export type TagScada = { adapterId: number; tagKey: string };

export type ScadaSubscribe = { subId?: string; tags: TagScada[]; capMs?: CapMs; nguon?: "that" };
export type ScadaSnapshot = {
  subId: string;
  seq: number;
  serverTs: number;
  values: GiaTriGoi[];
  staleAfterMs: Record<KhoaTagScada, number>;
  denied: TagScada[];
};
export type ScadaDelta = {
  subId: string;
  seq: number;
  serverTs: number;
  values: GiaTriGoi[];
  staleAfterMs?: Record<KhoaTagScada, number>;
};
export type ScadaTickAdapter = { adapterId: number; trangThai: TrangThaiKetNoi | null; tuoiMauMoiNhatMs: number | null };
export type ScadaTick = {
  subId: string;
  seq: number;
  serverTs: number;
  adapters: ScadaTickAdapter[];
  staleAfterMs?: Record<KhoaTagScada, number>;
};

/** Giá trị client PHẢI khớp `GIOI_HAN` của máy chủ (drift test). */
export const GIOI_HAN_CLIENT = {
  tagMoiDangKy: 500,
  dangKyMoiSocket: 10,
  chuKyDeltaMs: 250,
  buocVongMs: 50,
  capMsToiThieu: 50,
  tickMs: 1000,
  nguongNongMs: 250,
  nongMoiSocket: 2,
  nongMoiNguoi: 3,
} as const;

/** Tên trường mỗi kiểu — drift test so với tệp máy chủ. `?` ở cuối = tuỳ chọn. */
export const TRUONG_HOP_DONG = {
  ScadaSubscribe: ["subId?", "tags", "capMs?", "nguon?"],
  ScadaSnapshot: ["subId", "seq", "serverTs", "values", "staleAfterMs", "denied"],
  ScadaDelta: ["subId", "seq", "serverTs", "values", "staleAfterMs?"],
  ScadaTick: ["subId", "seq", "serverTs", "adapters", "staleAfterMs?"],
  ScadaTickAdapter: ["adapterId", "trangThai", "tuoiMauMoiNhatMs"],
} as const;

export const khoaTag = (adapterId: number, tagKey: string): KhoaTagScada => `${adapterId}:${tagKey}`;
