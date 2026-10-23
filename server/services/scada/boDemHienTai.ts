/**
 * SCADA R0 Task 7 — BỘ ĐỆM GIÁ TRỊ HIỆN TẠI: (adapterId, tagKey) → giá trị + chất lượng + tuổi.
 *
 * Nguồn sự thật DUY NHẤT cho kênh socket SCADA (Task 8), khoá an toàn (Task 9) và màn M10 (Task 10).
 *
 * ⚠ CHỈ CHẠY TRONG TIẾN TRÌNH API (nơi ingest chạy — `server/_core/index.ts`, sau `startOt`, sau cờ
 *   `SCADA_LIVE_CACHE_ENABLED`). KHÔNG khởi động trong `worker.ts`: worker không ingest ⇒ bộ đệm ở đó sẽ rỗng/cũ.
 *
 * Nuôi bằng hai đường:
 *   1. `registerTelemetryTap` của telemetryBus — mỗi lô hàng ĐÃ ghi DB + đã broadcast (đường batch: tại flush).
 *   2. Khi khởi động: nạp hàng mới nhất mỗi (thiết bị, tag) từ DB (cửa sổ 24 h). Giá trị nạp mang TUỔI THẬT
 *      (`rx = ingestedAt` của hàng, KHÔNG phải giờ khởi động) ⇒ sau restart chúng hiện `stale`, không giả "tốt, mới".
 *
 * Phụ thuộc một chiều: otManager → module này (`datThongTinAdapter`). Module này KHÔNG import otManager.
 *
 * `stale = now - rx > max(3 * pollMs, coDeadband ? 70_000 : 0)`; adapter chưa có thông tin ⇒ pollMs 5000, không deadband.
 */
import type { InsertOtTelemetry } from "../../../drizzle/schema";
import type { LyDoChatLuong, OtQuality } from "../ot/otDriver";
import { registerTelemetryTap } from "../telemetryBus";
import { layMoiNhatTheoThietBi } from "../../db/otTelemetry";

export interface GiaTriHienTai {
  adapterId: number;
  tagKey: string;
  machineId: number | null;
  v: number | string | boolean | null;
  q: OtQuality;
  statusCode: string | null;
  reason: LyDoChatLuong | null;
  /** Giờ nguồn của mẫu (ms). */
  ts: number;
  /** Chỉ có khi `meta.tsSource` của hàng khai; ingest hiện KHÔNG đặt khoá này vào meta ⇒ thực tế luôn null. */
  tsSource: "device" | "server" | null;
  /** Giờ máy chủ nhận (ms): `ingestedAt` của hàng nếu có, không thì lúc tap chạy. */
  rx: number;
  /** ≤ 50 giá trị số gần nhất, cũ → mới. */
  lichSu: number[];
}

export interface GiaTriCoTuoi extends GiaTriHienTai {
  ageMs: number;
  stale: boolean;
}

export interface ThongTinAdapter {
  pollMs: number;
  coDeadband: boolean;
  machineId: number | null;
  code: string;
}

export const SO_LICH_SU_TOI_DA = 50;
export const POLL_MAC_DINH_MS = 5000;
/** Tag có deadband có thể im lặng tới heartbeat 60 s (+10 s dung sai) mà vẫn còn tươi. */
export const NGUONG_DEADBAND_MS = 70_000;
/** Cửa sổ nạp DB khi khởi động. */
export const NAP_TU_DB_MS = 24 * 3600_000;

const LY_DO_HOP_LE: ReadonlySet<string> = new Set(["comm_lost", "device_error", "config_error", "out_of_range", "stale"]);
const CHAT_LUONG_HOP_LE: ReadonlySet<string> = new Set(["good", "bad", "uncertain"]);

const khoa = (adapterId: number, tagKey: string): string => `${adapterId}:${tagKey}`;

let boDem = new Map<string, GiaTriHienTai>();
let thongTin = new Map<number, ThongTinAdapter>();
let nguoiNghe = new Set<(keys: string[]) => void>();
let huyTap: (() => void) | null = null;
let dangKhoiDong: Promise<void> | null = null;

