/**
 * SCADA R0 (C8) — bộ đếm truyền thông theo adapter và theo tag (màn M10 tiêu thụ ở Task 10).
 *
 * Bộ nhớ trong tiến trình, KHÔNG ghi DB, KHÔNG phát socket. Thùng theo phút, giữ tối đa 60 thùng (1 giờ); độ trễ p50/p95 tính từ tối đa
 * 600 mẫu thời gian gần nhất của mỗi adapter (chỉ lần đọc THÀNH CÔNG — thời gian của lần đọc lỗi/timeout là hạn cắt, không phải độ
 * trễ thiết bị).
 *
 * Quy ước đếm:
 *   - Một tick poll = 1 request cấp adapter + 1 request cho MỖI tag có trong tick. Tick lỗi không mang danh sách tag ⇒ chỉ tăng
 *     request/loi (và timeout) cấp adapter.
 *   - `loi` cấp adapter = tick `ok:false` (gồm cả timeout); `timeout` = tick bị cắt ở hạn. `loi` của tag = số lần mẫu `bad`.
 *   - `phien` = số lần THỬ nối (cả legacy lẫn supervisor), `phienLoi` = số lần thử thất bại.
 *   - `lenh` / `lenhLoi` = kết quả ghi theo từng tag (otDeviceWrite); ghi timeout tính là lỗi.
 *   - R1b-1 T4: `chong` = số tick poll bị bỏ vì tick trước chưa xong (`soLanChong`, đến qua trường `chong` của onTick — phần tăng).
 *     `ingestTreo` = số lượt phát mẫu (ghi DB) quá hạn (`lyDo:"ingest_treo"`). Ingest treo KHÔNG tính `loi`/`timeout` (đó là số liệu
 *     thiết bị): kèm lần đọc chính (`ok:true`) ⇒ lần đọc đếm như một request thành công; không kèm lần đọc (`ok:false`) ⇒ chỉ `ingestTreo`.
 *
 * PHẠM VI R0: adapter đẩy kiểu push (OPC UA monitored items) KHÔNG gọi onTick ⇒ không có request/độ trễ cho chúng ở R0 (chỉ phiên
 * và lệnh). Mọi hàm ghi không ném (đường nóng của poll/lệnh không được hỏng vì bộ đếm).
 */
import type { SuKienDoc } from "./otDriver";

const PHUT_MS = 60_000;
const SO_THUNG_TOI_DA = 60;
const SO_MAU_TRE_TOI_DA = 600;
const CUA_SO_MAC_DINH_MS = 3_600_000;

interface DemTag {
  request: number;
  loi: number;
  good: number;
  uncertain: number;
  bad: number;
  lenh: number;
  lenhLoi: number;
}

interface Thung {
  phien: number;
  phienLoi: number;
  request: number;
  loi: number;
  timeout: number;
  lenh: number;
  lenhLoi: number;
  chong: number;
  ingestTreo: number;
  tag: Map<string, DemTag>;
}

interface TrangThaiAdapter {
  thung: Map<number, Thung>;
  /** Vòng tròn tối đa 600 mẫu độ trễ (tick ok), theo thứ tự ghi. */
  tre: { ts: number; ms: number }[];
}

export interface BoDemAdapter {
  phien: number;
  phienLoi: number;
  request: number;
  loi: number;
  timeout: number;
  lenh: number;
  lenhLoi: number;
  /** R1b-1 T4 — tick poll bị bỏ vì chồng (tick trước chưa xong). */
  chong: number;
  /** R1b-1 T4 — lượt phát mẫu (ghi DB) quá hạn. */
  ingestTreo: number;
  p50Ms: number | null;
  p95Ms: number | null;
  theoTag: Record<string, DemTag>;
}

const kho = new Map<number, TrangThaiAdapter>();

const trangThai = (adapterId: number): TrangThaiAdapter => {
  let s = kho.get(adapterId);
  if (!s) {
    s = { thung: new Map(), tre: [] };
    kho.set(adapterId, s);
  }
  return s;
};

const demTagMoi = (): DemTag => ({ request: 0, loi: 0, good: 0, uncertain: 0, bad: 0, lenh: 0, lenhLoi: 0 });

/** Thùng của phút chứa `now`; dọn thùng quá 60 phút trước đó. */
function thungHienTai(s: TrangThaiAdapter, now: number): Thung {
  const phut = Math.floor(now / PHUT_MS);
  let t = s.thung.get(phut);
  if (!t) {
    t = { phien: 0, phienLoi: 0, request: 0, loi: 0, timeout: 0, lenh: 0, lenhLoi: 0, chong: 0, ingestTreo: 0, tag: new Map() };
    s.thung.set(phut, t);
  }
  // Giữ tối đa 60 thùng: bỏ thùng xa hơn 60 phút so với thùng MỚI NHẤT (ghi lệch thứ tự thời gian không làm mất thùng gần).
  let moiNhat = phut;
  for (const k of s.thung.keys()) if (k > moiNhat) moiNhat = k;
  for (const k of [...s.thung.keys()]) if (k <= moiNhat - SO_THUNG_TOI_DA) s.thung.delete(k);
  return t;
}

