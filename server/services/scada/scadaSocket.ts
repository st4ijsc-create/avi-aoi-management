/**
 * SCADA R0 Task 8 — KÊNH SOCKET `scada:subscribe` (C.6): màn SCADA nhận giá trị hiện tại theo từng tag, MỖI TAG KIỂM PHẠM VI NHÀ MÁY.
 * SCADA 1a (2026-11-03, brief scada-ui 2026-11-02 đã duyệt) — thêm ngưỡng cũ theo tag (`staleAfterMs`), nhịp tim `scada:tick` 1 Hz,
 * nhịp khung tuỳ chọn (`capMs`) và số thứ tự khung (`seq`) để màn hình NÓI THẬT khi dữ liệu cũ ("im vì không đổi" ≠ "im vì đường chết").
 *
 * Hợp đồng (kiểu TypeScript ở dưới: ScadaSubscribe / ScadaSnapshot / ScadaDelta / ScadaTick):
 *   vào  `scada:subscribe`   { subId?; tags: { adapterId; tagKey }[]; capMs?: 50|100|250|1000 (vắng ⇒ 250); nguon?: "that" }
 *   ra   `scada:snapshot`    { subId; seq: 0; serverTs; values: GiaTriGoi[]; staleAfterMs: { "<adapterId>:<tagKey>": ms }; denied }
 *   ra   `scada:delta`       { subId; seq; serverTs; values: GiaTriGoi[]; staleAfterMs? }   — MỚI NHẤT mỗi tag, không bỏ tag
 *   ra   `scada:tick`        { subId; seq; serverTs; adapters: { adapterId; trangThai; tuoiMauMoiNhatMs }[]; staleAfterMs? } — mỗi 1000 ms
 *   vào  `scada:unsubscribe` { subId?: string }               — bỏ trống = tất cả
 *   ra   `scada:error`       { code: MaLoiScada }
 *   GiaTriGoi = [adapterId, tagKey, v, q, ts, ageMs, stale, reason] — GIỮ NGUYÊN.
 *   `seq`: MỘT dãy mỗi (socket, subId), chung cho snapshot (0) / delta / tick (+1 mỗi khung); đăng ký lại cùng subId ⇒ snapshot mới, seq 0.
 *   `staleAfterMs` trong delta/tick: CHỈ khi ngưỡng của adapter ĐỔI so với lần gửi trước (đổi poll / bật deadband) — chỉ khoá đổi.
 *
 * An toàn (bảo mật — một người dùng KHÔNG BAO GIỜ nhận tag ngoài phạm vi của mình):
 *   • KHÔNG `socket.join`, KHÔNG `io.emit`: chỉ `socket.emit` tới đúng socket đã đăng ký (census phòng/phát không đổi). `scada:tick` cũng vậy.
 *   • Quyền kiểm TỪNG TAG lúc đăng ký (quyền MỘT lần + phạm vi MỘT `idsTrongPhamVi("machine")` mỗi đăng ký — `taoKiemPhamViTagScada`,
 *     final M4); tag bị từ chối ⇒ `denied`, KHÔNG gửi giá trị, KHÔNG có khoá trong `staleAfterMs`, adapter của nó KHÔNG vào tick.
 *     Adapter không tồn tại ⇒ cũng `denied` (cùng kết quả với ngoài phạm vi: không lộ tồn tại).
 *   • Delta/tick chỉ mang tag/adapter ĐÃ ĐĂNG KÝ + ĐÃ ĐƯỢC PHÉP. Máy hiệu lực của adapter được bộ đệm quyết lúc ĐỌC; nếu khác máy đã kiểm lúc
 *     đăng ký (adapter bị chuyển máy giữa chừng) ⇒ KHÔNG gửi giá trị, ngưỡng hay trạng thái của nó (người dùng phải đăng ký lại để kiểm lại).
 *   • Tick KHÔNG mang tagKey / giá trị (chỉ id adapter đã được phép + trạng thái kết nối + tuổi mẫu mới nhất trong các tag được phép).
 *   • Quá giới hạn ⇒ từ chối có mã (`TOO_MANY_TAGS` / `TOO_MANY_SUBS` / `TOO_MANY_HOT`), KHÔNG cắt bớt im lặng.
 *   • Adapter có trong DB nhưng không do trung tâm quản (edge…): xét phạm vi theo `device_adapters.machineId`, trả `v:null, q:"bad", reason:"stale"`.
 *
 * Vòng đẩy (1a): MỘT `setInterval(GIOI_HAN.buocVongMs = 50 ms)` (unref) + MỘT người nghe `dangKyThayDoi`, CHỈ tồn tại khi có ≥ 1 đăng ký
 * (tạo lúc đăng ký đầu tiên, dừng khi đăng ký cuối bị huỷ/ngắt). Bộ đếm bước `buoc` (đơn điệu, không đọc đồng hồ tường):
 *   • delta: socket phát ở bước `buoc % buocMoiKhung === 0`, `buocMoiKhung = max(capMsToiThieu, min capMs các đăng ký sống của socket) / 50`
 *     ⇒ một thay đổi tới client trong ≤ capMs hiệu lực (mọi đăng ký của socket theo nhịp min);
 *   • tick: mỗi đăng ký có hạn riêng `buocTick` (= bước tạo + 20, rồi +20) ⇒ 1 tick / 1000 ms / đăng ký, kể cả khi không gì đổi.
 * Trạng thái ở `socket.data.__scada`. Trần "nóng" (capMs < 250) đếm từ chính tập đăng ký sống (không bộ đếm riêng ⇒ ngắt / F5 đá socket ⇒ tự về 0);
 * trần theo người dùng là THEO TIẾN TRÌNH (socket của người đó trên bản sao này). B3 (ganGiam — nâng capMs khi tải cao) CHƯA làm.
 */
