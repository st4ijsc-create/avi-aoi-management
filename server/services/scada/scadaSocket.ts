/**
 * SCADA R0 Task 8 — KÊNH SOCKET `scada:subscribe` (C.6): màn SCADA nhận giá trị hiện tại theo từng tag, MỖI TAG KIỂM PHẠM VI NHÀ MÁY.
 *
 * Hợp đồng:
 *   vào  `scada:subscribe`   { subId?: string; tags: { adapterId: number; tagKey: string }[] }
 *   ra   `scada:snapshot`    { subId; values: GiaTriGoi[]; denied: { adapterId; tagKey }[] }
 *   ra   `scada:delta`       { subId; values: GiaTriGoi[] }   — mỗi đăng ký tối đa 1 khung / 250 ms, MỚI NHẤT mỗi tag, không bỏ tag
 *   vào  `scada:unsubscribe` { subId?: string }               — bỏ trống = tất cả
 *   ra   `scada:error`       { code: "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "DISABLED" | "BUSY" }
 *   GiaTriGoi = [adapterId, tagKey, v, q, ts, ageMs, stale, reason]
 *
 * An toàn (bảo mật — một người dùng KHÔNG BAO GIỜ nhận tag ngoài phạm vi của mình):
 *   • KHÔNG `socket.join`, KHÔNG `io.emit`: chỉ `socket.emit` tới đúng socket đã đăng ký (census phòng/phát không đổi).
 *   • Quyền kiểm TỪNG TAG lúc đăng ký (`duocXemTagScada`, cache theo machineId trong lần đăng ký); tag bị từ chối ⇒ `denied`, KHÔNG gửi giá trị.
 *     Adapter không tồn tại ⇒ cũng `denied` (cùng kết quả với ngoài phạm vi: không lộ tồn tại).
 *   • Delta chỉ mang tag ĐÃ ĐĂNG KÝ + ĐÃ ĐƯỢC PHÉP. Máy hiệu lực của adapter được bộ đệm quyết lúc ĐỌC; nếu khác máy đã kiểm lúc đăng ký
 *     (adapter bị chuyển máy giữa chừng) ⇒ KHÔNG gửi (người dùng phải đăng ký lại để kiểm lại).
 *   • Quá giới hạn ⇒ từ chối có mã (`TOO_MANY_TAGS` / `TOO_MANY_SUBS`), KHÔNG cắt bớt im lặng.
 *   • Adapter có trong DB nhưng không do trung tâm quản (edge…): xét phạm vi theo `device_adapters.machineId`, trả `v:null, q:"bad", reason:"stale"`.
 *
 * Vòng đẩy: MỘT `setInterval(250)` (unref) + MỘT người nghe `dangKyThayDoi`, CHỈ tồn tại khi có ≥ 1 đăng ký (tạo lúc đăng ký đầu tiên,
 * dừng khi đăng ký cuối bị huỷ/ngắt). Trạng thái ở `socket.data.__scada`.
 */
import { randomUUID } from "node:crypto";
import { coQuyenXemScada, laSocketNguoiDung, trongPhamViTagScada, type DuLieuSocket } from "../../_core/socketPhongQuyen";
import { boDemDangBat, dangKyThayDoi, layGiaTri, thongTinAdapter, type GiaTriCoTuoi } from "./boDemHienTai";
import { DbUnavailableError } from "../../_core/dbErrors";

export const GIOI_HAN = { tagMoiDangKy: 500, dangKyMoiSocket: 10, chuKyDeltaMs: 250 } as const;

export type MaLoiScada = "BAD_REQUEST" | "TOO_MANY_TAGS" | "TOO_MANY_SUBS" | "DISABLED" | "BUSY";

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
interface DangKy {
  subId: string;
  /** Chỉ tag ĐƯỢC PHÉP. Khoá `${adapterId}:${tagKey}` (cùng khoá bộ đệm). */
  tags: Map<string, TagDangKy>;
  /** Khoá đã đổi từ khung trước; giá trị lấy MỚI NHẤT lúc đẩy. */
  cho: Set<string>;
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
}

const khoa = (adapterId: number, tagKey: string): string => `${adapterId}:${tagKey}`;

/** Socket đang có ≥ 1 đăng ký. */
const cacSocket = new Set<SocketScada>();
let hen: ReturnType<typeof setInterval> | null = null;
let huyNguoiNghe: (() => void) | null = null;

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

function dayKhung(): void {
  for (const sk of [...cacSocket]) {
    const st = trangThai(sk);
    if (!st || st.daNgat) continue;
    for (const sub of st.subs.values()) {
      if (sub.cho.size === 0) continue;
      const values: GiaTriGoi[] = [];
      for (const k of sub.cho) {
        const t = sub.tags.get(k);
        if (!t) continue;
        const gt = giaTriCua(t);
        if (gt === null || gt === "doiMay") continue;
        values.push(gt);
      }
      sub.cho.clear();
      if (values.length > 0) phat(sk, "scada:delta", { subId: sub.subId, values });
    }
  }
}

