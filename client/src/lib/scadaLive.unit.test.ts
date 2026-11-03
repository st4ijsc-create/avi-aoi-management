// SCADA 1b — kho giá trị sống `KhoScadaLive` (hợp đồng 1a). Socket giả + đồng hồ giả; KHÔNG mạng, KHÔNG DB.
// Các ca ★ ghim luật trung thực (spec §3.7/§4): cũ khi kênh không đẩy thật, ngưỡng theo TỪNG tag, trangThai null ≠ đã kết nối, hở seq ⇒ đăng ký lại.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KhoScadaLive, type SocketLive } from "./scadaLive";
import type { GiaTriGoi, ScadaDelta, ScadaSnapshot, ScadaTick } from "@shared/scadaLiveContract";

class SocketGia implements SocketLive {
  connected = false;
  readonly ra: { ev: string; payload: any }[] = [];
  private readonly h = new Map<string, Set<(...a: any[]) => void>>();
  emit(ev: string, payload: unknown) {
    this.ra.push({ ev, payload });
  }
  on(ev: string, fn: (...a: any[]) => void) {
    let s = this.h.get(ev);
    if (!s) this.h.set(ev, (s = new Set()));
    s.add(fn);
  }
  off(ev: string, fn: (...a: any[]) => void) {
    this.h.get(ev)?.delete(fn);
  }
  phat(ev: string, payload?: unknown) {
    for (const f of [...(this.h.get(ev) ?? [])]) f(payload);
  }
  noi() {
    this.connected = true;
    this.phat("connect");
  }
  ngat() {
    this.connected = false;
    this.phat("disconnect");
  }
  soNguoiNghe() {
    return [...this.h.values()].reduce((n, s) => n + s.size, 0);
  }
  lanPhat(ev: string) {
    return this.ra.filter((r) => r.ev === ev);
  }
}

const gv = (a: number, tag: string, v: number | string | boolean | null, ageMs = 0, q: "good" | "uncertain" | "bad" = "good", stale = false): GiaTriGoi => [a, tag, v, q, Date.now(), ageMs, stale, null];
const snap = (subId: string, values: GiaTriGoi[], staleAfterMs: Record<string, number> = {}, denied: { adapterId: number; tagKey: string }[] = []): ScadaSnapshot => ({
  subId,
  seq: 0,
  serverTs: Date.now(),
  values,
  staleAfterMs: staleAfterMs as ScadaSnapshot["staleAfterMs"],
  denied,
});
const delta = (subId: string, seq: number, values: GiaTriGoi[], staleAfterMs?: Record<string, number>): ScadaDelta => ({
  subId,
  seq,
  serverTs: Date.now(),
  values,
  ...(staleAfterMs ? { staleAfterMs: staleAfterMs as ScadaDelta["staleAfterMs"] } : {}),
});
const tick = (subId: string, seq: number, adapters: ScadaTick["adapters"], staleAfterMs?: Record<string, number>): ScadaTick => ({
  subId,
  seq,
  serverTs: Date.now(),
  adapters,
  ...(staleAfterMs ? { staleAfterMs: staleAfterMs as ScadaTick["staleAfterMs"] } : {}),
});

let sk: SocketGia;
let kho: KhoScadaLive;
let nha: number;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  sk = new SocketGia();
  nha = 0;
  kho = new KhoScadaLive({ layKetNoi: () => sk, nhaKetNoi: () => void (nha += 1) });
});
afterEach(() => {
  kho.huy();
  vi.useRealTimers();
});

/** Đăng ký 1 tag, nối, gom 50 ms, trả snapshot. */
function sanSang(values: GiaTriGoi[], staleAfterMs: Record<string, number> = { "1:t": 15_000 }) {
  const huy = kho.dangKy([{ adapterId: 1, tagKey: "t" }]);
  sk.noi();
  vi.advanceTimersByTime(60);
  sk.phat("scada:snapshot", snap("ui-0", values, staleAfterMs));
  return huy;
}