import { randomUUID } from "node:crypto";
import { coQuyenXemScada, laSocketNguoiDung, taoKiemPhamViTagScada, type DuLieuSocket } from "../../_core/socketPhongQuyen";
import { boDemDangBat, dangKyThayDoi, layGiaTri, nguongCuCuaAdapter, rxTheoKhoa, thongTinAdapter, type GiaTriCoTuoi } from "./boDemHienTai";
import { layTrangThaiAdapter, type TrangThaiKetNoi } from "../ot/trangThaiAdapter";
import { DbUnavailableError } from "../../_core/dbErrors";

export const GIOI_HAN = {
  tagMoiDangKy: 500,
  dangKyMoiSocket: 10,
  /** capMs mặc định khi đăng ký không khai (= hành vi trước 1a). */
  chuKyDeltaMs: 250,
  /** Bước của vòng đẩy duy nhất (mọi capMs hợp lệ là bội của nó). */
  buocVongMs: 50,
  /** Kẹp dưới của nhịp khung hiệu lực. */
  capMsToiThieu: 50,
  /** Nhịp tim mỗi đăng ký. */
  tickMs: 1000,
  /** Đăng ký "nóng" = capMs < nguongNongMs. */
  nguongNongMs: 250,
  /** Tối đa đăng ký nóng mỗi socket. */
  nongMoiSocket: 2,
  /** Tối đa đăng ký nóng mỗi người dùng — trên các socket của người đó Ở TIẾN TRÌNH NÀY. */
  nongMoiNguoi: 3,
} as const;

export const CAP_MS_HOP_LE = [50, 100, 250, 1000] as const;
export type CapMs = (typeof CAP_MS_HOP_LE)[number];

export type MaLoiScada = "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "TOO_MANY_HOT" | "DISABLED" | "BUSY";

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

/** Khoá tag trên dây: `${adapterId}:${tagKey}` (cùng khoá bộ đệm). */
export type KhoaTagScada = `${number}:${string}`;
export type TagScada = { adapterId: number; tagKey: string };

// ─── hợp đồng 1a ────────────────────────────────────────────────────────────────────────────────────
export type ScadaSubscribe = {
  subId?: string;
  tags: TagScada[];
  /** Vắng ⇒ 250. Ngoài tập ⇒ BAD_REQUEST. */
  capMs?: CapMs;
  /** Dự phòng pha 2B. Có mặt và khác "that" ⇒ BAD_REQUEST. */
  nguon?: "that";
};
export type ScadaSnapshot = {
  subId: string;
  seq: number;
  serverTs: number;
  values: GiaTriGoi[];
  /** Ngưỡng cũ (ms) của TỪNG tag được phép — `nguongCuCuaAdapter` của bộ đệm. */
  staleAfterMs: Record<KhoaTagScada, number>;
  denied: TagScada[];
};
export type ScadaDelta = {
  subId: string;
  seq: number;
  serverTs: number;
  values: GiaTriGoi[];
  /** Chỉ khi ngưỡng của ≥ 1 adapter ĐỔI so với lần gửi trước; chỉ khoá đổi. */
  staleAfterMs?: Record<KhoaTagScada, number>;
};
export type ScadaTickAdapter = {
  adapterId: number;
  /** Trạng thái phiên kết nối do TRUNG TÂM giữ (`layTrangThaiAdapter`); null = trung tâm không có (adapter do edge sở hữu / chưa từng báo). */
  trangThai: TrangThaiKetNoi | null;
  /** Tuổi (ms) mẫu mới nhất trong các tag ĐƯỢC PHÉP của adapter này; null = chưa có mẫu. */
  tuoiMauMoiNhatMs: number | null;
};
export type ScadaTick = {
  subId: string;
  seq: number;
  serverTs: number;
  adapters: ScadaTickAdapter[];
  /** Như delta: ngưỡng đổi mà chưa có delta nào mang đi. */
  staleAfterMs?: Record<KhoaTagScada, number>;
};

