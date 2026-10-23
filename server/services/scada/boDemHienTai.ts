/**
 * SCADA R0 Task 7 — BỘ ĐỆM GIÁ TRỊ HIỆN TẠI: (adapterId, tagKey) → giá trị + chất lượng + tuổi.
 *
 * Nguồn sự thật DUY NHẤT cho kênh socket SCADA (Task 8), khoá an toàn (Task 9) và màn M10 (Task 10).
 *
 * ⚠ CHỈ CHẠY TRONG TIẾN TRÌNH API (nơi ingest chạy — `server/_core/index.ts`, sau `startOt`, sau cờ
 *   `SCADA_LIVE_CACHE_ENABLED`). KHÔNG khởi động trong `worker.ts`: worker không ingest ⇒ bộ đệm ở đó sẽ rỗng/cũ.
 *
 * Nuôi bằng hai đường — CẢ HAI chỉ tin nguồn trong tiến trình, KHÔNG tin `meta` của hàng telemetry:
 *   1. `napTuOt` — `ingest.ts` (đường OT trong tiến trình) gọi với `RuntimeAdapter` + mẫu OT ngay khi mẫu tới, TRƯỚC và KHÔNG
 *      phụ thuộc việc ghi DB. Khoá (adapterId, tagKey) lấy từ adapter + mẫu. (Bài học bảo mật: tap chung của telemetryBus nhận cả
 *      hàng từ ingest NGOÀI — /api/ot/ingest, /api/v1, MQTT — mà `meta` do người gọi tuỳ ý đặt ⇒ giả mạo giá trị vào khoá an toàn.)
 *   2. Khi khởi động: nạp hàng mới nhất mỗi (thiết bị, tag) từ DB (cửa sổ 24 h) CHỈ cho adapter đã `datThongTinAdapter` và
 *      hàng có `deviceId === code` của adapter đó; adapterId/tagKey suy từ sổ đăng ký (code → adapterId, metric → tagKey).
 *      Giá trị nạp mang TUỔI THẬT (`rx = ingestedAt` của hàng, KHÔNG phải giờ khởi động) ⇒ sau restart chúng hiện `stale`.
 *      Mục nạp DB bắt đầu với `lichSu` RỖNG (final I3): chuỗi "N điểm liên tiếp" không nối qua một lần khởi động lại.
 *
 * Thứ tự (final I4): đường sống `napTuOt` xếp theo THỨ TỰ NHẬN (`rx`), KHÔNG theo `ts` — mẫu xấu mang giờ máy chủ còn mẫu tốt OPC UA
 * mang `sourceTimestamp` thiết bị; so `ts` trộn hai đồng hồ (giá trị không đổi sau khi cắm lại ⇒ ts thiết bị cũ hơn ⇒ kẹt ở bad).
 * Một adapter chỉ có MỘT lần đọc đang bay ⇒ đường sống không phát lại mẫu cũ. Nạp DB giữ kẹp `ts` của nó.
 *
 * `lichSu` (final I3): mỗi điểm mang `rx` (`lichSuRx`, cùng độ dài); khoảng nhận giữa hai mẫu > ngưỡng stale ⇒ xoá (không nối qua một
 * đoạn im lặng); interlock lọc theo `windowSeconds` của luật trên `lichSuRx`.
 *
 * Phụ thuộc một chiều: otManager → module này (`datThongTinAdapter`), ingest.ts → module này (`napTuOt`).
 * Module này KHÔNG import otManager hay ingest.
 *
 * `stale = now - rx > max(3 * pollMs, coDeadband ? 70_000 : 0)`; adapter chưa có thông tin ⇒ pollMs 5000, không deadband.
 */