describe("KhoScadaLive — đăng ký", () => {
  it("gộp 50 ms: 3 lần dangKy liên tiếp ⇒ MỘT scada:subscribe chứa hợp (không bão)", () => {
    sk.noi();
    kho.dangKy([{ adapterId: 1, tagKey: "a" }]);
    kho.dangKy([{ adapterId: 1, tagKey: "b" }]);
    kho.dangKy([{ adapterId: 2, tagKey: "c" }]);
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(0);
    vi.advanceTimersByTime(60);
    const ds = sk.lanPhat("scada:subscribe");
    expect(ds).toHaveLength(1);
    expect(ds[0].payload.subId).toBe("ui-0");
    expect(ds[0].payload.tags).toEqual([
      { adapterId: 1, tagKey: "a" },
      { adapterId: 1, tagKey: "b" },
      { adapterId: 2, tagKey: "c" },
    ]);
  });

  it("đếm tham chiếu: hai thành phần cùng tag; huỷ một ⇒ vẫn còn; huỷ hết ⇒ unsubscribe + nhả socket + gỡ nghe", () => {
    sk.noi();
    const h1 = kho.dangKy([{ adapterId: 1, tagKey: "a" }]);
    const h2 = kho.dangKy([{ adapterId: 1, tagKey: "a" }]);
    vi.advanceTimersByTime(60);
    h1();
    vi.advanceTimersByTime(60);
    expect(sk.lanPhat("scada:unsubscribe")).toHaveLength(0);
    expect(nha).toBe(0);
    h2();
    h2(); // huỷ lặp vô hại
    vi.advanceTimersByTime(60);
    expect(sk.lanPhat("scada:unsubscribe")).toHaveLength(1);
    expect(nha).toBe(1);
    expect(sk.soNguoiNghe()).toBe(0);
  });

  it("bỏ bớt tag ⇒ đăng ký lại với tập MỚI; tập không đổi ⇒ không gửi lại", () => {
    sk.noi();
    kho.dangKy([{ adapterId: 1, tagKey: "a" }]);
    const hb = kho.dangKy([{ adapterId: 1, tagKey: "b" }]);
    vi.advanceTimersByTime(60);
    hb();
    vi.advanceTimersByTime(60);
    const ds = sk.lanPhat("scada:subscribe");
    expect(ds).toHaveLength(2);
    expect(ds[1].payload.tags).toEqual([{ adapterId: 1, tagKey: "a" }]);
  });

  it("> 500 tag ⇒ chia nhiều subId (ui-0, ui-1), mỗi cái ≤ 500", () => {
    sk.noi();
    kho.dangKy(Array.from({ length: 501 }, (_, i) => ({ adapterId: 1, tagKey: `t${String(i).padStart(3, "0")}` })));
    vi.advanceTimersByTime(60);
    const ds = sk.lanPhat("scada:subscribe");
    expect(ds.map((d) => d.payload.subId)).toEqual(["ui-0", "ui-1"]);
    expect(ds[0].payload.tags).toHaveLength(500);
    expect(ds[1].payload.tags).toHaveLength(1);
  });

  it("đăng ký TRƯỚC khi socket nối ⇒ chờ; khi 'connect' mới gửi", () => {
    kho.dangKy([{ adapterId: 1, tagKey: "a" }]);
    vi.advanceTimersByTime(60);
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(0);
    sk.noi();
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(1);
  });
});