/** Phần của `Socket` mà module này dùng (test dùng socket giả). */
export interface SocketScada {
  data: DuLieuSocket & Record<string, unknown>;
  emit(ev: string, payload: unknown): unknown;
  on(ev: string, cb: (...args: any[]) => unknown): unknown;
}

interface TagDangKy {
  adapterId: number;
  tagKey: string;
  /** Máy đã được kiểm phạm vi lúc đăng ký (null = adapter không gắn máy ⇒ đã kiểm "toàn quyền"). */
  machineId: number | null;
}
interface AdapterDangKy {
  /** Máy đã kiểm lúc đăng ký (mọi tag của một adapter cùng máy). */
  machineId: number | null;
  /** Khoá các tag ĐƯỢC PHÉP của adapter này trong đăng ký. */
  keys: KhoaTagScada[];
  /** Ngưỡng cũ đã gửi lần cuối cho adapter này (snapshot hoặc khung sau). */
  nguongDaGui: number;
}
interface DangKy {
  subId: string;
  /** Chỉ tag ĐƯỢC PHÉP. Khoá `${adapterId}:${tagKey}` (cùng khoá bộ đệm). */
  tags: Map<string, TagDangKy>;
  /** Adapter có ≥ 1 tag được phép. */
  adapters: Map<number, AdapterDangKy>;
  /** Khoá đã đổi từ khung trước; giá trị lấy MỚI NHẤT lúc đẩy. */
  cho: Set<string>;
  capMs: CapMs;
  /** seq của khung CUỐI đã phát (snapshot = 0). */
  seq: number;
  /** Bước vòng mà tick kế tiếp đến hạn. */
  buocTick: number;
}
interface DangKyDangCho {
  subId: string;
  /** unsubscribe{subId} đến khi đăng ký này còn đang chờ ⇒ huỷ. */
  huy: boolean;
}
interface TrangThaiScada {
  subs: Map<string, DangKy>;
  daNgat: boolean;
  /** Tối đa MỘT lệnh subscribe đang chờ mỗi socket (lệnh thứ hai ⇒ BUSY). */
  cho: DangKyDangCho | null;
  /** Tăng mỗi lần unsubscribe-tất-cả: lệnh subscribe bắt đầu trước đó bị huỷ. */
  the: number;
  /** Số bước vòng giữa hai khung delta của socket (theo min capMs các đăng ký sống) — cập nhật ở `capNhatVong`. */
  buocMoiKhung: number;
}

const khoa = (adapterId: number, tagKey: string): KhoaTagScada => `${adapterId}:${tagKey}`;
const BUOC_TICK = Math.round(GIOI_HAN.tickMs / GIOI_HAN.buocVongMs);
const laNong = (capMs: number): boolean => capMs < GIOI_HAN.nguongNongMs;

/** Socket đang có ≥ 1 đăng ký. */
const cacSocket = new Set<SocketScada>();
let hen: ReturnType<typeof setInterval> | null = null;
let huyNguoiNghe: (() => void) | null = null;
/** Bộ đếm bước của vòng (về 0 khi vòng dừng — lúc đó không còn đăng ký nào). */
let buoc = 0;

/** Chỉ cho lưới: vòng đẩy có đang chạy không. */
export function __vongDangChay(): boolean {
  return hen !== null;
}

function trangThai(socket: SocketScada): TrangThaiScada | null {
  const st = socket.data.__scada as TrangThaiScada | undefined;
  return st ?? null;
}

function phat(socket: SocketScada, ev: string, payload: unknown): void {
  try {
    socket.emit(ev, payload);
  } catch (err) {
    console.error(`[SCADA] emit ${ev} lỗi:`, (err as Error)?.message ?? err);
  }
}

function baoLoi(socket: SocketScada, code: MaLoiScada): void {
  phat(socket, "scada:error", { code });
}