function batVong(): void {
  if (hen) return;
  huyNguoiNghe = dangKyThayDoi(khiBoDemDoi);
  hen = setInterval(() => {
    try {
      dayKhung();
    } catch (err) {
      console.error("[SCADA] vòng đẩy lỗi:", (err as Error)?.message ?? err);
    }
  }, GIOI_HAN.chuKyDeltaMs);
  hen.unref?.();
}

function dungVong(): void {
  if (hen) clearInterval(hen);
  hen = null;
  huyNguoiNghe?.();
  huyNguoiNghe = null;
}

/** Sau mỗi thay đổi tập đăng ký: bật vòng khi có ≥ 1 đăng ký, tắt khi không còn. */
function capNhatVong(socket: SocketScada): void {
  const st = trangThai(socket);
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

// ─── xử lý ──────────────────────────────────────────────────────────────────────────────────────────
async function xuLyDangKy(socket: SocketScada, st: TrangThaiScada, payload: unknown): Promise<void> {
  if (process.env.SCADA_SOCKET_ENABLED !== "true" || !boDemDangBat()) return baoLoi(socket, "DISABLED");
  if (!laObj(payload) || !Array.isArray(payload.tags) || payload.tags.length === 0) return baoLoi(socket, "BAD_REQUEST");
  if (payload.tags.length > GIOI_HAN.tagMoiDangKy) return baoLoi(socket, "TOO_MANY_TAGS");
  const subIdVao = kiemSubId(payload.subId);
  if (subIdVao === "sai") return baoLoi(socket, "BAD_REQUEST");

  const yeuCau = new Map<string, { adapterId: number; tagKey: string }>();
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
  // KHÔNG lưu đăng ký, KHÔNG bật vòng. Quyết định (23/10): trả `scada:snapshot` với toàn bộ tag trong `denied` (cùng hình dạng với người
  // dùng không có quyền ⇒ không phân biệt được qua kênh này).
  if (!laSocketNguoiDung(socket.data)) {
    phat(socket, "scada:snapshot", { subId, values: [], denied: [...yeuCau.values()].map(({ adapterId, tagKey }) => ({ adapterId, tagKey })) });
    return;
  }

  // Tối đa một lệnh subscribe đang chờ mỗi socket: chặn khuếch đại (mỗi lệnh có thể kéo quyền + phạm vi + một truy vấn adapter).
  if (st.cho) return baoLoi(socket, "BUSY");
  if (!st.subs.has(subId) && st.subs.size >= GIOI_HAN.dangKyMoiSocket) return baoLoi(socket, "TOO_MANY_SUBS");
  const cho: DangKyDangCho = { subId, huy: false };
  const the = st.the;
  st.cho = cho;
  try {
    await hoanTatDangKy(socket, st, cho, the, subId, yeuCau);
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
  yeuCau: Map<string, { adapterId: number; tagKey: string }>,
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

  // 3) PHẠM VI một lần mỗi máy khác nhau (cache trong đời đăng ký này)
  const mayCanKiem = new Set<number | null>();
  for (const m of mayCuaAdapter.values()) if (m.co) mayCanKiem.add(m.machineId);
  const ketQua = new Map<number | null, boolean>();
  // Tuần tự: số máy khác nhau trong một đăng ký nhỏ; mỗi lần là một cổng phạm vi (không dồn song song vào DB).
  for (const mid of mayCanKiem) ketQua.set(mid, await trongPhamViTagScada(socket.data, mid).catch(() => false));

  // Socket ngắt / đăng ký bị huỷ (unsubscribe cùng subId, hoặc unsubscribe-tất-cả) trong lúc chờ ⇒ không tạo đăng ký, không snapshot, không bật vòng.
  if (st.daNgat || cho.huy || st.the !== the) return;
  if (!st.subs.has(subId) && st.subs.size >= GIOI_HAN.dangKyMoiSocket) return baoLoi(socket, "TOO_MANY_SUBS");

  const tags = new Map<string, TagDangKy>();
  const denied: { adapterId: number; tagKey: string }[] = [];
  for (const [k, y] of yeuCau) {
    const m = mayCuaAdapter.get(y.adapterId);
    if (m?.co && ketQua.get(m.machineId) === true) tags.set(k, { adapterId: y.adapterId, tagKey: y.tagKey, machineId: m.machineId });
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

  st.subs.set(subId, { subId, tags, cho: new Set() });
  capNhatVong(socket);
  phat(socket, "scada:snapshot", { subId, values, denied });
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
  const st: TrangThaiScada = { subs: new Map(), daNgat: false, cho: null, the: 0 };
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
  socket.on("disconnect", () => {
    st.daNgat = true;
    st.subs.clear();
    capNhatVong(socket);
  });
}