export function datThongTinAdapter(adapterId: number, t: ThongTinAdapter): void {
  thongTin.set(adapterId, { pollMs: t.pollMs, coDeadband: t.coDeadband, machineId: t.machineId, code: t.code });
}

export function thongTinAdapter(adapterId: number): ThongTinAdapter | null {
  const t = thongTin.get(adapterId);
  return t ? { ...t } : null;
}

function gioMs(v: unknown): number | null {
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string" || typeof v === "number") {
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Áp MỘT hàng vào bộ đệm; trả khoá nếu có đổi. `chiNeuChuaCo`: dùng khi nạp DB — không đè giá trị sống đã tới. */
function apMotHang(row: InsertOtTelemetry, now: number, chiNeuChuaCo: boolean): string | null {
  const meta = (row.meta ?? null) as Record<string, unknown> | null;
  const adapterId = meta?.adapterId;
  if (typeof adapterId !== "number" || !Number.isFinite(adapterId)) return null;
  const tagKeyMeta = meta?.tagKey;
  const tagKey = typeof tagKeyMeta === "string" && tagKeyMeta !== "" ? tagKeyMeta : row.metric;
  if (typeof tagKey !== "string" || tagKey === "") return null;
  const k = khoa(adapterId, tagKey);
  const cu = boDem.get(k);
  if (cu && chiNeuChuaCo) return null;

  const q: OtQuality = CHAT_LUONG_HOP_LE.has(row.quality as string) ? (row.quality as OtQuality) : "good";
  let v: GiaTriHienTai["v"] = null;
  if (row.numValue != null) v = row.numValue;
  else if (row.textValue != null) v = row.textValue;
  else if (row.boolValue != null) v = row.boolValue;

  const rx = gioMs(row.ingestedAt) ?? now;
  const ts = gioMs(row.ts) ?? rx;
  // Mới nhất theo ts thắng: hàng cũ hơn (replay store-and-forward…) KHÔNG đè giá trị hiện tại, không đổi rx/lichSu, không thành khoá đổi.
  // Đồng hồ thiết bị nhảy lùi ⇒ mục đứng yên rồi stale (hỏng nhìn thấy được). ts bằng nhau ⇒ thay.
  if (cu && ts < cu.ts) return null;
  // uncertain không mang giá trị ⇒ giữ giá trị cuối đã biết; bad giữ nguyên v của hàng (null).
  if (q === "uncertain" && v === null && cu) v = cu.v;

  const lichSu = cu ? cu.lichSu.slice() : [];
  if (q !== "bad" && typeof row.numValue === "number" && Number.isFinite(row.numValue)) {
    lichSu.push(row.numValue);
    if (lichSu.length > SO_LICH_SU_TOI_DA) lichSu.splice(0, lichSu.length - SO_LICH_SU_TOI_DA);
  }

  const tsSourceMeta = meta?.tsSource;
  const reasonMeta = meta?.reason;
  const statusMeta = meta?.statusCode;
  boDem.set(k, {
    adapterId,
    tagKey,
    machineId: row.machineId ?? thongTin.get(adapterId)?.machineId ?? null,
    v,
    q,
    statusCode: typeof statusMeta === "string" ? statusMeta : null,
    reason: typeof reasonMeta === "string" && LY_DO_HOP_LE.has(reasonMeta) ? (reasonMeta as LyDoChatLuong) : null,
    ts,
    tsSource: tsSourceMeta === "device" || tsSourceMeta === "server" ? tsSourceMeta : null,
    rx,
    lichSu,
  });
  return k;
}

function thongBao(keys: string[]): void {
  if (keys.length === 0) return;
  for (const cb of [...nguoiNghe]) {
    try {
      cb(keys);
    } catch (err) {
      console.error("[SCADA] người nghe thay đổi bộ đệm lỗi:", (err as Error)?.message ?? err);
    }
  }
}

function napNoiBo(rows: InsertOtTelemetry[], now: number, chiNeuChuaCo: boolean): string[] {
  const doi = new Set<string>();
  for (const r of rows) {
    try {
      const k = apMotHang(r, now, chiNeuChuaCo);
      if (k) doi.add(k);
    } catch (err) {
      console.error("[SCADA] bỏ hàng lỗi khi nạp bộ đệm:", (err as Error)?.message ?? err);
    }
  }
  const keys = [...doi];
  thongBao(keys);
  return keys;
}

/** Nạp một lô hàng ot_telemetry (từ tap). Trả khoá `"${adapterId}:${tagKey}"` vừa đổi; bỏ hàng không có `meta.adapterId`. */
export function napTuTap(rows: InsertOtTelemetry[], now: number = Date.now()): string[] {
  return napNoiBo(rows, now, false);
}

function lamTuoi(g: GiaTriHienTai, now: number): GiaTriCoTuoi {
  const t = thongTin.get(g.adapterId);
  const pollMs = t?.pollMs ?? POLL_MAC_DINH_MS;
  const coDeadband = t?.coDeadband ?? false;
  const nguong = Math.max(3 * pollMs, coDeadband ? NGUONG_DEADBAND_MS : 0);
  const tuoi = now - g.rx;
  return { ...g, lichSu: g.lichSu.slice(), ageMs: Math.max(0, tuoi), stale: tuoi > nguong };
}

export function layGiaTri(adapterId: number, tagKey: string, now: number = Date.now()): GiaTriCoTuoi | null {
  const g = boDem.get(khoa(adapterId, tagKey));
  return g ? lamTuoi(g, now) : null;
}

/** Mọi adapter của máy có tag này (có thể >1 — người gọi tự xử lý, vd khoá an toàn coi là thiếu dữ liệu). */
export function timTheoMayVaTag(machineId: number, tagKey: string, now: number = Date.now()): GiaTriCoTuoi[] {
  const out: GiaTriCoTuoi[] = [];
  for (const g of boDem.values()) {
    if (g.machineId === machineId && g.tagKey === tagKey) out.push(lamTuoi(g, now));
  }
  return out;
}

export function dangKyThayDoi(cb: (keys: string[]) => void): () => void {
  nguoiNghe.add(cb);
  return () => {
    nguoiNghe.delete(cb);
  };
}

async function napTuDb(): Promise<void> {
  const theoMa = new Map<string, number>();
  for (const [id, t] of thongTin) theoMa.set(t.code, id);
  if (theoMa.size === 0) return;
  const rows = await layMoiNhatTheoThietBi([...theoMa.keys()], NAP_TU_DB_MS);
  const now = Date.now();
  const lo: InsertOtTelemetry[] = [];
  for (const r of rows) {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const adapterId = typeof m.adapterId === "number" ? m.adapterId : theoMa.get(r.deviceId);
    if (adapterId === undefined) continue;
    lo.push({
      ts: r.ts,
      deviceId: r.deviceId,
      protocol: "other",
      metric: r.metric,
      numValue: r.numValue,
      textValue: r.textValue,
      boolValue: r.boolValue,
      quality: r.quality as InsertOtTelemetry["quality"],
      meta: { ...m, adapterId, tagKey: typeof m.tagKey === "string" ? m.tagKey : r.metric },
      ingestedAt: r.ingestedAt,
    });
  }
  // rx = ingestedAt của hàng (tuổi thật). Tap đã đăng ký trước ⇒ giá trị sống tới sớm hơn không bị ghi đè.
  napNoiBo(lo, now, true);
}

/** Đăng ký tap + nạp từ DB các adapter đã `datThongTinAdapter`. Idempotent; lỗi nạp DB chỉ log (bộ đệm vẫn nuôi bằng tap). */
export function khoiDongBoDemHienTai(): Promise<void> {
  if (dangKhoiDong) return dangKhoiDong;
  if (!huyTap) huyTap = registerTelemetryTap((rows) => void napTuTap(rows));
  dangKhoiDong = (async () => {
    try {
      await napTuDb();
    } catch (err) {
      console.error("[SCADA] nạp bộ đệm từ DB lỗi (tiếp tục bằng tap):", (err as Error)?.message ?? err);
    }
  })();
  return dangKhoiDong;
}

/** Chỉ cho test: gỡ tap, xoá dữ liệu, thông tin adapter và người nghe. */
export function __datLaiBoDemHienTai(): void {
  if (huyTap) huyTap();
  huyTap = null;
  dangKhoiDong = null;
  boDem = new Map();
  thongTin = new Map();
  nguoiNghe = new Set();
}