// ─── trần "nóng" (B2) ───────────────────────────────────────────────────────────────────────────────
const idNguoi = (socket: SocketScada): number | null => {
  const id = (socket.data.user as { id?: unknown } | null | undefined)?.id;
  return typeof id === "number" ? id : null;
};
function demNongSocket(st: TrangThaiScada, boQuaSubId: string | null): number {
  let n = 0;
  for (const s of st.subs.values()) if (s.subId !== boQuaSubId && laNong(s.capMs)) n++;
  return n;
}
/** Số đăng ký nóng của người dùng trên MỌI socket của họ ở tiến trình này, trừ (socket hiện tại, subId sắp thay). */
function demNongNguoi(userId: number, socket: SocketScada, boQuaSubId: string | null): number {
  let n = 0;
  for (const sk of cacSocket) {
    const st = trangThai(sk);
    if (!st || st.daNgat || idNguoi(sk) !== userId) continue;
    n += demNongSocket(st, sk === socket ? boQuaSubId : null);
  }
  return n;
}
/** Thêm một đăng ký (capMs, thay subId) có vượt trần nóng không. */
function vuotTranNong(socket: SocketScada, st: TrangThaiScada, subId: string, capMs: CapMs): boolean {
  if (!laNong(capMs)) return false;
  if (demNongSocket(st, subId) + 1 > GIOI_HAN.nongMoiSocket) return true;
  const uid = idNguoi(socket);
  return uid !== null && demNongNguoi(uid, socket, subId) + 1 > GIOI_HAN.nongMoiNguoi;
}
/** Chỉ cho lưới: số đăng ký nóng đang sống (của một người dùng, hoặc toàn tiến trình). */
export function __soDangKyNong(userId?: number): number {
  let n = 0;
  for (const sk of cacSocket) {
    const st = trangThai(sk);
    if (!st || st.daNgat) continue;
    if (userId !== undefined && idNguoi(sk) !== userId) continue;
    n += demNongSocket(st, null);
  }
  return n;
}
/**
 * SCADA 1a fix 1 (I-1) — socket có đang GIỮ dữ liệu theo phạm vi qua kênh này không: ≥ 1 đăng ký sống (tag đã kiểm phạm vi lúc đăng ký) hoặc
 * một lệnh subscribe đang chờ (sẽ thành đăng ký với phạm vi đọc lúc ấy). Lượt quét F5 (`socketXetLaiQuyen.socketConHopLe`) coi socket như
 * vậy NGANG với socket đang ở phòng có phạm vi — đăng ký SCADA không phải phòng nên trước đây lượt quét không thấy. Đã ngắt ⇒ false.
 */
export function coDuLieuPhamViScada(data: unknown): boolean {
  const st = (data as { __scada?: TrangThaiScada } | null | undefined)?.__scada;
  return !!st && !st.daNgat && (st.subs.size > 0 || st.cho !== null);
}

/** Chỉ cho lưới: số socket đang có ≥ 1 đăng ký (phát hiện rò đăng ký). */
export function __soSocketDangKy(): number {
  return cacSocket.size;
}