describe("KhoScadaLive — giá trị, tuổi, cũ", () => {
  it("snapshot ⇒ có giá trị tươi; delta cập nhật; ageMs = -1 ⇒ CHƯA có mẫu (không bịa 0)", () => {
    sanSang([gv(1, "t", 7)]);
    expect(kho.doc(1, "t")).toMatchObject({ coMau: true, v: 7, cu: false, tuChoi: false });
    sk.phat("scada:delta", delta("ui-0", 1, [gv(1, "t", 8)]));
    expect(kho.doc(1, "t").v).toBe(8);
    sk.phat("scada:delta", delta("ui-0", 2, [[1, "t", null, "bad", 0, -1, true, null]]));
    expect(kho.doc(1, "t")).toMatchObject({ coMau: false, tuoiMs: null, cu: true });
  });

  it("★ ngưỡng 15 000: tuổi lúc nhận 2 s + chờ 13 s = 15 s CHƯA cũ; chờ 14 s ⇒ cũ; giá trị KHÔNG đổi (không ngoại suy)", () => {
    sanSang([gv(1, "t", 5, 2000)]);
    let seq = 0;
    const chay = (s: number) => {
      for (let i = 0; i < s; i++) {
        vi.advanceTimersByTime(1000);
        sk.phat("scada:tick", tick("ui-0", ++seq, [{ adapterId: 1, trangThai: "connected", tuoiMauMoiNhatMs: 0 }]));
      }
    };
    chay(13);
    expect(kho.doc(1, "t")).toMatchObject({ cu: false, v: 5 });
    chay(2); // 17 s > 15 s
    expect(kho.doc(1, "t")).toMatchObject({ cu: true, v: 5 });
  });

  it("★ staleAfterMs thay đổi giữa phiên (delta mang khoá đổi) ⇒ client gộp, KHÔNG đăng ký lại; ngưỡng 70 s giữ tag tươi qua 30 s im lặng", () => {
    sanSang([gv(1, "t", 5, 0)], { "1:t": 15_000 });
    sk.phat("scada:delta", delta("ui-0", 1, [], { "1:t": 70_000 }));
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(1);
    let seq = 1;
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000);
      sk.phat("scada:tick", tick("ui-0", ++seq, []));
    }
    expect(kho.doc(1, "t").cu).toBe(false);
  });

  it("★ không có tick > 3,5 s ⇒ kênh chậm/chết ⇒ MỌI tag là cũ dù tuổi còn nhỏ; tick về lại ⇒ tươi", () => {
    sanSang([gv(1, "t", 5, 0)]);
    sk.phat("scada:tick", tick("ui-0", 1, []));
    vi.advanceTimersByTime(3000);
    expect(kho.doc(1, "t").cu).toBe(false);
    vi.advanceTimersByTime(1000); // 4 s im lặng
    expect(kho.doc(1, "t").cu).toBe(true);
    sk.phat("scada:tick", tick("ui-0", 2, []));
    expect(kho.doc(1, "t").cu).toBe(false);
  });

  it("máy chủ đánh dấu stale=true ⇒ cũ dù tuổi nhỏ", () => {
    sanSang([gv(1, "t", 5, 100, "good", true)]);
    expect(kho.doc(1, "t").cu).toBe(true);
  });

  it("tag bị denied ⇒ KHÔNG có giá trị (v null) và tuChoi", () => {
    kho.dangKy([{ adapterId: 1, tagKey: "t" }]);
    sk.noi();
    vi.advanceTimersByTime(60);
    sk.phat("scada:snapshot", snap("ui-0", [gv(1, "t", 123)], {}, [{ adapterId: 1, tagKey: "t" }]));
    expect(kho.doc(1, "t")).toMatchObject({ v: null, tuChoi: true, cu: true, coMau: false });
  });

  it("chất lượng uncertain/bad được giữ nguyên (chỉ cờ cu quyết định gạch)", () => {
    sanSang([gv(1, "t", 1, 0, "uncertain")]);
    expect(kho.doc(1, "t")).toMatchObject({ q: "uncertain", cu: false });
  });
});