import type { LyDoChatLuong, OtQuality, OtSample } from "../ot/otDriver";
import { checkSampleTs } from "../telemetryBus";

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
  /** Mẫu OT khai (`OtSample.tsSource`); nạp từ DB luôn null (cột không có). */
  tsSource: "device" | "server" | null;
  /** Giờ máy chủ nhận (ms): lúc `napTuOt` chạy; nạp DB = `ingestedAt` của hàng. */
  rx: number;
  /** ≤ 50 giá trị số gần nhất, cũ → mới. */
  lichSu: number[];
  /** final I3 — giờ máy chủ nhận (ms) của từng điểm `lichSu`, cùng độ dài, cũ → mới (interlock lọc theo windowSeconds). */
  lichSuRx: number[];
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

/** Đầu vào `datThongTinAdapter`: thêm các tagKey adapter KHAI (final I2 — interlock biết tag nào do OT trung tâm nuôi). */
export interface DangKyAdapter extends ThongTinAdapter {
  tagKeys?: readonly string[];
}

export const SO_LICH_SU_TOI_DA = 50;
export const POLL_MAC_DINH_MS = 5000;
/** Tag có deadband có thể im lặng tới heartbeat 60 s (+10 s dung sai) mà vẫn còn tươi. */
export const NGUONG_DEADBAND_MS = 70_000;
/** Cửa sổ nạp DB khi khởi động. */
export const NAP_TU_DB_MS = 24 * 3600_000;
/** Khi nạp DB: ts tối đa vượt ingestedAt của hàng (dung sai đồng hồ). */
export const TS_VUOT_INGESTED_TOI_DA_MS = 5000;

const LY_DO_HOP_LE: ReadonlySet<string> = new Set(["comm_lost", "device_error", "config_error", "out_of_range", "stale"]);
const CHAT_LUONG_HOP_LE: ReadonlySet<string> = new Set(["good", "bad", "uncertain"]);

const khoa = (adapterId: number, tagKey: string): string => `${adapterId}:${tagKey}`;

let boDem = new Map<string, GiaTriHienTai>();
let thongTin = new Map<number, ThongTinAdapter>();
/** final I2 — adapterId → tagKey adapter OT trung tâm khai (tách khỏi `thongTin`: `thongTinAdapter`/`adapterTheoMa` giữ nguyên hình). */
let tagKhai = new Map<number, Set<string>>();
let nguoiNghe = new Set<(keys: string[]) => void>();
let dangKhoiDong: Promise<void> | null = null;

export function datThongTinAdapter(adapterId: number, t: DangKyAdapter): void {
  thongTin.set(adapterId, { pollMs: t.pollMs, coDeadband: t.coDeadband, machineId: t.machineId, code: t.code });
  if (t.tagKeys && t.tagKeys.length > 0) tagKhai.set(adapterId, new Set(t.tagKeys));
  else tagKhai.delete(adapterId);
}

/**
 * SCADA R0 final I2 — có adapter OT TRUNG TÂM (đã đăng ký trong tiến trình này) của máy `machineId` KHAI `tagKey` không. Bộ đệm chỉ được
 * nuôi bởi đường OT trong tiến trình (`napTuOt`): tag của nguồn khác (edge, MQTT, MTConnect, SECS/GEM, CFX, /api/v1, simulator, bản sao
 * không chạy cổng OT) KHÔNG bao giờ có trong bộ đệm ⇒ interlock phải đọc DB cho chúng. Máy hiệu lực = máy của đăng ký mới nhất.
 */
export function coAdapterTrungTamKhaiTag(machineId: number, tagKey: string): boolean {
  for (const [adapterId, tags] of tagKhai) {
    if (!tags.has(tagKey)) continue;
    if (thongTin.get(adapterId)?.machineId === machineId) return true;
  }
  return false;
}

/** Gỡ adapter (detach/stopOt): xoá thông tin + MỌI mục của nó — không còn trả giá trị cũ cho Task 8/9/10. */
export function xoaAdapter(adapterId: number): void {
  thongTin.delete(adapterId);
  tagKhai.delete(adapterId);
  const tienTo = `${adapterId}:`;
  for (const k of [...boDem.keys()]) if (k.startsWith(tienTo)) boDem.delete(k);
}

