/**
 * SCADA 1b — KHO GIÁ TRỊ SỐNG phía client cho kênh đẩy `scada:*` (hợp đồng 1a, `shared/scadaLiveContract.ts`). THUẦN: không React, không DOM;
 * socket + đồng hồ + hẹn giờ do người gọi tiêm ⇒ lưới đơn vị điều khiển được (spec 2026-11-02 §3.7).
 *
 * ★ LUẬT TRUNG THỰC (spec §4 T1–T4) — nhồi vào mã, không chỉ vào tài liệu:
 *   1. Một giá trị chỉ "TƯƠI" khi (a) kênh đang đẩy THẬT (đã có snapshot sau lần nối gần nhất), (b) tick còn tới (≤ `tickChoMs`),
 *      (c) tuổi (tuổi lúc nhận + thời gian chờ ở client) ≤ `staleAfterMs` của CHÍNH tag đó, (d) máy chủ không đánh dấu cũ.
 *      Thiếu một trong bốn ⇒ `cu = true`. Không bao giờ ngoại suy giá trị (không "đoán" số kế tiếp).
 *   2. Mất kết nối / sau nối lại mà CHƯA có snapshot mới ⇒ MỌI tag là cũ (đúng §3.3 C; F5: server ngắt socket giải phóng mọi đăng ký).
 *   3. `trangThai` của tick có thể `null` = KHÔNG RÕ (adapter do edge / chưa từng báo) — kho giữ nguyên `null`, KHÔNG suy ra "đã kết nối".
 *   4. Tag bị `denied` ⇒ không có giá trị (v = null) và `tuChoi = true` — không hiện số của người khác.
 *   5. Hở số thứ tự (`seq`) ⇒ đăng ký lại để lấy snapshot mới (không vá bằng đoán).
 *
 * Một đăng ký máy chủ ≈ ≤ 500 tag (GIOI_HAN.tagMoiDangKy); danh sách tag lớn hơn được CHIA thành nhiều `subId` ổn định (`ui-0`, `ui-1`…).
 * Đăng ký/huỷ gộp 50 ms để mount hàng loạt không gây bão `scada:subscribe`.
 */
import {
  GIOI_HAN_CLIENT,
  khoaTag,
  type GiaTriGoi,
  type KhoaTagScada,
  type MaLoiScada,
  type ScadaDelta,
  type ScadaSnapshot,
  type ScadaTick,
  type TagScada,
  type TrangThaiKetNoi,
} from "@shared/scadaLiveContract";

export type TrangThaiKenh = "chua_noi" | "cho_snapshot" | "day" | "khong_co_kenh" | "ngat";
export type NguonTagSong = "day" | "hoi" | "mo_phong";

export interface TagSong {
  /** Có mẫu thật nào chưa (bộ đệm máy chủ trả ageMs = -1 ⇒ false). */
  coMau: boolean;
  v: number | string | boolean | null;
  q: "good" | "uncertain" | "bad";
  /** Tuổi tới lúc đọc, làm tròn xuống GIÂY (ổn định để không render lại mỗi khung); null khi chưa có mẫu. */
  tuoiMs: number | null;
  cu: boolean;
  tuChoi: boolean;
  reason: string | null;
}
export interface AdapterSong {
  /** null = không rõ (trung tâm không có phiên) — KHÔNG hiện như đã kết nối. */
  trangThai: TrangThaiKetNoi | null;
  tuoiMauMoiNhatMs: number | null;
  /** Đã từng nhận tick cho adapter này. */
  coTick: boolean;
}

export interface SocketLive {
  connected: boolean;
  emit(ev: string, payload: unknown): unknown;
  on(ev: string, fn: (...a: any[]) => void): unknown;
  off(ev: string, fn: (...a: any[]) => void): unknown;
}

export interface TuyChonKho {
  /** Trả socket dùng chung (gọi LẦN ĐẦU khi có đăng ký đầu tiên). */
  layKetNoi: () => SocketLive;
  /** Gọi khi không còn đăng ký nào (nhả socket dùng chung). */
  nhaKetNoi?: () => void;
  bayGio?: () => number;
  henGio?: (fn: () => void, ms: number) => unknown;
  huyHen?: (h: unknown) => void;
  lapLai?: (fn: () => void, ms: number) => unknown;
  huyLap?: (h: unknown) => void;
  gopMs?: number;
  nhipCuMs?: number;
  /** Quá bấy lâu không có gì (tick 1 s) ⇒ kênh chậm/chết ⇒ mọi tag là cũ. */
  tickChoMs?: number;
}

