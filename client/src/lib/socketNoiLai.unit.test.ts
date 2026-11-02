/**
 * socketNoiLai.unit.test.ts — ★★★ F5 đầy đủ T10: server NGẮT socket (quyền / phạm vi / phiên đổi) ⇒ client nối lại có giới hạn.
 * Socket giả + đồng hồ giả + số ngẫu nhiên giả (không mạng, không DOM).
 */
import { describe, expect, it, vi } from "vitest";
import { ganNoiLaiKhiServerNgat, treLanThu, SO_LAN_TOI_DA, TRE_TRAN_MS, type TrangThaiNoiLai } from "./socketNoiLai";

function nguonKhoiPhuc() {
  let fn: (() => void) | null = null;
  return { gan: (f: () => void) => { fn = f; return () => { fn = null; }; }, ban: () => fn?.(), daGan: () => fn !== null };
}

function socketGia() {
  const nghe = new Map<string, Set<(...a: any[]) => void>>();
  const s = {
    connected: false,
    active: false,
    connect: vi.fn(),
    on: (ev: string, fn: (...a: any[]) => void) => void (nghe.get(ev) ?? nghe.set(ev, new Set()).get(ev)!).add(fn),
    off: (ev: string, fn: (...a: any[]) => void) => void nghe.get(ev)?.delete(fn),
    phat: (ev: string, ...a: any[]) => [...(nghe.get(ev) ?? [])].forEach((f) => f(...a)),
    soNghe: () => [...nghe.values()].reduce((n, x) => n + x.size, 0),
  };
  return s;
}
function dongHo() {
  const hen: Array<{ fn: () => void; ms: number; huy: boolean; daChay?: boolean }> = [];
  return {
    hen,
    henGio: (fn: () => void, ms: number) => {
      const h = { fn, ms, huy: false };
      hen.push(h);
      return h;
    },
    huyHen: (h: unknown) => void ((h as { huy: boolean }).huy = true),
    chayCuoi: () => {
      const h = hen[hen.length - 1];
      if (h.huy || h.daChay) return;
      h.daChay = true;
      h.fn();
    },
  };
}

describe("T10 — nối lại sau `io server disconnect`", () => {
  it("lần đầu 1–3 s (có nhiễu), rồi lùi dần tới trần; không vượt SO_LAN_TOI_DA", () => {
    expect(treLanThu(0, 0)).toBe(1_000);
    expect(treLanThu(0, 0.999999)).toBeLessThanOrEqual(3_000);
    expect(treLanThu(0, 0.5)).toBe(2_000);
    for (let lan = 1; lan < 12; lan++) {
      for (const r of [0, 0.5, 0.99]) {
        const t = treLanThu(lan, r);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(TRE_TRAN_MS);
      }
    }
    expect(treLanThu(10, 0.99)).toBeGreaterThan(TRE_TRAN_MS * 0.9); // ở trần (nhiễu ±50 % vẫn giữ trong trần)
  });

  it("server ngắt ⇒ `dang_noi_lai`, connect() sau trễ; nối được ⇒ `binh_thuong` + khiQuyenDoi (tải lại quyền)", () => {
    const s = socketGia();
    const dh = dongHo();
    const tt: TrangThaiNoiLai[] = [];
    const khiQuyenDoi = vi.fn();
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.5, khiQuyenDoi, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    expect(dh.hen.map((h) => h.ms)).toEqual([2_000]);
    expect(s.connect).not.toHaveBeenCalled();
    dh.chayCuoi();
    expect(s.connect).toHaveBeenCalledTimes(1);
    s.connected = true;
    s.phat("connect");
    expect(tt).toEqual(["dang_noi_lai", "binh_thuong"]);
    expect(khiQuyenDoi).toHaveBeenCalledTimes(1);
  });

  it("handshake nối lại bị từ chối UNAUTHORIZED ⇒ DỪNG thử (không hẹn thêm) + khiHetPhien (đường đăng xuất sẵn có)", () => {
    const s = socketGia();
    const dh = dongHo();
    const khiHetPhien = vi.fn();
    const tt: TrangThaiNoiLai[] = [];
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0, khiHetPhien, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    dh.chayCuoi();
    s.active = false;
    s.phat("connect_error", new Error("UNAUTHORIZED"));
    expect(khiHetPhien).toHaveBeenCalledTimes(1);
    expect(dh.hen.length).toBe(1);
    expect(tt[tt.length - 1]).toBe("het_phien");
    // lỗi tiếp theo (bất kỳ) không làm sống lại vòng thử
    s.phat("connect_error", new Error("RATE_LIMITED"));
    expect(dh.hen.length).toBe(1);
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it("middleware từ chối vì lý do KHÁC (socket không active) ⇒ thử lại có giới hạn, rồi `dung`", () => {
    const s = socketGia();
    const dh = dongHo();
    const tt: TrangThaiNoiLai[] = [];
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.5, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    for (let i = 0; i < SO_LAN_TOI_DA + 3; i++) {
      dh.chayCuoi();
      s.active = false;
      s.phat("connect_error", new Error("RATE_LIMITED"));
    }
    expect(s.connect).toHaveBeenCalledTimes(SO_LAN_TOI_DA);
    expect(tt[tt.length - 1]).toBe("dung");
    const tre = dh.hen.map((h) => h.ms);
    expect(tre.length).toBe(SO_LAN_TOI_DA);
    expect(tre[1]).toBeGreaterThan(tre[0]);
    expect(Math.max(...tre)).toBeLessThanOrEqual(TRE_TRAN_MS);
  });

  it("lý do ngắt KHÁC (mạng / client tự ngắt) và lỗi nối LẦN ĐẦU ⇒ không đụng tới (bộ nối lại của socket.io-client / đường đăng nhập cũ lo)", () => {
    const s = socketGia();
    const dh = dongHo();
    const khiHetPhien = vi.fn();
    const go = ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, khiHetPhien });
    s.phat("connect_error", new Error("UNAUTHORIZED")); // lần nối đầu
    s.phat("disconnect", "transport close");
    s.phat("disconnect", "io client disconnect");
    expect(dh.hen).toEqual([]);
    expect(khiHetPhien).not.toHaveBeenCalled();
    go();
    expect(s.soNghe()).toBe(0);
  });
});