/** stopOt: không adapter nào còn do tiến trình này quản ⇒ xoá toàn bộ thông tin + mục (kể cả adapter đang khởi động dở). */
export function xoaTatCaAdapter(): void {
  thongTin = new Map();
  tagKhai = new Map();
  boDem = new Map();
  dangKhoiDong = null;
}

/** Tra adapter đang đăng ký theo `code` (= `deviceId` của hàng telemetry). SCADA R0 Task 9: cổng interlock (đường DB) lấy pollMs để quyết độ tươi. */
export function adapterTheoMa(code: string | null | undefined): (ThongTinAdapter & { adapterId: number }) | null {
  if (!code) return null;
  for (const [adapterId, t] of thongTin) if (t.code === code) return { adapterId, ...t };
  return null;
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

/** Một mẫu đã CHUẨN HOÁ từ nguồn tin cậy — khoá (adapterId, tagKey) KHÔNG lấy từ meta. */
interface Mau {
  adapterId: number;
  tagKey: string;
  machineId: number | null;
  v: GiaTriHienTai["v"];
  q: OtQuality;
  statusCode: string | null;
  reason: LyDoChatLuong | null;
  ts: number;
  tsSource: GiaTriHienTai["tsSource"];
  rx: number;
}

/** Ngưỡng stale (ms) của một adapter: `max(3·poll, coDeadband ? 70 s : 0)`; chưa đăng ký ⇒ poll mặc định, không deadband. */
function nguongCuMs(adapterId: number): number {
  const t = thongTin.get(adapterId);
  const pollMs = t?.pollMs ?? POLL_MAC_DINH_MS;
  return Math.max(3 * pollMs, t?.coDeadband ? NGUONG_DEADBAND_MS : 0);
}

/**
 * Áp MỘT mẫu; trả khoá nếu có đổi. `tuDb` (nạp DB khi khởi động): không đè giá trị sống đã tới, và mục mới bắt đầu với lichSu rỗng.
 * Đường sống: mẫu tới SAU thay mẫu trước (thứ tự nhận — final I4), không so `ts`.
 */
function apMau(m: Mau, tuDb: boolean): string | null {
  const k = khoa(m.adapterId, m.tagKey);
  const cu = boDem.get(k);
  if (cu && tuDb) return null;
  let v = m.v;
  // uncertain không mang giá trị ⇒ giữ giá trị cuối đã biết; bad giữ nguyên v của mẫu (null).
  if (m.q === "uncertain" && v === null && cu) v = cu.v;
  // SCADA R0 Task 9 (fix 1/2): lichSu CHỈ chứa mẫu GOOD dạng số; mẫu không-good (uncertain/bad) XOÁ nó — cửa sổ "N điểm liên tiếp" của
  // interlock không bao giờ nối các mẫu qua một đoạn mất kết nối hoặc một giá trị không chắc.
  // final I3: (a) mục nạp DB bắt đầu RỖNG (không nối qua khởi động lại); (b) khoảng NHẬN giữa mẫu này và mẫu trước > ngưỡng stale ⇒ xoá
  // (đoạn im lặng — mất liên lạc không phát mẫu xấu khi cờ V2 tắt — không được nối hai phía).
  const imLangQuaLau = cu !== undefined && m.rx - cu.rx > nguongCuMs(m.adapterId);
  let lichSu = cu && !imLangQuaLau ? cu.lichSu.slice() : [];
  let lichSuRx = cu && !imLangQuaLau ? cu.lichSuRx.slice() : [];
  if (tuDb || m.q !== "good") {
    lichSu = [];
    lichSuRx = [];
  } else if (typeof m.v === "number" && Number.isFinite(m.v)) {
    lichSu.push(m.v);
    lichSuRx.push(m.rx);
    if (lichSu.length > SO_LICH_SU_TOI_DA) {
      lichSu.splice(0, lichSu.length - SO_LICH_SU_TOI_DA);
      lichSuRx.splice(0, lichSuRx.length - SO_LICH_SU_TOI_DA);
    }
  }
  boDem.set(k, {
    adapterId: m.adapterId,
    tagKey: m.tagKey,
    machineId: m.machineId, // đúng như nguồn khai (null kể cả); máy hiệu lực quyết lúc ĐỌC từ thông tin adapter (lamTuoi)
    v,
    q: m.q,
    statusCode: m.statusCode,
    reason: m.reason,
    ts: m.ts,
    tsSource: m.tsSource,
    rx: m.rx,
    lichSu,
    lichSuRx,
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

function napNoiBo(mau: Mau[], tuDb: boolean): string[] {
  const doi = new Set<string>();
  for (const m of mau) {
    try {
      const k = apMau(m, tuDb);
      if (k) doi.add(k);
    } catch (err) {
      console.error("[SCADA] bỏ mẫu lỗi khi nạp bộ đệm:", (err as Error)?.message ?? err);
    }
  }
  const keys = [...doi];
  thongBao(keys);
  return keys;
}

export function boDemDangBat(): boolean {
  return process.env.SCADA_LIVE_CACHE_ENABLED === "true";
}

/**
 * Nạp mẫu OT từ ĐƯỜNG TRONG TIẾN TRÌNH (`ingest.ts` gọi; KHÔNG phụ thuộc DB ghi được hay không). Khoá lấy từ adapter đáng tin
 * + mẫu, không từ `meta`. No-op rẻ khi SCADA_LIVE_CACHE_ENABLED != "true" hoặc adapter chưa/không còn đăng ký (`datThongTinAdapter`). Mẫu mang `tsReject` (bus sẽ loại) bị bỏ.
 * Trả khoá `"${adapterId}:${tagKey}"` vừa đổi.
 */
export function napTuOt(
  a: { adapterId: number; machineId: number | null },
  samples: OtSample[],
  now: number = Date.now(),
): string[] {
  if (!boDemDangBat() || !samples || samples.length === 0) return [];
  // Chỉ adapter đã `datThongTinAdapter` mới được quản: mẫu tới muộn sau `xoaAdapter`/stopOt không được tạo lại mục (chỉ tiến trình
  // OT đang chạy đăng ký adapter; adapter đã gỡ/chuyển edge thì không).
  if (!thongTin.has(a.adapterId)) return [];
  const mau: Mau[] = [];
  for (const s of samples) {
    if (!s || typeof s.tagKey !== "string" || s.tagKey === "" || s.tsReject) continue;
    // Cùng cổng `ts` với bus (invalid_ts / ts_too_far_future): bus loại mẫu thì bộ đệm cũng bỏ (không hiện thứ DB sẽ không có).
    if (checkSampleTs(s.timestamp, now) !== null) continue;
    const q: OtQuality = CHAT_LUONG_HOP_LE.has(s.quality) ? s.quality : "good";
    const v = s.value === undefined ? null : s.value;
    mau.push({
      adapterId: a.adapterId,
      tagKey: s.tagKey,
      machineId: a.machineId ?? null,
      v: typeof v === "number" && !Number.isFinite(v) ? null : v,
      q,
      statusCode: typeof s.statusCode === "string" ? s.statusCode : null,
      reason: s.reason !== undefined && LY_DO_HOP_LE.has(s.reason) ? s.reason : null,
      ts: gioMs(s.timestamp) ?? now,
      tsSource: s.tsSource === "device" || s.tsSource === "server" ? s.tsSource : null,
      rx: now,
    });
  }
  return napNoiBo(mau, false);
}

function lamTuoi(g: GiaTriHienTai, now: number): GiaTriCoTuoi {
  const t = thongTin.get(g.adapterId);
  const nguong = nguongCuMs(g.adapterId);
  const tuoi = now - g.rx;
  // Máy hiệu lực quyết lúc ĐỌC: adapter đã chuyển/gỡ máy (thongTin.machineId null) ⇒ không còn thuộc máy cũ. Chỉ khi KHÔNG có
  // thông tin adapter mới dùng giá trị đã lưu.
  const machineId = t ? t.machineId : g.machineId;
  return { ...g, machineId, lichSu: g.lichSu.slice(), lichSuRx: g.lichSuRx.slice(), ageMs: Math.max(0, tuoi), stale: tuoi > nguong };
}

export function layGiaTri(adapterId: number, tagKey: string, now: number = Date.now()): GiaTriCoTuoi | null {
  const g = boDem.get(khoa(adapterId, tagKey));
  return g ? lamTuoi(g, now) : null;
}

/** Mọi adapter của máy có tag này (có thể >1 — người gọi tự xử lý, vd khoá an toàn coi là thiếu dữ liệu). */
export function timTheoMayVaTag(machineId: number, tagKey: string, now: number = Date.now()): GiaTriCoTuoi[] {
  const out: GiaTriCoTuoi[] = [];
  for (const g of boDem.values()) {
    if (g.tagKey !== tagKey) continue;
    const gt = lamTuoi(g, now);
    if (gt.machineId === machineId) out.push(gt);
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
  // import động: ingest.ts nạp module này tĩnh; không kéo lớp DB vào mọi nơi nạp ingest (và các test mock schema)
  const { layMoiNhatTheoThietBi } = await import("../../db/otTelemetry");
  const rows = await layMoiNhatTheoThietBi([...theoMa.keys()], NAP_TU_DB_MS);
  const mau: Mau[] = [];
  for (const r of rows) {
    // Chỉ hàng của adapter đã đăng ký: deviceId PHẢI là code của adapter; adapterId/tagKey từ sổ đăng ký (code → adapterId, metric).
    const adapterId = theoMa.get(r.deviceId);
    if (adapterId === undefined || !r.metric) continue;
    const info = thongTin.get(adapterId);
    if (!info || info.code !== r.deviceId) continue;
    const m = (r.meta ?? {}) as Record<string, unknown>;
    // Đường ingest NGOÀI đã bị gỡ meta.adapterId ⇒ chỉ hàng do OT trong tiến trình ghi mới khớp.
    if (m.adapterId !== adapterId) continue;
    const q: OtQuality = CHAT_LUONG_HOP_LE.has(r.quality) ? (r.quality as OtQuality) : "good";
    const v = r.numValue ?? r.textValue ?? r.boolValue ?? null;
    const rx = gioMs(r.ingestedAt);
    if (rx === null) continue;
    mau.push({
      adapterId,
      tagKey: r.metric,
      machineId: info.machineId,
      v,
      q,
      statusCode: typeof m.statusCode === "string" ? m.statusCode : null,
      reason: typeof m.reason === "string" && LY_DO_HOP_LE.has(m.reason) ? (m.reason as LyDoChatLuong) : null,
      // ts không được vượt ingestedAt quá 5 s (dung sai đồng hồ; ts tương lai trong DB không hiện ra như giờ nguồn hợp lệ).
      ts: Math.min(gioMs(r.ts) ?? rx, rx + TS_VUOT_INGESTED_TOI_DA_MS),
      tsSource: null,
      rx, // tuổi THẬT của hàng, không phải giờ khởi động
    });
  }
  // Giá trị sống đã tới trong lúc truy vấn không bị ghi đè.
  napNoiBo(mau, true);
}

/** Nạp từ DB các adapter đã `datThongTinAdapter`. Idempotent; lỗi nạp DB chỉ log (bộ đệm vẫn nuôi bằng `napTuOt`). */
export function khoiDongBoDemHienTai(): Promise<void> {
  if (dangKhoiDong) return dangKhoiDong;
  dangKhoiDong = (async () => {
    try {
      await napTuDb();
    } catch (err) {
      console.error("[SCADA] nạp bộ đệm từ DB lỗi (tiếp tục bằng mẫu sống):", (err as Error)?.message ?? err);
    }
  })();
  return dangKhoiDong;
}

/** Chỉ cho test: xoá dữ liệu, thông tin adapter, người nghe và cờ đã khởi động. */
export function __datLaiBoDemHienTai(): void {
  dangKhoiDong = null;
  boDem = new Map();
  thongTin = new Map();
  tagKhai = new Map();
  nguoiNghe = new Set();
}