interface MauNoiBo {
  v: number | string | boolean | null;
  q: "good" | "uncertain" | "bad";
  tuoiLucNhanMs: number;
  nhanLucMs: number;
  cuMayChu: boolean;
  reason: string | null;
  coMau: boolean;
}
interface DangKyMayChu {
  subId: string;
  khoa: Set<KhoaTagScada>;
  seq: number | null;
  /** true cho tới khi có snapshot (sau subscribe mới / nối lại / hở seq). */
  cho: boolean;
  tinNhanCuoiMs: number;
}

const NGUONG_CU_MAC_DINH_MS = 15_000;
const BUSY_THU_LAI_MS = 2_000;
const BUSY_TOI_DA = 5;

export class KhoScadaLive {
  private readonly o: Required<Pick<TuyChonKho, "gopMs" | "nhipCuMs" | "tickChoMs">> & TuyChonKho;
  private socket: SocketLive | null = null;
  private daGan = false;
  private trangThaiKenh: TrangThaiKenh = "chua_noi";
  private daTungNoi = false;

  private readonly muon = new Map<KhoaTagScada, { adapterId: number; tagKey: string; ref: number }>();
  private readonly mau = new Map<KhoaTagScada, MauNoiBo>();
  private readonly tuChoi = new Set<KhoaTagScada>();
  private readonly nguongCu = new Map<KhoaTagScada, number>();
  private readonly adapters = new Map<number, AdapterSong>();
  private readonly subs = new Map<string, DangKyMayChu>();

  private readonly nguoiNgheKhoa = new Map<KhoaTagScada, Set<() => void>>();
  private readonly nguoiNgheChung = new Set<() => void>();
  private readonly anhChup = new Map<KhoaTagScada, TagSong>();
  private anhChupAdapter = new Map<number, AdapterSong>();

  private henGop: unknown = null;
  private henBusy: unknown = null;
  private soBusy = 0;
  private nhip: unknown = null;
  private cam = false;

  private readonly tuongTac = {
    onConnect: () => this.khiNoi(),
    onDisconnect: () => this.khiNgat(),
    onSnapshot: (g: ScadaSnapshot) => this.khiSnapshot(g),
    onDelta: (g: ScadaDelta) => this.khiDelta(g),
    onTick: (g: ScadaTick) => this.khiTick(g),
    onError: (e: { code?: MaLoiScada }) => this.khiLoi(e?.code),
  };

  constructor(o: TuyChonKho) {
    this.o = { gopMs: 50, nhipCuMs: 250, tickChoMs: 3_500, ...o };
  }

  // ───────────────────────── đăng ký ─────────────────────────
  /** Đăng ký một tập tag; trả hàm huỷ (đếm tham chiếu — hai thành phần cùng tag không huỷ nhau). */
  dangKy(tags: TagScada[]): () => void {
    const khoa = tags.map((t) => khoaTag(t.adapterId, t.tagKey));
    for (let i = 0; i < tags.length; i++) {
      const h = this.muon.get(khoa[i]);
      if (h) h.ref += 1;
      else this.muon.set(khoa[i], { adapterId: tags[i].adapterId, tagKey: tags[i].tagKey, ref: 1 });
    }
    this.batDau();
    this.hoanGop();
    let daHuy = false;
    return () => {
      if (daHuy) return;
      daHuy = true;
      for (const k of khoa) {
        const h = this.muon.get(k);
        if (!h) continue;
        h.ref -= 1;
        if (h.ref <= 0) {
          this.muon.delete(k);
          this.mau.delete(k);
          this.tuChoi.delete(k);
          this.anhChup.delete(k);
        }
      }
      this.hoanGop();
    };
  }

  /** Huỷ toàn bộ (unmount ứng dụng / test). */
  huy(): void {
    this.cam = true;
    this.dung();
    this.muon.clear();
  }