describe("★★★ fix round 1 (I1 / m8) — hạ tầng hỏng ⇒ tự thử lại tới khi DB về; đã dừng ⇒ thử lại khi mạng / tab về", () => {
  it("(c) handshake SERVICE_UNAVAILABLE (kể cả lần nối ĐẦU) ⇒ thử lại VƯỢT trần 8 lần, độ trễ ≤ 30 s, trạng thái `cho_dich_vu`; DB về ⇒ vào được", () => {
    const s = socketGia();
    const dh = dongHo();
    const tt: TrangThaiNoiLai[] = [];
    const khiHetPhien = vi.fn();
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.99, khiHetPhien, khiDoiTrangThai: (t) => tt.push(t) });
    for (let i = 0; i < SO_LAN_TOI_DA * 3; i++) {
      s.active = false;
      s.phat("connect_error", new Error("SERVICE_UNAVAILABLE"));
      dh.chayCuoi();
    }
    expect(s.connect).toHaveBeenCalledTimes(SO_LAN_TOI_DA * 3);
    expect(Math.max(...dh.hen.map((h) => h.ms))).toBeLessThanOrEqual(TRE_TRAN_MS);
    expect(tt).toEqual(["cho_dich_vu"]);
    expect(khiHetPhien).not.toHaveBeenCalled();
    s.connected = true;
    s.phat("connect");
    expect(tt).toEqual(["cho_dich_vu", "binh_thuong"]);
  });

  it("(d) đối chứng: UNAUTHORIZED sau khi bị server ngắt ⇒ DỪNG (không hẹn thêm), khiHetPhien; SERVICE_UNAVAILABLE sau đó vẫn được thử lại (DB hỏng ≠ hết phiên)", () => {
    const s = socketGia();
    const dh = dongHo();
    const khiHetPhien = vi.fn();
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0, khiHetPhien });
    s.phat("disconnect", "io server disconnect");
    dh.chayCuoi();
    s.phat("connect_error", new Error("UNAUTHORIZED"));
    expect(khiHetPhien).toHaveBeenCalledTimes(1);
    const soHen = dh.hen.length;
    s.phat("connect_error", new Error("RATE_LIMITED"));
    expect(dh.hen.length).toBe(soHen);
  });

  it("(m8) đã `dung` (hết 8 lượt) ⇒ mạng về / tab hiện lại ⇒ thử lại từ đầu; khi đang bình thường thì sự kiện ấy không làm gì", () => {
    const s = socketGia();
    const dh = dongHo();
    const kp = nguonKhoiPhuc();
    const tt: TrangThaiNoiLai[] = [];
    const go = ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.5, ganKhoiPhuc: kp.gan, khiDoiTrangThai: (t) => tt.push(t) });
    kp.ban();
    expect(dh.hen).toEqual([]);
    s.phat("disconnect", "io server disconnect");
    for (let i = 0; i < SO_LAN_TOI_DA + 1; i++) {
      dh.chayCuoi();
      s.active = false;
      s.phat("connect_error", new Error("RATE_LIMITED"));
    }
    expect(tt[tt.length - 1]).toBe("dung");
    const truoc = (s.connect as any).mock.calls.length;
    kp.ban();
    expect(tt[tt.length - 1]).toBe("dang_noi_lai");
    expect(dh.hen[dh.hen.length - 1].ms).toBeLessThanOrEqual(3_000); // lượt đầu lại (1–3 s)
    dh.chayCuoi();
    expect((s.connect as any).mock.calls.length).toBe(truoc + 1);
    go();
    expect(kp.daGan()).toBe(false);
  });
});