// ─── tra adapter trong DB (adapter không do trung tâm quản) ──────────────────────────────────────────
/** MỘT truy vấn cho cả tập id; id không có trong kết quả = adapter không tồn tại. */
type TraAdapterDb = (adapterIds: number[]) => Promise<Map<number, { machineId: number | null }>>;
let traAdapterGhiDe: TraAdapterDb | null = null;
/** Chỉ cho lưới: thay bước tra `device_adapters` (không cần CSDL; spy đếm số lần gọi). `null` ⇒ về mặc định. */
export function __datTraAdapterChoTest(f: TraAdapterDb | null): void {
  traAdapterGhiDe = f;
}
async function traAdapterTuDb(adapterIds: number[]): Promise<Map<number, { machineId: number | null }>> {
  if (traAdapterGhiDe) return traAdapterGhiDe(adapterIds);
  // import động: socket.ts không kéo lớp DB lúc khởi động
  const { getDb } = await import("../../db/connection");
  const { deviceAdapters } = await import("../../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const db = await getDb();
  // lỗi có kiểu (rawErrorCensus): nơi gọi bắt và chặn (giữ co:false) — hợp đồng mã lỗi socket không đổi
  if (!db) throw new DbUnavailableError("scada:subscribe: không có kết nối CSDL để tra adapter");
  const rows = await db.select({ id: deviceAdapters.id, machineId: deviceAdapters.machineId }).from(deviceAdapters).where(inArray(deviceAdapters.id, adapterIds));
  return new Map(rows.map((r) => [r.id, { machineId: r.machineId ?? null }]));
}

// ─── dựng giá trị gói ───────────────────────────────────────────────────────────────────────────────
function goiTuBoDem(g: GiaTriCoTuoi): GiaTriGoi {
  return [g.adapterId, g.tagKey, g.v, g.q, g.ts, g.ageMs, g.stale, g.reason];
}
const chuaCoMau = (t: TagDangKy): GiaTriGoi => [t.adapterId, t.tagKey, null, "bad", 0, -1, true, "stale"];

/** Giá trị của một tag đã được phép. `"doiMay"` = máy hiệu lực khác máy đã kiểm ⇒ KHÔNG được gửi. */
function giaTriCua(t: TagDangKy): GiaTriGoi | "doiMay" | null {
  const g = layGiaTri(t.adapterId, t.tagKey);
  if (!g) return null;
  if (g.machineId !== t.machineId) return "doiMay";
  return goiTuBoDem(g);
}

/** Adapter đã bị chuyển máy so với máy đã kiểm lúc đăng ký (theo sổ đăng ký adapter — cùng nguồn máy hiệu lực của bộ đệm). */
function adapterDoiMay(adapterId: number, a: AdapterDangKy): boolean {
  const info = thongTinAdapter(adapterId);
  return info !== null && info.machineId !== a.machineId;
}

/** A2 — ngưỡng của adapter nào ĐỔI so với lần gửi trước ⇒ trả khoá (chỉ tag được phép của adapter đó) + ghi nhận đã gửi; không đổi ⇒ null. */
function layNguongDoi(sub: DangKy): Record<KhoaTagScada, number> | null {
  let out: Record<KhoaTagScada, number> | null = null;
  for (const [adapterId, a] of sub.adapters) {
    if (adapterDoiMay(adapterId, a)) continue; // A5: tag đổi máy vắng khỏi staleAfterMs mới
    const n = nguongCuCuaAdapter(adapterId);
    if (n === a.nguongDaGui) continue;
    a.nguongDaGui = n;
    out ??= {};
    for (const k of a.keys) out[k] = n;
  }
  return out;
}

// ─── vòng đẩy ───────────────────────────────────────────────────────────────────────────────────────
function khiBoDemDoi(keys: string[]): void {
  for (const sk of cacSocket) {
    const st = trangThai(sk);
    if (!st) continue;
    for (const sub of st.subs.values()) {
      for (const k of keys) if (sub.tags.has(k)) sub.cho.add(k);
    }
  }
}

function phatDelta(sk: SocketScada, sub: DangKy, now: number): void {
  if (sub.cho.size === 0) return;
  const values: GiaTriGoi[] = [];
  for (const k of sub.cho) {
    const t = sub.tags.get(k);
    if (!t) continue;
    const gt = giaTriCua(t);
    if (gt === null || gt === "doiMay") continue;
    values.push(gt);
  }
  sub.cho.clear();
  if (values.length === 0) return;
  const doi = layNguongDoi(sub);
  const goi: ScadaDelta = { subId: sub.subId, seq: ++sub.seq, serverTs: now, values };
  if (doi) goi.staleAfterMs = doi;
  phat(sk, "scada:delta", goi);
}

function phatTick(sk: SocketScada, sub: DangKy, now: number): void {
  const adapters: ScadaTickAdapter[] = [];
  for (const [adapterId, a] of sub.adapters) {
    if (adapterDoiMay(adapterId, a)) continue; // không lộ trạng thái adapter đã sang máy khác
    let rxMoiNhat: number | null = null;
    for (const k of a.keys) {
      const rx = rxTheoKhoa(k); // khoá đăng ký = khoá bộ đệm
      if (rx !== null && (rxMoiNhat === null || rx > rxMoiNhat)) rxMoiNhat = rx;
    }
    adapters.push({
      adapterId,
      trangThai: layTrangThaiAdapter(adapterId)?.tt ?? null,
      tuoiMauMoiNhatMs: rxMoiNhat === null ? null : Math.max(0, now - rxMoiNhat),
    });
  }
  const doi = layNguongDoi(sub);
  const goi: ScadaTick = { subId: sub.subId, seq: ++sub.seq, serverTs: now, adapters };
  if (doi) goi.staleAfterMs = doi;
  phat(sk, "scada:tick", goi);
}

function motBuoc(): void {
  buoc++;
  const now = Date.now();
  for (const sk of [...cacSocket]) {
    const st = trangThai(sk);
    if (!st || st.daNgat) continue;
    const denKhung = buoc % st.buocMoiKhung === 0;
    for (const sub of [...st.subs.values()]) {
      if (denKhung) phatDelta(sk, sub, now);
      if (buoc >= sub.buocTick) {
        sub.buocTick = buoc + BUOC_TICK;
        phatTick(sk, sub, now);
      }
    }
  }
}

function batVong(): void {
  if (hen) return;
  buoc = 0;
  huyNguoiNghe = dangKyThayDoi(khiBoDemDoi);
  hen = setInterval(() => {
    try {
      motBuoc();
    } catch (err) {
      console.error("[SCADA] vòng đẩy lỗi:", (err as Error)?.message ?? err);
    }
  }, GIOI_HAN.buocVongMs);
  hen.unref?.();
}

function dungVong(): void {
  if (hen) clearInterval(hen);
  hen = null;
  buoc = 0;
  huyNguoiNghe?.();
  huyNguoiNghe = null;
}

/** B1 — số bước giữa hai khung của socket: min capMs các đăng ký sống, kẹp ≥ capMsToiThieu. */
function tinhBuocMoiKhung(st: TrangThaiScada): number {
  let min: number = GIOI_HAN.chuKyDeltaMs;
  let co = false;
  for (const s of st.subs.values()) {
    if (!co || s.capMs < min) min = s.capMs;
    co = true;
  }
  return Math.max(1, Math.round(Math.max(GIOI_HAN.capMsToiThieu, min) / GIOI_HAN.buocVongMs));
}

/** Sau mỗi thay đổi tập đăng ký: tính lại nhịp khung; bật vòng khi có ≥ 1 đăng ký, tắt khi không còn. */
function capNhatVong(socket: SocketScada): void {
  const st = trangThai(socket);
  if (st) st.buocMoiKhung = tinhBuocMoiKhung(st);
  if (st && !st.daNgat && st.subs.size > 0) cacSocket.add(socket);
  else cacSocket.delete(socket);
  if (cacSocket.size > 0) batVong();
  else dungVong();
}

/** Chỉ cho lưới: xoá mọi đăng ký + dừng vòng. */
export function __datLaiScadaSocket(): void {
  cacSocket.clear();
  dungVong();
}

/** Chỉ cho bench/lưới: chạy MỘT bước vòng ngay (không chờ bộ hẹn) — đo chi phí bước. */
export function __motBuocChoTest(): void {
  motBuoc();
}

// ─── kiểm đầu vào ───────────────────────────────────────────────────────────────────────────────────
const SUBID_TOI_DA = 64;
const TAGKEY_TOI_DA = 256;

function laObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function kiemSubId(v: unknown): string | null | "sai" {
  if (v === undefined) return null;
  return typeof v === "string" && v.length > 0 && v.length <= SUBID_TOI_DA ? v : "sai";
}

function kiemCapMs(v: unknown): CapMs | "sai" {
  if (v === undefined) return GIOI_HAN.chuKyDeltaMs;
  return (CAP_MS_HOP_LE as readonly unknown[]).includes(v) ? (v as CapMs) : "sai";
}

// ─── xử lý ──────────────────────────────────────────────────────────────────────────────────────────
async function xuLyDangKy(socket: SocketScada, st: TrangThaiScada, payload: unknown): Promise<void> {
  if (process.env.SCADA_SOCKET_ENABLED !== "true" || !boDemDangBat()) return baoLoi(socket, "DISABLED");
  if (!laObj(payload) || !Array.isArray(payload.tags) || payload.tags.length === 0) return baoLoi(socket, "BAD_REQUEST");
  if (payload.tags.length > GIOI_HAN.tagMoiDangKy) return baoLoi(socket, "TOO_MANY_TAGS");
  const subIdVao = kiemSubId(payload.subId);
  if (subIdVao === "sai") return baoLoi(socket, "BAD_REQUEST");
  const capMs = kiemCapMs(payload.capMs);
  if (capMs === "sai") return baoLoi(socket, "BAD_REQUEST");
  // pha 2B sẽ có "mo_phong"; hôm nay mọi giá trị khác "that" bị TỪ CHỐI (không im lặng coi như thật)
  if (payload.nguon !== undefined && payload.nguon !== "that") return baoLoi(socket, "BAD_REQUEST");

  const yeuCau = new Map<string, TagScada>();
  for (const t of payload.tags) {
    if (
      !laObj(t) ||
      typeof t.adapterId !== "number" ||
      !Number.isSafeInteger(t.adapterId) ||
      t.adapterId <= 0 ||
      typeof t.tagKey !== "string" ||
      t.tagKey === "" ||
      t.tagKey.length > TAGKEY_TOI_DA
    ) {
      return baoLoi(socket, "BAD_REQUEST");
    }
    yeuCau.set(khoa(t.adapterId, t.tagKey), { adapterId: t.adapterId, tagKey: t.tagKey });
  }

  const subId = subIdVao ?? randomUUID();

  // Socket KHÔNG phải người dùng (máy tự khai `clientType:"machine"`, handshake không cần cookie): mọi tag bị từ chối NGAY — KHÔNG truy cập CSDL,
  // KHÔNG lưu đăng ký, KHÔNG bật vòng, KHÔNG tick. Quyết định (23/10): trả `scada:snapshot` với toàn bộ tag trong `denied` (cùng hình dạng với
  // người dùng không có quyền ⇒ không phân biệt được qua kênh này).
  if (!laSocketNguoiDung(socket.data)) {
    const sn: ScadaSnapshot = { subId, seq: 0, serverTs: Date.now(), values: [], staleAfterMs: {}, denied: [...yeuCau.values()].map(({ adapterId, tagKey }) => ({ adapterId, tagKey })) };
    phat(socket, "scada:snapshot", sn);
    return;
  }

  // Tối đa một lệnh subscribe đang chờ mỗi socket: chặn khuếch đại (mỗi lệnh có thể kéo quyền + phạm vi + một truy vấn adapter).
  if (st.cho) return baoLoi(socket, "BUSY");
  if (!st.subs.has(subId) && st.subs.size >= GIOI_HAN.dangKyMoiSocket) return baoLoi(socket, "TOO_MANY_SUBS");
  if (vuotTranNong(socket, st, subId, capMs)) return baoLoi(socket, "TOO_MANY_HOT");
  const cho: DangKyDangCho = { subId, huy: false };
  const the = st.the;
  st.cho = cho;
  try {
    await hoanTatDangKy(socket, st, cho, the, subId, capMs, yeuCau);
  } finally {
    if (st.cho === cho) st.cho = null;
  }
}

async function hoanTatDangKy(
  socket: SocketScada,
  st: TrangThaiScada,
  cho: DangKyDangCho,
  the: number,
  subId: string,
  capMs: CapMs,
  yeuCau: Map<string, TagScada>,
): Promise<void> {
  // 1) QUYỀN người dùng (machine_monitoring/canView): MỘT lần mỗi lần đăng ký. Không có quyền ⇒ khỏi tra adapter/phạm vi: tất cả denied.
  const coQuyen = await coQuyenXemScada(socket.data);

  // 2) máy của từng adapter: trung tâm quản ⇒ thongTinAdapter; còn lại ⇒ MỘT truy vấn DB cho cả tập; không có ở đâu ⇒ denied.
  const mayCuaAdapter = new Map<number, { co: boolean; machineId: number | null }>();
  if (coQuyen) {
    const chuaBiet: number[] = [];
    for (const { adapterId } of yeuCau.values()) {
      if (mayCuaAdapter.has(adapterId)) continue;
      const info = thongTinAdapter(adapterId);
      if (info) mayCuaAdapter.set(adapterId, { co: true, machineId: info.machineId });
      else {
        mayCuaAdapter.set(adapterId, { co: false, machineId: null });
        chuaBiet.push(adapterId);
      }
    }
    if (chuaBiet.length > 0) {
      try {
        const tuDb = await traAdapterTuDb(chuaBiet);
        for (const id of chuaBiet) {
          const r = tuDb.get(id);
          if (r) mayCuaAdapter.set(id, { co: true, machineId: r.machineId });
        }
      } catch (err) {
        console.error("[SCADA] tra adapter lỗi:", (err as Error)?.message ?? err); // không biết ⇒ chặn (giữ co:false)
      }
    }
  }

  // 3) PHẠM VI: MỘT idsTrongPhamVi("machine") cho cả đăng ký (final M4 — trước: một trongPhamVi mỗi máy, tới ~500 lần DB). Chỉ hỏi khi có
  // adapter đã biết (không quyền / không adapter nào ⇒ không chạm DB). Mặc định từ chối; adapter không gắn máy ⇒ chỉ toàn quyền.
  const coAdapterDaBiet = [...mayCuaAdapter.values()].some((m) => m.co);
  const trongPhamVi = coAdapterDaBiet ? await taoKiemPhamViTagScada(socket.data).catch(() => () => false) : () => false;

  // Socket ngắt / đăng ký bị huỷ (unsubscribe cùng subId, hoặc unsubscribe-tất-cả) trong lúc chờ ⇒ không tạo đăng ký, không snapshot, không bật vòng.
  if (st.daNgat || cho.huy || st.the !== the) return;
  if (!st.subs.has(subId) && st.subs.size >= GIOI_HAN.dangKyMoiSocket) return baoLoi(socket, "TOO_MANY_SUBS");
  // Kiểm lại sau các await (socket khác của cùng người dùng có thể đã thêm đăng ký nóng); từ đây tới `st.subs.set` không còn await.
  if (vuotTranNong(socket, st, subId, capMs)) return baoLoi(socket, "TOO_MANY_HOT");

  const tags = new Map<string, TagDangKy>();
  const denied: TagScada[] = [];
  for (const [k, y] of yeuCau) {
    const m = mayCuaAdapter.get(y.adapterId);
    if (m?.co && trongPhamVi(m.machineId) === true) tags.set(k, { adapterId: y.adapterId, tagKey: y.tagKey, machineId: m.machineId });
    else denied.push({ adapterId: y.adapterId, tagKey: y.tagKey });
  }

  const values: GiaTriGoi[] = [];
  for (const t of tags.values()) {
    const gt = giaTriCua(t);
    if (gt === "doiMay") {
      // đổi máy giữa lúc kiểm và lúc đọc ⇒ coi như chưa được phép
      tags.delete(khoa(t.adapterId, t.tagKey));
      denied.push({ adapterId: t.adapterId, tagKey: t.tagKey });
    } else {
      values.push(gt ?? chuaCoMau(t));
    }
  }

  // A1 — ngưỡng cũ của TỪNG tag được phép = ngưỡng hiện hành của adapter (cùng hàm với `stale` của bộ đệm); tag denied KHÔNG có khoá.
  const adapters = new Map<number, AdapterDangKy>();
  const staleAfterMs: Record<KhoaTagScada, number> = {};
  for (const t of tags.values()) {
    let a = adapters.get(t.adapterId);
    if (!a) {
      a = { machineId: t.machineId, keys: [], nguongDaGui: nguongCuCuaAdapter(t.adapterId) };
      adapters.set(t.adapterId, a);
    }
    const k = khoa(t.adapterId, t.tagKey);
    a.keys.push(k);
    staleAfterMs[k] = a.nguongDaGui;
  }

  // C1 — đăng ký lại cùng subId THAY đăng ký cũ (khung cũ chưa phát bị bỏ; seq bắt đầu lại 0; không vòng thứ hai — `batVong` idempotent).
  st.subs.set(subId, { subId, tags, adapters, cho: new Set(), capMs, seq: 0, buocTick: buoc + BUOC_TICK });
  capNhatVong(socket);
  const sn: ScadaSnapshot = { subId, seq: 0, serverTs: Date.now(), values, staleAfterMs, denied };
  phat(socket, "scada:snapshot", sn);
}

function xuLyHuy(socket: SocketScada, st: TrangThaiScada, payload: unknown): void {
  if (payload !== undefined && payload !== null && !laObj(payload)) return baoLoi(socket, "BAD_REQUEST");
  const subId = kiemSubId(laObj(payload) ? payload.subId : undefined);
  if (subId === "sai") return baoLoi(socket, "BAD_REQUEST");
  if (subId === null) {
    st.subs.clear();
    st.the++; // huỷ cả lệnh subscribe đang chờ
  } else {
    st.subs.delete(subId);
    if (st.cho && st.cho.subId === subId) st.cho.huy = true;
  }
  capNhatVong(socket);
}

export function registerScadaHandlers(socket: SocketScada): void {
  if (socket.data.__scada) return; // đã đăng ký cho socket này
  const st: TrangThaiScada = { subs: new Map(), daNgat: false, cho: null, the: 0, buocMoiKhung: Math.round(GIOI_HAN.chuKyDeltaMs / GIOI_HAN.buocVongMs) };
  socket.data.__scada = st;

  socket.on("scada:subscribe", async (payload: unknown) => {
    try {
      await xuLyDangKy(socket, st, payload);
    } catch (err) {
      // Không biết ⇒ không gửi gì ngoài lỗi chung; không lộ chi tiết.
      console.error("[SCADA] scada:subscribe lỗi:", (err as Error)?.message ?? err);
      baoLoi(socket, "BAD_REQUEST");
    }
  });
  socket.on("scada:unsubscribe", (payload: unknown) => {
    try {
      xuLyHuy(socket, st, payload);
    } catch (err) {
      console.error("[SCADA] scada:unsubscribe lỗi:", (err as Error)?.message ?? err);
    }
  });
  // Ngắt THƯỜNG và ngắt do F5 (`disconnectSockets(true)` / `socket.disconnect(true)` của socketXetLaiQuyen) đều tới đây: mọi đăng ký (và vì thế
  // mọi suất "nóng") của socket được thả; vòng dừng nếu đây là socket cuối.
  socket.on("disconnect", () => {
    st.daNgat = true;
    st.subs.clear();
    capNhatVong(socket);
  });
}