  // ───────────────────────── đọc ─────────────────────────
  trangThai(): TrangThaiKenh {
    return this.trangThaiKenh;
  }
  /** Ảnh chụp ỔN ĐỊNH (cùng tham chiếu nếu không đổi) — dùng cho `useSyncExternalStore`. */
  doc(adapterId: number, tagKey: string): TagSong {
    const k = khoaTag(adapterId, tagKey);
    const moi = this.tinhTag(k, this.bay());
    const cu = this.anhChup.get(k);
    if (cu && laBangTag(cu, moi)) return cu;
    this.anhChup.set(k, moi);
    return moi;
  }
  docAdapter(adapterId: number): AdapterSong {
    const a = this.adapters.get(adapterId) ?? KHONG_RO;
    const cu = this.anhChupAdapter.get(adapterId);
    if (cu && cu.trangThai === a.trangThai && cu.tuoiMauMoiNhatMs === a.tuoiMauMoiNhatMs && cu.coTick === a.coTick) return cu;
    this.anhChupAdapter.set(adapterId, a);
    return a;
  }
  /** Nghe thay đổi của MỘT tag (adapterId, tagKey) hoặc của kênh nói chung (khoa = null). Trả hàm gỡ. */
  nghe(khoa: KhoaTagScada | null, fn: () => void): () => void {
    if (khoa === null) {
      this.nguoiNgheChung.add(fn);
      return () => this.nguoiNgheChung.delete(fn);
    }
    let s = this.nguoiNgheKhoa.get(khoa);
    if (!s) this.nguoiNgheKhoa.set(khoa, (s = new Set()));
    s.add(fn);
    return () => {
      s!.delete(fn);
      if (s!.size === 0) this.nguoiNgheKhoa.delete(khoa);
    };
  }

  // ───────────────────────── nội bộ: vòng đời ─────────────────────────
  private bay(): number {
    return (this.o.bayGio ?? Date.now)();
  }
  private batDau(): void {
    if (this.cam) return;
    if (!this.socket) {
      this.socket = this.o.layKetNoi();
      this.trangThaiKenh = this.socket.connected ? "cho_snapshot" : "chua_noi";
      this.daTungNoi = this.socket.connected;
    }
    if (!this.daGan) {
      const s = this.socket;
      s.on("connect", this.tuongTac.onConnect);
      s.on("disconnect", this.tuongTac.onDisconnect);
      s.on("scada:snapshot", this.tuongTac.onSnapshot);
      s.on("scada:delta", this.tuongTac.onDelta);
      s.on("scada:tick", this.tuongTac.onTick);
      s.on("scada:error", this.tuongTac.onError);
      this.daGan = true;
    }
    if (this.nhip === null) {
      this.nhip = (this.o.lapLai ?? ((fn, ms) => setInterval(fn, ms)))(() => this.nhipCu(), this.o.nhipCuMs);
    }
  }
  private dung(): void {
    if (this.henGop !== null) (this.o.huyHen ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.henGop);
    if (this.henBusy !== null) (this.o.huyHen ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.henBusy);
    this.henGop = this.henBusy = null;
    if (this.nhip !== null) (this.o.huyLap ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(this.nhip);
    this.nhip = null;
    if (this.socket && this.daGan) {
      const s = this.socket;
      s.off("connect", this.tuongTac.onConnect);
      s.off("disconnect", this.tuongTac.onDisconnect);
      s.off("scada:snapshot", this.tuongTac.onSnapshot);
      s.off("scada:delta", this.tuongTac.onDelta);
      s.off("scada:tick", this.tuongTac.onTick);
      s.off("scada:error", this.tuongTac.onError);
      if (s.connected && this.subs.size > 0) s.emit("scada:unsubscribe", {});
    }
    this.daGan = false;
    this.subs.clear();
    if (this.socket) {
      this.socket = null;
      this.o.nhaKetNoi?.();
    }
    this.trangThaiKenh = "chua_noi";
  }
  private hoanGop(): void {
    if (this.cam || this.henGop !== null) return;
    this.henGop = (this.o.henGio ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.henGop = null;
      this.dongBo(false);
    }, this.o.gopMs);
  }

  /** Đưa đăng ký máy chủ về khớp `muon`. `ep` = gửi lại mọi `subscribe` (sau nối lại). */
  private dongBo(ep: boolean): void {
    if (this.cam) return;
    if (this.muon.size === 0) {
      // không còn ai cần ⇒ huỷ đăng ký (dung() gửi unsubscribe) + nhả socket dùng chung
      if (this.socket) this.dung();
      return;
    }
    const s = this.socket;
    if (!s || !s.connected) return; // sẽ đồng bộ khi `connect`
    const khoaSapXep = [...this.muon.keys()].sort();
    const tran = GIOI_HAN_CLIENT.tagMoiDangKy;
    const cacNhom: KhoaTagScada[][] = [];
    for (let i = 0; i < khoaSapXep.length; i += tran) cacNhom.push(khoaSapXep.slice(i, i + tran));
    const cacSubId = new Set<string>();
    cacNhom.forEach((nhom, i) => {
      const subId = `ui-${i}`;
      cacSubId.add(subId);
      const cu = this.subs.get(subId);
      const giong = cu !== undefined && cu.khoa.size === nhom.length && nhom.every((k) => cu.khoa.has(k));
      if (giong && !ep) return;
      this.subs.set(subId, { subId, khoa: new Set(nhom), seq: null, cho: true, tinNhanCuoiMs: this.bay() });
      s.emit("scada:subscribe", { subId, tags: nhom.map((k) => this.muon.get(k)!).map(({ adapterId, tagKey }) => ({ adapterId, tagKey })) });
    });
    for (const subId of [...this.subs.keys()]) {
      if (cacSubId.has(subId)) continue;
      this.subs.delete(subId);
      s.emit("scada:unsubscribe", { subId });
    }
    if (this.trangThaiKenh === "chua_noi") this.datTrangThai("cho_snapshot");
    this.baoChung();
  }