describe("KhoScadaLive — nối lại, hở seq, lỗi", () => {
  it("★ mất kết nối ⇒ MỌI tag cũ ngay; nối lại ⇒ gửi lại subscribe, VẪN cũ tới khi snapshot mới về (F5)", () => {
    sanSang([gv(1, "t", 5, 0)]);
    expect(kho.doc(1, "t").cu).toBe(false);
    sk.ngat();
    expect(kho.trangThai()).toBe("ngat");
    expect(kho.doc(1, "t").cu).toBe(true);
    sk.noi();
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(2); // gửi lại
    expect(kho.doc(1, "t").cu).toBe(true); // chưa có snapshot ⇒ vẫn cũ
    sk.phat("scada:snapshot", snap("ui-0", [gv(1, "t", 9, 0)], { "1:t": 15_000 }));
    expect(kho.doc(1, "t")).toMatchObject({ v: 9, cu: false });
  });

  it("★ delta trước snapshot (sau nối lại) bị BỎ — không vá lên nền chưa biết", () => {
    sanSang([gv(1, "t", 5, 0)]);
    sk.ngat();
    sk.noi();
    sk.phat("scada:delta", delta("ui-0", 1, [gv(1, "t", 99)]));
    expect(kho.doc(1, "t")).toMatchObject({ v: 5, cu: true });
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(2); // bỏ im lặng: KHÔNG coi là hở seq ⇒ không bắn thêm subscribe
  });

  it("★ hở seq (1 → 3) ⇒ đăng ký lại, tag cũ cho tới snapshot mới; seq lặp cũng vậy", () => {
    sanSang([gv(1, "t", 5, 0)]);
    sk.phat("scada:delta", delta("ui-0", 1, [gv(1, "t", 6)]));
    sk.phat("scada:delta", delta("ui-0", 3, [gv(1, "t", 7)]));
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(2);
    expect(kho.doc(1, "t")).toMatchObject({ v: 6, cu: true }); // giá trị seq 3 KHÔNG được áp
    sk.phat("scada:snapshot", snap("ui-0", [gv(1, "t", 8)], { "1:t": 15_000 }));
    expect(kho.doc(1, "t")).toMatchObject({ v: 8, cu: false });
    sk.phat("scada:delta", delta("ui-0", 0, [gv(1, "t", 1)])); // lặp seq
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(3);
  });

  it("scada:error DISABLED ⇒ trạng thái khong_co_kenh (hook chuyển sang hỏi vòng), mọi tag cũ", () => {
    sanSang([gv(1, "t", 5, 0)]);
    sk.phat("scada:error", { code: "DISABLED" });
    expect(kho.trangThai()).toBe("khong_co_kenh");
    expect(kho.doc(1, "t").cu).toBe(true);
  });

  it("scada:error BUSY ⇒ thử lại có giãn (tối đa 5 lần), không bão", () => {
    kho.dangKy([{ adapterId: 1, tagKey: "t" }]);
    sk.noi();
    vi.advanceTimersByTime(60);
    sk.phat("scada:error", { code: "BUSY" });
    sk.phat("scada:error", { code: "BUSY" }); // đang chờ ⇒ bỏ qua
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(1);
    vi.advanceTimersByTime(2_100);
    expect(sk.lanPhat("scada:subscribe")).toHaveLength(2);
    for (let i = 0; i < 10; i++) {
      sk.phat("scada:error", { code: "BUSY" });
      vi.advanceTimersByTime(20_000);
    }
    expect(sk.lanPhat("scada:subscribe").length).toBeLessThanOrEqual(1 + 5);
  });
});

describe("KhoScadaLive — tick / trạng thái adapter", () => {
  it("★ trangThai null = KHÔNG RÕ: giữ null, không bao giờ suy ra 'connected'; chưa có tick ⇒ coTick false", () => {
    sanSang([gv(1, "t", 5, 0)]);
    expect(kho.docAdapter(1)).toMatchObject({ trangThai: null, coTick: false });
    sk.phat("scada:tick", tick("ui-0", 1, [{ adapterId: 1, trangThai: null, tuoiMauMoiNhatMs: null }]));
    expect(kho.docAdapter(1)).toMatchObject({ trangThai: null, coTick: true, tuoiMauMoiNhatMs: null });
    sk.phat("scada:tick", tick("ui-0", 2, [{ adapterId: 1, trangThai: "lost", tuoiMauMoiNhatMs: 9000 }]));
    expect(kho.docAdapter(1)).toMatchObject({ trangThai: "lost", tuoiMauMoiNhatMs: 9000 });
  });

  it("ảnh chụp ỔN ĐỊNH: không đổi ⇒ cùng tham chiếu (useSyncExternalStore không lặp)", () => {
    sanSang([gv(1, "t", 5, 0)]);
    expect(kho.doc(1, "t")).toBe(kho.doc(1, "t"));
    expect(kho.docAdapter(1)).toBe(kho.docAdapter(1));
  });
});

describe("KhoScadaLive — thông báo thay đổi", () => {
  it("nhịp 4 Hz báo đúng lúc tag chuyển sang cũ (không cần tin nhắn nào)", () => {
    sanSang([gv(1, "t", 5, 0)], { "1:t": 5000 });
    let seq = 0;
    const dem = vi.fn();
    kho.nghe("1:t", dem);
    kho.doc(1, "t"); // ảnh chụp ban đầu
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(1000);
      sk.phat("scada:tick", tick("ui-0", ++seq, []));
    }
    expect(kho.doc(1, "t").cu).toBe(true);
    expect(dem).toHaveBeenCalled();
  });
});