const dungTag = (t: Thung, tagKey: string): DemTag => {
  let d = t.tag.get(tagKey);
  if (!d) {
    d = demTagMoi();
    t.tag.set(tagKey, d);
  }
  return d;
};

export function ghiNhanDoc(adapterId: number, e: SuKienDoc, now: number = Date.now()): void {
  try {
    const s = trangThai(adapterId);
    const t = thungHienTai(s, now);
    if (typeof e.chong === "number" && Number.isFinite(e.chong) && e.chong > 0) t.chong += e.chong;
    const treo = e.lyDo === "ingest_treo";
    if (treo) {
      t.ingestTreo += 1;
      // Báo treo không kèm lần đọc (mẫu muộn / loạt xấu): lần đọc đã được đếm ở tick riêng.
      if (!e.ok) return;
    }
    t.request += 1;
    if (!e.ok) t.loi += 1;
    if (e.timeout && !treo) t.timeout += 1;
    for (const tag of e.tags) {
      const d = dungTag(t, tag.tagKey);
      d.request += 1;
      if (tag.quality === "good") d.good += 1;
      else if (tag.quality === "uncertain") d.uncertain += 1;
      else {
        d.bad += 1;
        d.loi += 1;
      }
    }
    if (e.ok && Number.isFinite(e.ms)) {
      s.tre.push({ ts: now, ms: e.ms });
      if (s.tre.length > SO_MAU_TRE_TOI_DA) s.tre.splice(0, s.tre.length - SO_MAU_TRE_TOI_DA);
    }
  } catch {
    // bộ đếm không bao giờ làm hỏng vòng poll
  }
}

export function ghiNhanPhien(adapterId: number, ok: boolean, now: number = Date.now()): void {
  try {
    const t = thungHienTai(trangThai(adapterId), now);
    t.phien += 1;
    if (!ok) t.phienLoi += 1;
  } catch {
    // nuốt
  }
}

export function ghiNhanLenh(adapterId: number, tagKey: string, ok: boolean, now: number = Date.now()): void {
  try {
    const t = thungHienTai(trangThai(adapterId), now);
    t.lenh += 1;
    const d = dungTag(t, tagKey);
    d.lenh += 1;
    if (!ok) {
      t.lenhLoi += 1;
      d.lenhLoi += 1;
    }
  } catch {
    // nuốt
  }
}

/** Phân vị theo hạng gần nhất (nearest-rank) trên mảng ĐÃ SẮP XẾP tăng dần. */
function phanVi(daSapXep: number[], p: number): number | null {
  if (daSapXep.length === 0) return null;
  const hang = Math.max(1, Math.ceil(p * daSapXep.length));
  return daSapXep[Math.min(daSapXep.length, hang) - 1];
}

export function layBoDem(adapterId: number, cuaSoMs: number = CUA_SO_MAC_DINH_MS, now: number = Date.now()): BoDemAdapter {
  const kq: BoDemAdapter = {
    phien: 0,
    phienLoi: 0,
    request: 0,
    loi: 0,
    timeout: 0,
    lenh: 0,
    lenhLoi: 0,
    chong: 0,
    ingestTreo: 0,
    p50Ms: null,
    p95Ms: null,
    theoTag: {},
  };
  const s = kho.get(adapterId);
  if (!s) return kq;
  const batDau = now - cuaSoMs;
  for (const [phut, t] of s.thung) {
    // thùng nằm trong cửa sổ khi phút KẾT THÚC của nó sau mốc bắt đầu
    if ((phut + 1) * PHUT_MS <= batDau) continue;
    kq.phien += t.phien;
    kq.phienLoi += t.phienLoi;
    kq.request += t.request;
    kq.loi += t.loi;
    kq.timeout += t.timeout;
    kq.lenh += t.lenh;
    kq.lenhLoi += t.lenhLoi;
    kq.chong += t.chong;
    kq.ingestTreo += t.ingestTreo;
    for (const [tagKey, d] of t.tag) {
      const g = (kq.theoTag[tagKey] ??= demTagMoi());
      g.request += d.request;
      g.loi += d.loi;
      g.good += d.good;
      g.uncertain += d.uncertain;
      g.bad += d.bad;
      g.lenh += d.lenh;
      g.lenhLoi += d.lenhLoi;
    }
  }
  const ms = s.tre
    .filter((m) => m.ts > batDau)
    .map((m) => m.ms)
    .sort((a, b) => a - b);
  kq.p50Ms = phanVi(ms, 0.5);
  kq.p95Ms = phanVi(ms, 0.95);
  return kq;
}

/** Chỉ cho test: xoá toàn bộ số liệu. */
export function __datLaiBoDem(): void {
  kho.clear();
}