  // ───────────────────────── nội bộ: sự kiện ─────────────────────────
  private khiNoi(): void {
    const laNoiLai = this.daTungNoi;
    this.daTungNoi = true;
    this.soBusy = 0;
    // sau nối lại (kể cả server ngắt — F5) máy chủ đã THẢ mọi đăng ký và KHÔNG gửi gì cho tới khi nhận `scada:subscribe` mới (scada-master 2026-11-04):
    // `dongBo(ep = true)` DỰNG LẠI mọi đăng ký (cho = true, seq = null) và gửi lại; tới khi snapshot về mọi tag là cũ.
    this.datTrangThai("cho_snapshot");
    this.dongBo(laNoiLai || this.subs.size > 0);
    this.baoTatCa();
  }
  private khiNgat(): void {
    this.datTrangThai("ngat");
    for (const sub of this.subs.values()) {
      sub.cho = true;
      sub.seq = null;
    }
    this.baoTatCa();
  }
  private khiSnapshot(g: ScadaSnapshot): void {
    const sub = this.subs.get(g.subId);
    if (!sub) return;
    const bay = this.bay();
    sub.seq = g.seq;
    sub.cho = false;
    sub.tinNhanCuoiMs = bay;
    // denied THẮNG: dù máy chủ lỡ kèm giá trị, tag bị từ chối KHÔNG có số
    const biTuChoi = new Set((g.denied ?? []).map((t) => khoaTag(t.adapterId, t.tagKey)));
    for (const k of sub.khoa) {
      if (biTuChoi.has(k)) {
        this.tuChoi.add(k);
        this.mau.delete(k);
      } else this.tuChoi.delete(k);
    }
    for (const [k, ms] of Object.entries(g.staleAfterMs ?? {}) as [KhoaTagScada, number][]) this.nguongCu.set(k, ms);
    this.ap(g.values.filter((x) => !biTuChoi.has(khoaTag(x[0], x[1]))), bay);
    this.datTrangThai("day");
    this.baoTatCa();
  }
  private khiDelta(g: ScadaDelta): void {
    const sub = this.subs.get(g.subId);
    if (!sub || sub.cho) return; // chưa có snapshot ⇒ bỏ (không vá lên nền chưa biết)
    if (!this.seqHopLe(sub, g.seq)) return;
    const bay = this.bay();
    sub.tinNhanCuoiMs = bay;
    for (const [k, ms] of Object.entries(g.staleAfterMs ?? {}) as [KhoaTagScada, number][]) this.nguongCu.set(k, ms);
    this.ap(g.values, bay);
    this.baoTatCa();
  }
  private khiTick(g: ScadaTick): void {
    const sub = this.subs.get(g.subId);
    if (!sub || sub.cho) return;
    if (!this.seqHopLe(sub, g.seq)) return;
    sub.tinNhanCuoiMs = this.bay();
    for (const [k, ms] of Object.entries(g.staleAfterMs ?? {}) as [KhoaTagScada, number][]) this.nguongCu.set(k, ms);
    for (const a of g.adapters) {
      this.adapters.set(a.adapterId, { trangThai: a.trangThai, tuoiMauMoiNhatMs: a.tuoiMauMoiNhatMs, coTick: true });
    }
    this.baoTatCa();
  }
  private seqHopLe(sub: DangKyMayChu, seq: number): boolean {
    if (sub.seq !== null && seq === sub.seq + 1) {
      sub.seq = seq;
      return true;
    }
    // hở / lặp / lùi ⇒ không vá bằng đoán: đăng ký lại để lấy snapshot mới (mọi tag cũ trong lúc chờ)
    sub.cho = true;
    sub.seq = null;
    this.baoTatCa();
    this.socket?.emit("scada:subscribe", {
      subId: sub.subId,
      tags: [...sub.khoa].map((k) => this.muon.get(k)).filter((h): h is NonNullable<typeof h> => h !== undefined).map(({ adapterId, tagKey }) => ({ adapterId, tagKey })),
    });
    return false;
  }
  private khiLoi(code: MaLoiScada | undefined): void {
    if (code === "DISABLED") {
      this.datTrangThai("khong_co_kenh");
      this.baoTatCa();
      return;
    }
    if (code === "BUSY") {
      if (this.soBusy >= BUSY_TOI_DA || this.henBusy !== null) return;
      this.soBusy += 1;
      this.henBusy = (this.o.henGio ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
        this.henBusy = null;
        this.dongBo(true);
      }, BUSY_THU_LAI_MS * this.soBusy);
    }
    // BAD_REQUEST / TOO_MANY_* là lỗi lập trình hoặc vượt hạn mức: không tự thử lại (tránh bão); tag liên quan giữ trạng thái "cũ"
  }
  private datTrangThai(t: TrangThaiKenh): void {
    this.trangThaiKenh = t;
  }
  private ap(values: GiaTriGoi[], bay: number): void {
    for (const [adapterId, tagKey, v, q, , ageMs, stale, reason] of values) {
      const k = khoaTag(adapterId, tagKey);
      if (!this.muon.has(k)) continue;
      this.tuChoi.delete(k);
      this.mau.set(k, { v, q, tuoiLucNhanMs: ageMs, nhanLucMs: bay, cuMayChu: stale, reason, coMau: ageMs >= 0 });
    }
  }

  // ───────────────────────── tính "cũ" ─────────────────────────
  private kenhCham(k: KhoaTagScada, bay: number): boolean {
    for (const sub of this.subs.values()) {
      if (!sub.khoa.has(k)) continue;
      return sub.cho || bay - sub.tinNhanCuoiMs > this.o.tickChoMs;
    }
    return true; // chưa thuộc đăng ký nào đã đi
  }
  private tinhTag(k: KhoaTagScada, bay: number): TagSong {
    if (this.tuChoi.has(k)) return { coMau: false, v: null, q: "bad", tuoiMs: null, cu: true, tuChoi: true, reason: null };
    const m = this.mau.get(k);
    // kênh hỏng ở mức kết nối (chưa nối / ngắt / máy chủ tắt kênh) HOẶC riêng đăng ký chứa tag này chưa có snapshot / hết tick
    const kenhKem = this.trangThaiKenh === "chua_noi" || this.trangThaiKenh === "ngat" || this.trangThaiKenh === "khong_co_kenh" || this.kenhCham(k, bay);
    if (!m || !m.coMau) return { coMau: false, v: m?.v ?? null, q: m?.q ?? "bad", tuoiMs: null, cu: true, tuChoi: false, reason: m?.reason ?? null };
    const tuoi = m.tuoiLucNhanMs + Math.max(0, bay - m.nhanLucMs);
    const nguong = this.nguongCu.get(k) ?? NGUONG_CU_MAC_DINH_MS;
    const cu = kenhKem || m.cuMayChu || tuoi > nguong;
    return { coMau: true, v: m.v, q: m.q, tuoiMs: Math.floor(tuoi / 1000) * 1000, cu, tuChoi: false, reason: m.reason };
  }
  private nhipCu(): void {
    // đồng hồ "cũ" 4 Hz: chỉ báo các tag có người nghe mà ảnh chụp đã đổi (cờ cu / giây tuổi)
    const bay = this.bay();
    let doi = false;
    for (const [k, fns] of this.nguoiNgheKhoa) {
      const cu = this.anhChup.get(k);
      if (!cu) continue;
      if (!laBangTag(cu, this.tinhTag(k, bay))) {
        for (const f of [...fns]) f();
        doi = true;
      }
    }
    if (doi) for (const f of [...this.nguoiNgheChung]) f();
  }
  private baoTatCa(): void {
    for (const fns of this.nguoiNgheKhoa.values()) for (const f of [...fns]) f();
    this.baoChung();
  }
  private baoChung(): void {
    for (const f of [...this.nguoiNgheChung]) f();
  }
}

const KHONG_RO: AdapterSong = { trangThai: null, tuoiMauMoiNhatMs: null, coTick: false };

function laBangTag(a: TagSong, b: TagSong): boolean {
  return a.coMau === b.coMau && a.v === b.v && a.q === b.q && a.tuoiMs === b.tuoiMs && a.cu === b.cu && a.tuChoi === b.tuChoi && a.reason === b.reason;
}
